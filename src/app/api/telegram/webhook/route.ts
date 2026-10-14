import { Prisma } from "@prisma/client";
import { z } from "zod";
import { accessTokenForAccount } from "@/auth/microsoft-tokens";
import { config } from "@/config";
import { db } from "@/lib/db";
import { MicrosoftGraphProvider } from "@/providers/microsoft-graph";
import { OutgoingService } from "@/services/outgoing";
import { scheduleServerlessSend } from "@/services/qstash-scheduler";
import {
  answerCallbackQuery, getTelegramFile, sendTelegramDocument, sendTelegramMessage,
} from "@/telegram/client";
import { draftPreview, escapeHtml, scheduledMessage } from "@/telegram/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fileSchema = z.object({ file_id: z.string(), file_name: z.string().optional(), mime_type: z.string().optional(), file_size: z.number().int().optional() });
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z.object({
    from: z.object({ id: z.number().int() }).optional(),
    chat: z.object({ id: z.number().int() }),
    text: z.string().optional(),
    document: fileSchema.optional(),
    photo: z.array(fileSchema).optional(),
    caption: z.string().optional(),
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

async function showDraft(destination: Destination, draftId: string) {
  const draft = await db.emailDraft.findFirstOrThrow({
    where: { id: draftId, account: { userId: destination.userId } }, include: { attachments: true },
  });
  const recipients = draft.recipients as Array<{ address: string }>;
  await sendTelegramMessage(destination.chatId, draftPreview({
    to: recipients.map((item) => item.address), subject: draft.subject,
    body: draft.body, attachmentCount: draft.attachments.length,
  }), [[
    { text: "📎 Add attachment", callback_data: `attach:${draft.id}` },
    { text: "✅ Send", callback_data: `send:${draft.id}` },
  ], [{ text: "🗑 Cancel", callback_data: `cancel:${draft.id}` }]]);
}

async function beginReply(destination: Destination, messageId: string, replyAll: boolean) {
  const message = await db.emailMessage.findFirst({
    where: { id: messageId, account: { userId: destination.userId } }, include: { account: true },
  });
  if (!message) throw new Error("Email not found");
  const provider = await providerFor(message.accountId);
  const remote = await provider.createReplyDraft(message.providerMessageId, replyAll);
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
  await sendTelegramMessage(destination.chatId, "✍️ <b>Type your reply.</b>\n\nI will show a preview before anything is sent.", undefined, true);
}

async function handleText(destination: Destination, text: string) {
  if (text.startsWith("/")) return handleCommand(destination, text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, ""));
  const state = await db.telegramConversationState.findFirst({
    where: { destinationId: destination.id, state: "AWAITING_BODY", activeDraftId: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  if (!state?.activeDraftId) {
    await sendTelegramMessage(destination.chatId, "Use /recent to choose an email, then tap Reply.");
    return;
  }
  const draft = await db.emailDraft.findFirstOrThrow({
    where: { id: state.activeDraftId, account: { userId: destination.userId } },
  });
  await (await providerFor(draft.accountId)).updateDraft(draft.providerDraftId, {
    subject: draft.subject,
    body: text,
    recipients: draft.recipients as Array<{ name?: string; address: string }>,
  });
  await db.$transaction([
    db.emailDraft.update({ where: { id: draft.id }, data: { body: text, status: "READY" } }),
    db.telegramConversationState.update({ where: { id: state.id }, data: { state: "READY", expectedInput: null } }),
  ]);
  await showDraft(destination, draft.id);
}

async function handleAttachment(destination: Destination, input: z.infer<typeof fileSchema>) {
  const state = await db.telegramConversationState.findFirst({
    where: { destinationId: destination.id, state: "AWAITING_ATTACHMENT", activeDraftId: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  if (!state?.activeDraftId) {
    await sendTelegramMessage(destination.chatId, "Tap Add attachment on a reply preview first.");
    return;
  }
  if ((input.file_size ?? 0) > 20 * 1024 * 1024) {
    await sendTelegramMessage(destination.chatId, "That file is over Telegram's 20 MB bot download limit.");
    return;
  }
  const draft = await db.emailDraft.findFirstOrThrow({
    where: { id: state.activeDraftId, account: { userId: destination.userId } },
  });
  const bytes = await getTelegramFile(input.file_id);
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Telegram file exceeded 20 MB after download");
  const filename = (input.file_name || "attachment").replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").slice(0, 180);
  const mimeType = input.mime_type || "application/octet-stream";
  const remote = await (await providerFor(draft.accountId)).addDraftAttachment(
    draft.providerDraftId, { filename, mimeType, bytes },
  );
  await db.$transaction([
    db.emailAttachment.create({
      data: {
        draftId: draft.id, providerAttachmentId: remote.id, telegramFileId: input.file_id,
        filename, mimeType, sizeBytes: BigInt(bytes.byteLength),
      },
    }),
    db.telegramConversationState.update({ where: { id: state.id }, data: { state: "READY", expectedInput: null } }),
  ]);
  await showDraft(destination, draft.id);
}

async function handleCommand(destination: Destination, command: string) {
  if (command === "/start" || command === "/help") {
    await sendTelegramMessage(destination.chatId,
      "<b>MailPulse commands</b>\n/recent — recent mail\n/drafts — open drafts\n/scheduled — pending sends\n/sent — recently sent\n/status — connections\n/pause — stop notifications\n/resume — resume notifications\n/test — test this chat\n/settings — current settings",
    );
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
    await sendTelegramMessage(destination.chatId, accounts.length ? accounts.map((a) =>
      `📧 ${escapeHtml(a.emailAddress)} — ${a.connectionStatus}${a.notificationsOn ? " — notifications on" : " — paused"}`,
    ).join("\n") : "No email account is connected.");
    return;
  }
  if (command === "/settings") {
    const settings = await db.applicationSettings.findUnique({ where: { userId: destination.userId } });
    await sendTelegramMessage(destination.chatId,
      `⚙️ <b>Settings</b>\nUndo window: ${settings?.undoSendSeconds ?? config().UNDO_SEND_SECONDS} seconds\nTimezone: ${escapeHtml(settings?.timezone ?? config().DEFAULT_TIMEZONE)}`,
    );
    return;
  }
  if (command === "/recent") {
    const messages = await db.emailMessage.findMany({
      where: { account: { userId: destination.userId } }, orderBy: { receivedAt: "desc" }, take: 10,
    });
    if (!messages.length) { await sendTelegramMessage(destination.chatId, "No synchronized email yet."); return; }
    for (const message of messages) {
      await sendTelegramMessage(destination.chatId,
        `📨 <b>${escapeHtml(message.subject)}</b>\nFrom: ${escapeHtml(message.senderAddress)}`,
        [[{ text: "Reply", callback_data: `reply:${message.id}` }, { text: "Reply all", callback_data: `replyall:${message.id}` }]],
      );
    }
    return;
  }
  if (["/drafts", "/scheduled", "/sent"].includes(command)) {
    const statuses = command === "/drafts" ? ["DRAFT", "READY", "CANCELLED"] : command === "/scheduled" ? ["SCHEDULED"] : ["SENT"];
    const drafts = await db.emailDraft.findMany({
      where: { account: { userId: destination.userId }, status: { in: statuses as never[] } },
      orderBy: { updatedAt: "desc" }, take: 10,
    });
    await sendTelegramMessage(destination.chatId, drafts.length
      ? drafts.map((d) => `• ${escapeHtml(d.subject)} — ${d.status}`).join("\n")
      : `No ${command.slice(1)} messages.`);
    return;
  }
  await sendTelegramMessage(destination.chatId, "Unknown command. Use /help.");
}

async function handleCallback(destination: Destination, id: string, data: string) {
  const [action, objectId] = data.split(":", 2);
  if (!objectId) { await answerCallbackQuery(id, "Invalid action.", true); return; }
  if (action === "reply" || action === "replyall") {
    await beginReply(destination, objectId, action === "replyall");
    await answerCallbackQuery(id, "Reply draft created.");
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
  const draft = action === "undo" ? null : await db.emailDraft.findFirst({
    where: { id: objectId, account: { userId: destination.userId } }, include: { attachments: true },
  });
  if (action !== "undo" && !draft) { await answerCallbackQuery(id, "Draft not found.", true); return; }

  if (action === "attach" && draft) {
    await db.telegramConversationState.updateMany({
      where: { destinationId: destination.id, activeDraftId: draft.id },
      data: { state: "AWAITING_ATTACHMENT", expectedInput: "DOCUMENT" },
    });
    await sendTelegramMessage(destination.chatId, "📎 Send one document or photo (maximum 20 MB).", undefined, true);
    await answerCallbackQuery(id, "Waiting for attachment.");
    return;
  }
  if (action === "send" && draft) {
    if (["SCHEDULED", "SENDING", "SENT"].includes(draft.status)) {
      await answerCallbackQuery(id, draft.status === "SENT" ? "This email was already sent." : "This email is already scheduled.");
      return;
    }
    const result = await scheduleServerlessSend(draft.id);
    const recipients = draft.recipients as Array<{ address: string }>;
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
    await answerCallbackQuery(id, "Draft cancelled.");
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
      const destination = await authorizedDestination(message.from!.id, message.chat.id);
      if (destination) {
        const photo = message.photo?.at(-1);
        if (message.document || photo) await handleAttachment(destination, message.document ?? photo!);
        else if (message.text) await handleText(destination, message.text);
      }
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    await db.telegramProcessedUpdate.delete({ where: { updateId } }).catch(() => undefined);
    throw error;
  }
}