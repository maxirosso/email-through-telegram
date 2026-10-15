export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function dateFormatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
  }
}

function calendarKey(value: Date, timeZone: string): string {
  return dateFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function friendlyDateTime(
  value: Date,
  timeZone: string,
  now = new Date(),
): string {
  const time = dateFormatter(timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
  const key = calendarKey(value, timeZone);
  if (key === calendarKey(now, timeZone)) return `Today at ${time}`;
  if (key === calendarKey(new Date(now.getTime() - 86_400_000), timeZone)) {
    return `Yesterday at ${time}`;
  }
  const day = dateFormatter(timeZone, { month: "short", day: "numeric" }).format(value);
  return `${day} at ${time}`;
}

export function incomingEmailMessage(input: {
  senderName?: string | null;
  senderAddress: string;
  subject: string;
  preview?: string | null;
  receivedAt: Date;
  attachmentCount: number;
  timezone: string;
}): string {
  const sender = input.senderName
    ? `${escapeHtml(input.senderName)} &lt;${escapeHtml(input.senderAddress)}&gt;`
    : escapeHtml(input.senderAddress);
  const lines = [
    "📬 <b>New email</b>",
    "",
    `<b>${escapeHtml(input.subject)}</b>`,
    `From ${sender}`,
    friendlyDateTime(input.receivedAt, input.timezone),
  ];
  if (input.attachmentCount) lines.push(`📎 ${input.attachmentCount} attachment${input.attachmentCount === 1 ? "" : "s"}`);
  lines.push("", "<b>Preview</b>");
  if (input.preview) lines.push(escapeHtml(truncate(input.preview, 850)));
  else lines.push("<i>No text preview is available.</i>");
  lines.push("", "<i>Tap Read full email to see the complete message.</i>");
  return lines.join("\n");
}

export function draftPreview(input: {
  to: string[];
  subject: string;
  body: string;
  attachmentCount: number;
  attachmentNames?: string[];
  kind?: "new" | "reply";
}): string {
  const attachmentLines = (input.attachmentNames ?? []).slice(0, 8)
    .map((name) => `  • ${escapeHtml(truncate(name, 60))}`);
  if ((input.attachmentNames?.length ?? 0) > 8) {
    attachmentLines.push(`  • …and ${input.attachmentNames!.length - 8} more`);
  }
  return [
    input.kind === "new" ? "✉️ <b>NEW EMAIL</b>" : "↩️ <b>REPLY PREVIEW</b>",
    "",
    `👤 To: ${escapeHtml(input.to.join(", "))}`,
    `📌 Subject: ${escapeHtml(input.subject)}`,
    `📎 Attachments: ${input.attachmentCount}`,
    ...attachmentLines,
    "",
    escapeHtml(truncate(input.body, Math.max(800, 2800 - attachmentLines.join("\n").length))),
  ].join("\n");
}

export function homeMessage(): string {
  return [
    "✨ <b>MailPulse</b>",
    "",
    "Email from Telegram—simple, safe, and ready.",
    "",
    "What would you like to do?",
  ].join("\n");
}

export function composePrompt(step: "recipient" | "subject" | "body"): string {
  if (step === "recipient") {
    return "✉️ <b>New email · 1 of 3</b>\n\nWho should receive it?\n\nSend one address, or several separated by commas.\n\n<i>Example: alex@example.com, team@example.com</i>\n\nUse /cancel to discard.";
  }
  if (step === "subject") {
    return "✉️ <b>New email · 2 of 3</b>\n\nWhat is the subject?\n\nUse /cancel to discard.";
  }
  return "✉️ <b>New email · 3 of 3</b>\n\nWrite your message.\n\nYou will review everything before it is sent. Use /cancel to discard.";
}

export function scheduledMessage(input: {
  to: string[];
  subject: string;
  attachmentCount: number;
  deadline: Date;
  undoSeconds?: number;
  timezone: string;
}): string {
  const seconds = input.undoSeconds ?? 10;
  return [
    "⏳ <b>Email ready to send</b>",
    "",
    `Sending in ${seconds} seconds. Tap Undo send below to cancel.`,
    "",
    `👤 To: ${escapeHtml(input.to.join(", "))}`,
    `📌 Subject: ${escapeHtml(input.subject)}`,
    `📎 Attachments: ${input.attachmentCount}`,
    `🕒 ${friendlyDateTime(input.deadline, input.timezone)}`,
  ].join("\n");
}
