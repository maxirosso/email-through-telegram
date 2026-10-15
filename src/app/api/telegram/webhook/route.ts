import { Prisma } from "@prisma/client";
import { z } from "zod";
import { accessTokenForAccount } from "@/auth/microsoft-tokens";
import { config } from "@/config";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { MicrosoftGraphProvider } from "@/providers/microsoft-graph";
import { OutgoingService } from "@/services/outgoing";
import { scheduleServerlessSend } from "@/services/qstash-scheduler";
import { assertSendQuota } from "@/services/quota";
import { redeemTelegramPairingCode } from "@/services/telegram-pairing";
import { writeAudit } from "@/services/audit";
import {
  answerCallbackQuery, getTelegramFile, sendTelegramDocument, sendTelegramMessage, sendTelegramPlainMessage,
} from "@/telegram/client";
import { normalizeTelegramAttachment, TelegramAttachmentKind } from "@/telegram/attachments";
import { parseRecipients, validateBody, validateSubject } from "@/telegram/compose";
import { composePrompt, draftPreview, escapeHtml, homeMessage, scheduledMessage, truncate } from "@/telegram/format";
import {
  fullEmailFilename, splitTelegramEmail, TELEGRAM_EMAIL_FILE_THRESHOLD,
} from "@/telegram/full-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_DRAFT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_DRAFT_ATTACHMENTS = 10;

const fileSchema = z.object({ file_id: z.string(), file_unique_id: z.string().optional(), file_name: z.string().optional(), mime_type: z.string().optional(), file_size: z.number().int().optional() });
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z.object({
    from: z.object({ id: z.number().int() }).optional(),
    chat: z.object({ id: z.number().int() }),
    text: z.string().optional(),
    document: fileSchema.optional(),
    photo: z.array(fileSchema).optional(),
    caption: z.string().optional(),
    date: z.number().int().optional(),
    media_group_id: z.string().optional(),
  }).optional(),
  callback_query: z.object({
    id: z.string(), from: z.object({ id: z.number().int() }), data: z.string().max(64).optional(),
    message: z.object({ chat: z.object({ id: z.number().int() }) }).optional(),
  }).optional(),
}).passthrough();

type Destination = NonNullable<Awaited<ReturnType<typeof authorizedDestination>>>;

async function authorizedDestination(userId: number, chatId?: number) {
  if (chatId === undefined) return null;
  return db.telegramDestination.findFirst({
    where: {
      telegramUserId: BigInt(userId), chatId: BigInt(chatId), enabled: true, pairedAt: { not: null },
    },
  });
}

async function providerFor(accountId: string) {
  return new MicrosoftGraphProvider(await accessTokenForAccount(accountId));
}

async function showHome(destination: Destination) {
  await sendTelegramMessage(destination.chatId, homeMessage(), [
    [{ text: "✉️ New email", callback_data: "compose:auto" }],
    [
      { text: "📥 Recent", callback_data: "recent:list" },
      { text: "📝 Drafts", callback_data: "drafts:list" },
    ],
    [
      { text: "📤 Sent", callback_data: "sent:list" },
      { text: "🟢 Status", callback_data: "status:view" },
    ],
  ]);
}

async function activeConversation(destination: Destination) {
  const state = await db.telegramConversationState.findFirst({
    where: { destinationId: destination.id, activeDraftId: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  if (!state?.activeDraftId) return null;
  const draft = await db.emailDraft.findFirst({
    where: { id: state.activeDraftId, account: { userId: destination.userId } },
  });
  if (!draft || !["DRAFT", "READY"].includes(draft.status)) {
    await db.telegramConversationState.delete({ where: { id: state.id } });
    return null;
  }
  return { state, draft };
}

async function promptForConversation(destination: Destination, state: { state: string; activeDraftId: string | null }) {
  if (!state.activeDraftId) return;
  const draft = await db.emailDraft.findFirst({
    where: { id: state.activeDraftId, account: { userId: destination.userId } },
    select: { replyType: true },
  });
  if (state.state === "AWAITING_RECIPIENT") {
    await sendTelegramMessage(destination.chatId, composePrompt("recipient"), undefined, true);
  } else if (state.state === "AWAITING_SUBJECT") {
    await sendTelegramMessage(destination.chatId, composePrompt("subject"), undefined, true);
  } else if (state.state === "AWAITING_BODY") {
    await sendTelegramMessage(destination.chatId,
      draft?.replyType === "NEW"
        ? composePrompt("body")
        : "✍️ <b>Write your reply</b>\n\nYou will review everything before it is sent. Use /cancel to discard.",
      undefined,
      true);
  } else if (state.state === "AWAITING_ATTACHMENT") {
    await sendTelegramMessage(destination.chatId,
      "📎 <b>Add attachments</b>\n\nSend photos or files, then tap Done.",
      [[{ text: "✅ Done", callback_data: `doneattach:${state.activeDraftId}` }]]);
  } else {
    await showDraft(destination, state.activeDraftId);
  }
}

async function beginNewEmail(destination: Destination, requestedAccountId?: string) {
  const active = await activeConversation(destination);
  if (active) {
    await sendTelegramMessage(destination.chatId, "You already have an email in progress. Finish or discard it first.");
    await promptForConversation(destination, active.state);
    return false;
  }

  const accounts = await db.emailAccount.findMany({
    where: {
      userId: destination.userId,
      enabled: true,
      connectionStatus: "CONNECTED",
      ...(requestedAccountId ? { id: requestedAccountId } : {}),
    },
    orderBy: { emailAddress: "asc" },
  });
  if (!accounts.length) {
    await sendTelegramMessage(destination.chatId, "No connected Outlook account is available. Use /status to check the connection.");
    return false;
  }
  if (!requestedAccountId && accounts.length > 1) {
    await sendTelegramMessage(destination.chatId, "✉️ <b>New email</b>\n\nWhich account should send it?", accounts.map((account) => [{
      text: account.emailAddress,
      callback_data: `compose:${account.id}`,
    }]));
    return false;
  }

  const account = accounts[0];
  const provider = await providerFor(account.id);
  const remote = await provider.createDraft({ recipients: [], subject: "", body: "" });
  try {
    const draft = await db.emailDraft.create({
      data: {
        accountId: account.id,
        providerDraftId: remote.id,
        replyType: "NEW",
        recipients: [],
        subject: "",
        body: "",
      },
    });
    const state = await db.telegramConversationState.create({
      data: {
        destinationId: destination.id,
        activeDraftId: draft.id,
        state: "AWAITING_RECIPIENT",
        expectedInput: "EMAIL_ADDRESSES",
      },
    });
    await writeAudit({
      userId: destination.userId,
      action: "EMAIL_DRAFT_CREATED",
      entityType: "EmailDraft",
      entityId: draft.id,
      metadata: { kind: "NEW", accountId: account.id },
    });
    await promptForConversation(destination, state);
    return true;
  } catch (error) {
    await provider.deleteDraft(remote.id).catch(() => undefined);
    throw error;
  }
}

async function cancelActiveDraft(destination: Destination) {
  const active = await activeConversation(destination);
  if (!active) {
    await sendTelegramMessage(destination.chatId, "There is no active draft to discard.");
    return false;
  }
  await (await providerFor(active.draft.accountId)).deleteDraft(active.draft.providerDraftId).catch(() => undefined);
  await db.$transaction([
    db.emailDraft.update({ where: { id: active.draft.id }, data: { status: "CANCELLED" } }),
    db.telegramConversationState.deleteMany({
      where: { destinationId: destination.id, activeDraftId: active.draft.id },
    }),
  ]);
  await writeAudit({
    userId: destination.userId,
    action: "EMAIL_DRAFT_CANCELLED",
    entityType: "EmailDraft",
    entityId: active.draft.id,
  });
  await sendTelegramMessage(destination.chatId, "🗑 <b>Draft discarded.</b>", [
    [{ text: "✉️ Write another", callback_data: "compose:auto" }],
    [{ text: "🏠 Main menu", callback_data: "home:menu" }],
  ]);
  return true;
}

async function setConversationState(
  destination: Destination,
  draftId: string,
  state: string,
  expectedInput: string | null,
) {
  await db.$transaction([
    db.telegramConversationState.deleteMany({
      where: { destinationId: destination.id, activeDraftId: { not: draftId } },
    }),
    db.telegramConversationState.upsert({
      where: { destinationId_activeDraftId: { destinationId: destination.id, activeDraftId: draftId } },
      create: { destinationId: destination.id, activeDraftId: draftId, state, expectedInput },
      update: { state, expectedInput },
    }),
  ]);
}

async function showDraft(destination: Destination, draftId: string) {
  const draft = await db.emailDraft.findFirstOrThrow({
    where: { id: draftId, account: { userId: destination.userId } }, include: { attachments: true },
  });
  const recipients = draft.recipients as Array<{ address: string }>;
  const attachmentButtons = draft.attachments.slice(0, 8).map((attachment) => [{
    text: `🗑 Remove ${truncate(attachment.filename, 28)}`,
    callback_data: `remove:${attachment.id}`,
  }]);
  await sendTelegramMessage(destination.chatId, draftPreview({
    to: recipients.map((item) => item.address), subject: draft.subject,
    body: draft.body, attachmentCount: draft.attachments.length,
    attachmentNames: draft.attachments.map((attachment) => attachment.filename),
    kind: draft.replyType === "NEW" ? "new" : "reply",
  }), [
    [{ text: "🚀 Send email", callback_data: `send:${draft.id}` }],
    ...(draft.replyType === "NEW" ? [[
      { text: "🎯 To", callback_data: `editto:${draft.id}` },
      { text: "🏷 Subject", callback_data: `editsubject:${draft.id}` },
      { text: "✏️ Message", callback_data: `editbody:${draft.id}` },
    ]] : [[{ text: "✏️ Edit reply", callback_data: `editbody:${draft.id}` }]]),
    [{ text: "📎 Add photos/files", callback_data: `attach:${draft.id}` }],
    ...attachmentButtons,
    [{ text: "🗑 Discard", callback_data: `cancel:${draft.id}` }],
  ]);
}

async function beginReply(destination: Destination, messageId: string, replyAll: boolean) {
  const active = await activeConversation(destination);
  if (active) {
    await sendTelegramMessage(destination.chatId, "You already have an email in progress. Finish or discard it first.");
    await promptForConversation(destination, active.state);
    return false;
  }
  const message = await db.emailMessage.findFirst({
    where: { id: messageId, account: { userId: destination.userId } }, include: { account: true },
  });
  if (!message) throw new Error("Email not found");
  const provider = await providerFor(message.accountId);
  const remote = await provider.createReplyDraft(message.providerMessageId, replyAll);
  try {
    const remoteDraft = await provider.getDraft(remote.id);
    const draft = await db.emailDraft.create({
      data: {
        accountId: message.accountId,
        originalMessageId: message.id,
        providerDraftId: remote.id,
        replyType: replyAll ? "REPLY_ALL" : "REPLY",
        recipients: remoteDraft.recipients as Prisma.InputJsonValue,
        subject: remoteDraft.subject,
        body: "",
      },
    });
    await db.telegramConversationState.create({
      data: { destinationId: destination.id, activeDraftId: draft.id, state: "AWAITING_BODY", expectedInput: "TEXT" },
    });
    await sendTelegramMessage(destination.chatId, "✍️ <b>Write your reply</b>\n\nYou will review everything before it is sent. Use /cancel to discard.", undefined, true);
    return true;
  } catch (error) {
    await provider.deleteDraft(remote.id).catch(() => undefined);
    throw error;
  }
}

async function handleText(destination: Destination, text: string) {
  if (text.startsWith("/")) return handleCommand(destination, text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, ""));
  const state = await db.telegramConversationState.findFirst({
    where: {
      destinationId: destination.id,
      state: { in: ["AWAITING_RECIPIENT", "AWAITING_SUBJECT", "AWAITING_BODY"] },
      activeDraftId: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!state?.activeDraftId) {
    await sendTelegramMessage(destination.chatId, "Choose an action first.", [
      [{ text: "✉️ New email", callback_data: "compose:auto" }],
      [{ text: "📥 Recent mail", callback_data: "recent:list" }],
    ]);
    return;
  }
  const draft = await db.emailDraft.findFirstOrThrow({
    where: { id: state.activeDraftId, account: { userId: destination.userId } },
  });
  const provider = await providerFor(draft.accountId);
  const currentRecipients = draft.recipients as Array<{ name?: string; address: string }>;
  if (state.state === "AWAITING_RECIPIENT") {
    let recipients: Array<{ address: string }>;
    try {
      recipients = parseRecipients(text);
    } catch {
      await sendTelegramMessage(destination.chatId,
        "That email address does not look valid. Try again, separating multiple addresses with commas.",
        undefined, true);
      return;
    }
    await provider.updateDraft(draft.providerDraftId, {
      subject: draft.subject,
      body: draft.body,
      recipients,
    });
    await db.$transaction([
      db.emailDraft.update({
        where: { id: draft.id },
        data: { recipients: recipients as Prisma.InputJsonValue },
      }),
      db.telegramConversationState.update({
        where: { id: state.id },
        data: { state: "AWAITING_SUBJECT", expectedInput: "TEXT" },
      }),
    ]);
    await sendTelegramMessage(destination.chatId, composePrompt("subject"), undefined, true);
    return;
  }
  if (state.state === "AWAITING_SUBJECT") {
    let subject: string;
    try {
      subject = validateSubject(text);
    } catch (error) {
      await sendTelegramMessage(destination.chatId, error instanceof Error ? error.message : "Enter a valid subject.", undefined, true);
      return;
    }
    await provider.updateDraft(draft.providerDraftId, {
      subject,
      body: draft.body,
      recipients: currentRecipients,
    });
    await db.$transaction([
      db.emailDraft.update({ where: { id: draft.id }, data: { subject } }),
      db.telegramConversationState.update({
        where: { id: state.id },
        data: { state: "AWAITING_BODY", expectedInput: "TEXT" },
      }),
    ]);
    await sendTelegramMessage(destination.chatId, composePrompt("body"), undefined, true);
    return;
  }
  let body: string;
  try {
    body = validateBody(text);
  } catch (error) {
    await sendTelegramMessage(destination.chatId, error instanceof Error ? error.message : "Enter a valid message.", undefined, true);
    return;
  }
  await provider.updateDraft(draft.providerDraftId, {
    subject: draft.subject,
    body,
    recipients: currentRecipients,
  });
  await db.$transaction([
    db.emailDraft.update({ where: { id: draft.id }, data: { body, status: "READY" } }),
    db.telegramConversationState.update({ where: { id: state.id }, data: { state: "READY", expectedInput: null } }),
  ]);
  await showDraft(destination, draft.id);
}

async function handleAttachment(
  destination: Destination,
  input: z.infer<typeof fileSchema>,
  kind: TelegramAttachmentKind,
  receivedAt: Date,
) {
  const state = await db.telegramConversationState.findFirst({
    where: { destinationId: destination.id, state: "AWAITING_ATTACHMENT", activeDraftId: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  if (!state?.activeDraftId) {
    await sendTelegramMessage(destination.chatId, "Open an email draft and tap Add photos/files first.");
    return;
  }
  if ((input.file_size ?? 0) > MAX_ATTACHMENT_BYTES) {
    await sendTelegramMessage(destination.chatId, "That file is over Telegram's 20 MB bot download limit.");
    return;
  }
  const draft = await db.emailDraft.findFirstOrThrow({
    where: { id: state.activeDraftId, account: { userId: destination.userId } },
    include: { attachments: true },
  });
  if (!["DRAFT", "READY"].includes(draft.status)) {
    await sendTelegramMessage(destination.chatId, "This draft is no longer editable.");
    return;
  }
  if (draft.attachments.length >= MAX_DRAFT_ATTACHMENTS) {
    await sendTelegramMessage(destination.chatId, `An email can contain at most ${MAX_DRAFT_ATTACHMENTS} attachments.`);
    return;
  }
  const existing = await db.emailAttachment.findFirst({
    where: { draftId: draft.id, telegramFileId: input.file_id },
  });
  if (existing) {
    await sendTelegramMessage(destination.chatId, `✅ ${escapeHtml(existing.filename)} is already attached.`);
    return;
  }

  const download = await getTelegramFile(input.file_id);
  if (download.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    await sendTelegramMessage(destination.chatId, "That file exceeded Telegram's 20 MB bot download limit.");
    return;
  }
  const existingBytes = draft.attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0n);
  if (existingBytes + BigInt(download.bytes.byteLength) > BigInt(MAX_DRAFT_ATTACHMENT_BYTES)) {
    await sendTelegramMessage(destination.chatId, "The email would exceed the safe 25 MB total attachment limit.");
    return;
  }
  const { filename, mimeType } = normalizeTelegramAttachment(input, kind, download, receivedAt);
  const provider = await providerFor(draft.accountId);
  const remote = await provider.addDraftAttachment(
    draft.providerDraftId, { filename, mimeType, bytes: download.bytes },
  );
  try {
    await db.emailAttachment.create({
      data: {
        draftId: draft.id, providerAttachmentId: remote.id, telegramFileId: input.file_id,
        filename, mimeType, sizeBytes: BigInt(download.bytes.byteLength),
      },
    });
  } catch (error) {
    await provider.removeDraftAttachment(draft.providerDraftId, remote.id).catch(() => undefined);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await sendTelegramMessage(destination.chatId, `✅ ${escapeHtml(filename)} is already attached.`);
      return;
    }
    throw error;
  }

  const attachmentCount = await db.emailAttachment.count({ where: { draftId: draft.id } });
  await sendTelegramMessage(
    destination.chatId,
    `✅ <b>Attached:</b> ${escapeHtml(filename)}\n${attachmentCount} file${attachmentCount === 1 ? "" : "s"} attached. Send more, or tap Done.`,
    [[
      { text: "✅ Done adding", callback_data: `doneattach:${draft.id}` },
      { text: "✉️ Send now", callback_data: `send:${draft.id}` },
    ]],
  );
}

async function handleCommand(destination: Destination, command: string) {
  if (command === "/start" || command === "/menu") {
    await showHome(destination);
    return;
  }
  if (command === "/help") {
    await sendTelegramMessage(destination.chatId,
      "✨ <b>MailPulse help</b>\n\n/new — write a new email\n/inbox — recent inbox\n/drafts — saved drafts\n/scheduled — pending sends\n/sent — sent emails\n/status — connections\n/settings — preferences\n/cancel — discard the active draft\n/menu — main menu",
      [[{ text: "🏠 Open main menu", callback_data: "home:menu" }]],
    );
    return;
  }
  if (command === "/new" || command === "/compose") {
    await beginNewEmail(destination);
    return;
  }
  if (command === "/cancel") {
    await cancelActiveDraft(destination);
    return;
  }
  if (command === "/test") { await sendTelegramMessage(destination.chatId, "✅ MailPulse is connected to this private chat."); return; }
  if (command === "/pause" || command === "/resume") {
    const enabled = command === "/resume";
    await db.emailAccount.updateMany({ where: { userId: destination.userId }, data: { notificationsOn: enabled } });
    await sendTelegramMessage(destination.chatId, enabled ? "▶️ Email notifications resumed." : "⏸ Email notifications paused.");
    return;
  }
  if (command === "/status" || command === "/accounts") {
    const accounts = await db.emailAccount.findMany({ where: { userId: destination.userId } });
    await sendTelegramMessage(destination.chatId, accounts.length
      ? ["🟢 <b>MailPulse status</b>", "", ...accounts.map((account) =>
        `📧 ${escapeHtml(account.emailAddress)}\n   ${account.connectionStatus === "CONNECTED" ? "✅ Connected" : `⚠️ ${account.connectionStatus}`} · ${account.notificationsOn ? "Notifications on" : "Paused"}`,
      )].join("\n")
      : "No email account is connected.", [[{ text: "🏠 Main menu", callback_data: "home:menu" }]]);
    return;
  }
  if (command === "/settings") {
    const settings = await db.applicationSettings.findUnique({ where: { userId: destination.userId } });
    await sendTelegramMessage(destination.chatId,
      `⚙️ <b>Settings</b>\nUndo window: ${settings?.undoSendSeconds ?? config().UNDO_SEND_SECONDS} seconds\nTimezone: ${escapeHtml(settings?.timezone ?? config().DEFAULT_TIMEZONE)}`,
    );
    return;
  }
  if (command === "/recent" || command === "/inbox") {
    const messages = await db.emailMessage.findMany({
      where: { account: { userId: destination.userId } }, orderBy: { receivedAt: "desc" }, take: 10,
    });
    if (!messages.length) {
      await sendTelegramMessage(destination.chatId, "📭 <b>Your inbox is clear.</b>", [
        [{ text: "✉️ Write a new email", callback_data: "compose:auto" }],
      ]);
      return;
    }
    await sendTelegramMessage(destination.chatId, "📥 <b>Recent mail</b>\n\nChoose a message to reply.");
    for (const message of messages) {
      await sendTelegramMessage(destination.chatId,
        `<b>${escapeHtml(message.subject)}</b>\n👤 ${escapeHtml(message.senderAddress)}`,
        [
          [{ text: "📖 Read full email", callback_data: `read:${message.id}` }],
          [{ text: "↩️ Reply", callback_data: `reply:${message.id}` }, { text: "↩️ Reply all", callback_data: `replyall:${message.id}` }],
        ],
      );
    }
    return;
  }
  if (["/drafts", "/scheduled", "/sent"].includes(command)) {
    const statuses = command === "/drafts" ? ["DRAFT", "READY"] : command === "/scheduled" ? ["SCHEDULED"] : ["SENT"];
    const drafts = await db.emailDraft.findMany({
      where: { account: { userId: destination.userId }, status: { in: statuses as never[] } },
      orderBy: { updatedAt: "desc" }, take: 10,
    });
    if (!drafts.length) {
      await sendTelegramMessage(destination.chatId, `No ${command.slice(1)} messages.`, [
        [{ text: "✉️ Write a new email", callback_data: "compose:auto" }],
      ]);
      return;
    }
    await sendTelegramMessage(destination.chatId,
      command === "/drafts" ? "📝 <b>Drafts</b>" : command === "/scheduled" ? "⏳ <b>Scheduled</b>" : "📤 <b>Recently sent</b>");
    for (const draft of drafts) {
      await sendTelegramMessage(destination.chatId,
        `${draft.replyType === "NEW" ? "✉️" : "↩️"} <b>${escapeHtml(draft.subject || "(no subject)")}</b>\n${draft.status}`,
        command === "/drafts" ? [[{ text: "Open draft", callback_data: `view:${draft.id}` }]] : undefined);
    }
    return;
  }
  await sendTelegramMessage(destination.chatId, "I do not recognize that command.", [
    [{ text: "🏠 Main menu", callback_data: "home:menu" }],
  ]);
}

async function handleCallback(destination: Destination, id: string, data: string) {
  const [action, objectId] = data.split(":", 2);
  if (!objectId) { await answerCallbackQuery(id, "Invalid action.", true); return; }
  const commandActions: Record<string, string> = {
    recent: "/recent",
    drafts: "/drafts",
    sent: "/sent",
    status: "/status",
    home: "/menu",
  };
  if (commandActions[action]) {
    await answerCallbackQuery(id, "Opening…");
    await handleCommand(destination, commandActions[action]);
    return;
  }
  if (action === "compose") {
    await answerCallbackQuery(id, "Starting a new email…");
    await beginNewEmail(destination, objectId === "auto" ? undefined : objectId);
    return;
  }
  if (action === "read") {
    const message = await db.emailMessage.findFirst({
      where: { id: objectId, account: { userId: destination.userId } },
      select: {
        accountId: true,
        providerMessageId: true,
        senderName: true,
        senderAddress: true,
        subject: true,
      },
    });
    if (!message) {
      await answerCallbackQuery(id, "Email not found.", true);
      return;
    }

    await answerCallbackQuery(id, "Loading the full email…");
    try {
      const body = await (await providerFor(message.accountId)).getMessageBody(message.providerMessageId);
      const sender = message.senderName
        ? `${escapeHtml(message.senderName)} &lt;${escapeHtml(message.senderAddress)}&gt;`
        : escapeHtml(message.senderAddress);
      await sendTelegramMessage(destination.chatId, [
        "📖 <b>FULL EMAIL</b>",
        "",
        `👤 From: ${sender}`,
        `📌 Subject: ${escapeHtml(message.subject)}`,
      ].join("\n"));

      const replyButtons = [[
        { text: "↩️ Reply", callback_data: `reply:${objectId}` },
        { text: "↩️ Reply all", callback_data: `replyall:${objectId}` },
      ]];
      if (body.length > TELEGRAM_EMAIL_FILE_THRESHOLD) {
        const fileText = [
          `From: ${message.senderName ? `${message.senderName} <${message.senderAddress}>` : message.senderAddress}`,
          `Subject: ${message.subject}`,
          "",
          body || "(This email has no text body.)",
        ].join("\n");
        await sendTelegramDocument(
          destination.chatId,
          fullEmailFilename(message.subject),
          "text/plain; charset=utf-8",
          new TextEncoder().encode(fileText),
          "The complete email is attached as a text file.",
        );
        await sendTelegramMessage(destination.chatId, "What would you like to do?", replyButtons);
        return;
      }

      const chunks = splitTelegramEmail(body);
      for (const [index, chunk] of chunks.entries()) {
        await sendTelegramPlainMessage(
          destination.chatId,
          chunks.length > 1 ? `${index + 1}/${chunks.length}\n\n${chunk}` : chunk,
          index === chunks.length - 1 ? replyButtons : undefined,
        );
      }
    } catch (error) {
      logger.error({ err: error, messageId: objectId }, "Full email delivery failed");
      await sendTelegramMessage(
        destination.chatId,
        "I could not load the full email right now. Please try again in a moment.",
      );
    }
    return;
  }
  if (action === "reply" || action === "replyall") {
    const created = await beginReply(destination, objectId, action === "replyall");
    await answerCallbackQuery(id, created ? "Reply draft created." : "Open draft already in progress.");
    return;
  }
  if (action === "view") {
    const ownedDraft = await db.emailDraft.findFirst({
      where: {
        id: objectId,
        account: { userId: destination.userId },
        status: { in: ["DRAFT", "READY"] },
      },
      select: { id: true },
    });
    if (!ownedDraft) {
      await answerCallbackQuery(id, "Draft not found.", true);
      return;
    }
    await answerCallbackQuery(id, "Opening draft…");
    await setConversationState(destination, ownedDraft.id, "READY", null);
    await showDraft(destination, ownedDraft.id);
    return;
  }
  if (action === "files") {
    const message = await db.emailMessage.findFirst({
      where: { id: objectId, account: { userId: destination.userId } }, include: { attachments: true },
    });
    if (!message) { await answerCallbackQuery(id, "Email not found.", true); return; }
    const provider = await providerFor(message.accountId);
    for (const attachment of message.attachments) {
      if (!attachment.providerAttachmentId || attachment.sizeBytes > BigInt(20 * 1024 * 1024)) continue;
      await sendTelegramDocument(destination.chatId, attachment.filename, attachment.mimeType,
        await provider.downloadMessageAttachment(message.providerMessageId, attachment.providerAttachmentId));
    }
    await answerCallbackQuery(id, "Attachments delivered.");
    return;
  }
  if (action === "remove") {
    const attachment = await db.emailAttachment.findFirst({
      where: { id: objectId, draft: { account: { userId: destination.userId } } },
      include: { draft: true },
    });
    if (!attachment?.draft) { await answerCallbackQuery(id, "Attachment not found.", true); return; }
    if (!["DRAFT", "READY"].includes(attachment.draft.status)) {
      await answerCallbackQuery(id, "This draft is no longer editable.", true);
      return;
    }
    if (attachment.providerAttachmentId) {
      await (await providerFor(attachment.draft.accountId)).removeDraftAttachment(
        attachment.draft.providerDraftId,
        attachment.providerAttachmentId,
      );
    }
    await db.emailAttachment.delete({ where: { id: attachment.id } });
    await answerCallbackQuery(id, "Attachment removed.");
    await showDraft(destination, attachment.draft.id);
    return;
  }
  const draft = action === "undo" ? null : await db.emailDraft.findFirst({
    where: { id: objectId, account: { userId: destination.userId } }, include: { attachments: true },
  });
  if (action !== "undo" && !draft) { await answerCallbackQuery(id, "Draft not found.", true); return; }

  if (["editto", "editsubject", "editbody"].includes(action) && draft) {
    if (!["DRAFT", "READY"].includes(draft.status)) {
      await answerCallbackQuery(id, "This draft is no longer editable.", true);
      return;
    }
    if ((action === "editto" || action === "editsubject") && draft.replyType !== "NEW") {
      await answerCallbackQuery(id, "Reply recipients and subjects stay linked to the original email.", true);
      return;
    }
    const nextState = action === "editto"
      ? "AWAITING_RECIPIENT"
      : action === "editsubject"
        ? "AWAITING_SUBJECT"
        : "AWAITING_BODY";
    await setConversationState(destination, draft.id, nextState, action === "editto" ? "EMAIL_ADDRESSES" : "TEXT");
    await answerCallbackQuery(id, "Ready to edit.");
    if (action === "editto") {
      await sendTelegramMessage(destination.chatId, composePrompt("recipient"), undefined, true);
    } else if (action === "editsubject") {
      await sendTelegramMessage(destination.chatId, composePrompt("subject"), undefined, true);
    } else {
      await sendTelegramMessage(destination.chatId,
        draft.replyType === "NEW" ? composePrompt("body") : "✍️ <b>Edit your reply</b>\n\nSend the complete replacement text. Use /cancel to discard.",
        undefined, true);
    }
    return;
  }

  if (action === "attach" && draft) {
    if (!["DRAFT", "READY"].includes(draft.status)) {
      await answerCallbackQuery(id, "This draft is no longer editable.", true);
      return;
    }
    await setConversationState(destination, draft.id, "AWAITING_ATTACHMENT", "ATTACHMENT");
    await sendTelegramMessage(
      destination.chatId,
      "📎 <b>Attachment mode</b>\n\nSend one or several photos/files (20 MB maximum each), then tap Done.",
      [[{ text: "✅ Done", callback_data: `doneattach:${draft.id}` }]],
    );
    await answerCallbackQuery(id, "Ready for photos and files.");
    return;
  }
  if (action === "doneattach" && draft) {
    await setConversationState(destination, draft.id, "READY", null);
    await answerCallbackQuery(id, "Attachments saved.");
    await showDraft(destination, draft.id);
    return;
  }
  if (action === "send" && draft) {
    if (["SCHEDULED", "SENDING", "SENT"].includes(draft.status)) {
      await answerCallbackQuery(id, draft.status === "SENT" ? "This email was already sent." : "This email is already scheduled.");
      return;
    }
    const recipients = draft.recipients as Array<{ address: string }>;
    if (!recipients.length || recipients.some((recipient) => !recipient.address)) {
      await answerCallbackQuery(id, "Add at least one recipient before sending.", true);
      return;
    }
    if (!draft.subject.trim() || !draft.body.trim()) {
      await answerCallbackQuery(id, "Complete the subject and message before sending.", true);
      return;
    }
    await assertSendQuota(destination.userId);
    const result = await scheduleServerlessSend(draft.id);
    await writeAudit({ userId: destination.userId, action: "EMAIL_SCHEDULED", entityType: "OutgoingMessage", entityId: result.outgoing.id });
    await db.telegramConversationState.deleteMany({
      where: { destinationId: destination.id, activeDraftId: draft.id },
    });
    await sendTelegramMessage(destination.chatId, scheduledMessage({
      to: recipients.map((x) => x.address), subject: draft.subject,
      attachmentCount: draft.attachments.length, deadline: result.outgoing.cancellationDeadline!,
      undoSeconds: config().UNDO_SEND_SECONDS,
    }), [[{ text: "↩️ Undo send", callback_data: `undo:${result.outgoing.id}` }]]);
    await answerCallbackQuery(id, "Scheduled. You have 10 seconds to undo.");
    return;
  }
  if (action === "cancel" && draft) {
    await (await providerFor(draft.accountId)).deleteDraft(draft.providerDraftId).catch(() => undefined);
    await db.$transaction([
      db.emailDraft.update({ where: { id: draft.id }, data: { status: "CANCELLED" } }),
      db.telegramConversationState.deleteMany({ where: { destinationId: destination.id, activeDraftId: draft.id } }),
    ]);
    await writeAudit({
      userId: destination.userId,
      action: "EMAIL_DRAFT_CANCELLED",
      entityType: "EmailDraft",
      entityId: draft.id,
    });
    await answerCallbackQuery(id, "Draft cancelled.");
    await sendTelegramMessage(destination.chatId, "🗑 <b>Draft discarded.</b>", [
      [{ text: "✉️ Write another", callback_data: "compose:auto" }],
      [{ text: "🏠 Main menu", callback_data: "home:menu" }],
    ]);
    return;
  }
  if (action === "undo") {
    const outgoing = await db.outgoingMessage.findUnique({
      where: { id: objectId }, include: { draft: { include: { account: true } } },
    });
    if (!outgoing || outgoing.draft.account.userId !== destination.userId) {
      await answerCallbackQuery(id, "Message not found.", true); return;
    }
    const result = await new OutgoingService(db, config().UNDO_SEND_SECONDS).undo(objectId);
    if (result === "CANCELLED") {
      await writeAudit({ userId: destination.userId, action: "EMAIL_SEND_UNDONE", entityType: "OutgoingMessage", entityId: objectId });
      await answerCallbackQuery(id, "Email sending cancelled.");
      await sendTelegramMessage(destination.chatId, "✅ <b>Email sending cancelled.</b>\n\nYour email has not been sent.");
    } else await answerCallbackQuery(id, "Too late to cancel: sending has already started.", true);
    return;
  }
  await answerCallbackQuery(id, "Unknown action.", true);
}

export async function POST(request: Request) {
  if (request.headers.get("x-telegram-bot-api-secret-token") !== config().TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid update", { status: 400 });
  const updateId = BigInt(parsed.data.update_id);
  try {
    await db.telegramProcessedUpdate.create({ data: { updateId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return new Response(null, { status: 204 });
    throw error;
  }

  try {
    const callback = parsed.data.callback_query;
    if (callback?.data) {
      const destination = await authorizedDestination(callback.from.id, callback.message?.chat.id);
      if (!destination) await answerCallbackQuery(callback.id, "This action is not authorized.", true);
      else await handleCallback(destination, callback.id, callback.data);
    } else if (parsed.data.message?.from) {
      const message = parsed.data.message;
      const sender = message.from!;
      const destination = await authorizedDestination(sender.id, message.chat.id);
      if (destination) {
        const photo = message.photo?.at(-1);
        const attachment = message.document ?? photo;
        if (attachment) {
          const receivedAt = new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000);
          await handleAttachment(destination, attachment, message.document ? "document" : "photo", receivedAt);
        } else if (message.text) await handleText(destination, message.text);
      } else if (message.chat.id === sender.id && message.text) {
        const match = message.text.trim().match(/^\/start(?:@\w+)?\s+(MP-\d{6})$/i);
        if (match) {
          const paired = await redeemTelegramPairingCode(match[1], BigInt(sender.id), BigInt(message.chat.id));
          await sendTelegramMessage(BigInt(message.chat.id), paired
            ? "✅ <b>Telegram paired.</b>\n\nUse /status to confirm your mailbox connection."
            : "This pairing code is invalid, expired, or already used.");
        }
      }
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    logger.error({ err: error, updateId: updateId.toString() }, "Telegram update failed");
    await db.telegramProcessedUpdate.delete({ where: { updateId } }).catch(() => undefined);
    throw error;
  }
}
