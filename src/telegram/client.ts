import { config } from "@/config";

type InlineButton = { text: string; callback_data?: string; url?: string };
type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

async function telegram<T>(method: string, payload: unknown): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${config().TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const result = (await response.json()) as TelegramResponse<T>;
  if (!response.ok || !result.ok || result.result === undefined) {
    throw new Error(`Telegram ${method} failed (${response.status}): ${result.description ?? "unknown error"}`);
  }
  return result.result;
}

export function sendTelegramMessage(
  chatId: bigint,
  text: string,
  buttons?: InlineButton[][],
  forceReply = false,
) {
  return telegram<{ message_id: number }>("sendMessage", {
    chat_id: chatId.toString(),
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    ...(forceReply ? { reply_markup: { force_reply: true, selective: true } } : {}),
  });
}

export function sendTelegramPlainMessage(
  chatId: bigint,
  text: string,
  buttons?: InlineButton[][],
) {
  return telegram<{ message_id: number }>("sendMessage", {
    chat_id: chatId.toString(),
    text,
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export function answerCallbackQuery(callbackQueryId: string, text: string, showAlert = false) {
  return telegram<boolean>("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

export async function getTelegramFile(fileId: string): Promise<{ bytes: Uint8Array; filePath: string }> {
  const file = await telegram<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram did not return a file path");
  const response = await fetch(
    `https://api.telegram.org/file/bot${config().TELEGRAM_BOT_TOKEN}/${file.file_path}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`Telegram file download failed (${response.status})`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), filePath: file.file_path };
}

export async function sendTelegramDocument(
  chatId: bigint,
  filename: string,
  mimeType: string,
  bytes: Uint8Array,
  caption?: string,
) {
  const form = new FormData();
  form.set("chat_id", chatId.toString());
  form.set("document", new Blob([Buffer.from(bytes)], { type: mimeType }), filename);
  if (caption) form.set("caption", caption);
  const response = await fetch(`https://api.telegram.org/bot${config().TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const result = (await response.json()) as TelegramResponse<{ message_id: number }>;
  if (!response.ok || !result.ok || !result.result) {
    throw new Error(`Telegram sendDocument failed (${response.status}): ${result.description ?? "unknown error"}`);
  }
  return result.result;
}

export async function configureTelegramWebhook(url: string) {
  return telegram<boolean>("setWebhook", {
    url,
    secret_token: config().TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}

export async function configureTelegramCommands() {
  await telegram<boolean>("setMyCommands", {
    commands: [
      { command: "new", description: "Write a new email" },
      { command: "inbox", description: "View recent inbox messages" },
      { command: "drafts", description: "Open saved drafts" },
      { command: "scheduled", description: "View pending sends" },
      { command: "sent", description: "View sent emails" },
      { command: "status", description: "Check connections" },
      { command: "settings", description: "View MailPulse settings" },
      { command: "menu", description: "Open the main menu" },
      { command: "help", description: "Show help" },
    ],
  });
}
