import { db } from "@/lib/db";
import { sendTelegramMessage } from "@/telegram/client";

const NOTIFY_INTERVAL_MS = 15 * 60_000;

export async function recordOperationalAlert(input: {
  userId: string;
  accountId?: string;
  dedupeKey: string;
  kind: string;
  title: string;
  message: string;
}) {
  const now = new Date();
  const alert = await db.alertEvent.upsert({
    where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
    create: { ...input, title: input.title.slice(0, 160), message: input.message.slice(0, 2000) },
    update: {
      accountId: input.accountId,
      kind: input.kind,
      title: input.title.slice(0, 160),
      message: input.message.slice(0, 2000),
      status: "OPEN",
      occurrenceCount: { increment: 1 },
      lastSeenAt: now,
      resolvedAt: null,
    },
  });
  const settings = await db.applicationSettings.findUnique({ where: { userId: input.userId } });
  const shouldNotify = settings?.alertOnFailure !== false
    && (!alert.lastNotifiedAt || now.getTime() - alert.lastNotifiedAt.getTime() >= NOTIFY_INTERVAL_MS);
  if (shouldNotify) {
    const destinations = await db.telegramDestination.findMany({
      where: { userId: input.userId, enabled: true, pairedAt: { not: null } },
    });
    await Promise.allSettled(destinations.map((destination) => sendTelegramMessage(
      destination.chatId,
      `⚠️ <b>${escapeHtml(input.title)}</b>\n\n${escapeHtml(input.message.slice(0, 900))}\n\nOpen the MailPulse dashboard for details.`,
    )));
    if (destinations.length) await db.alertEvent.update({ where: { id: alert.id }, data: { lastNotifiedAt: now } });
  }
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (webhook && shouldNotify) {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "MailPulse", severity: "error", title: input.title, message: input.message, alertId: alert.id }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  return alert;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}