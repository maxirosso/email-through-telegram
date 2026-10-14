export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function incomingEmailMessage(input: {
  senderName?: string | null;
  senderAddress: string;
  subject: string;
  preview?: string | null;
  receivedAt: Date;
  attachmentCount: number;
}): string {
  const sender = input.senderName
    ? `${escapeHtml(input.senderName)} &lt;${escapeHtml(input.senderAddress)}&gt;`
    : escapeHtml(input.senderAddress);
  const lines = [
    "📨 <b>NEW EMAIL</b>",
    "",
    `👤 From: ${sender}`,
    `📌 Subject: ${escapeHtml(input.subject)}`,
    `🕒 Received: ${escapeHtml(input.receivedAt.toISOString())}`,
  ];
  if (input.attachmentCount) lines.push(`📎 Attachments: ${input.attachmentCount}`);
  if (input.preview) lines.push("", escapeHtml(truncate(input.preview, 2500)));
  return lines.join("\n");
}

export function draftPreview(input: {
  to: string[];
  subject: string;
  body: string;
  attachmentCount: number;
}): string {
  return [
    "📝 <b>REPLY PREVIEW</b>",
    "",
    `👤 To: ${escapeHtml(input.to.join(", "))}`,
    `📌 Subject: ${escapeHtml(input.subject)}`,
    `📎 Attachments: ${input.attachmentCount}`,
    "",
    escapeHtml(truncate(input.body, 2800)),
  ].join("\n");
}

export function scheduledMessage(input: {
  to: string[];
  subject: string;
  attachmentCount: number;
  deadline: Date;
  undoSeconds?: number;
}): string {
  const seconds = input.undoSeconds ?? 10;
  return [
    "⏳ <b>EMAIL SCHEDULED</b>",
    "",
    `Your email will be sent in ${seconds} seconds.`,
    "",
    `👤 To: ${escapeHtml(input.to.join(", "))}`,
    `📌 Subject: ${escapeHtml(input.subject)}`,
    `📎 Attachments: ${input.attachmentCount}`,
    `🕒 Sending at: ${escapeHtml(input.deadline.toISOString())}`,
  ].join("\n");
}