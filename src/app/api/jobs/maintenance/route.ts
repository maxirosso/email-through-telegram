import { db } from "@/lib/db";
import { MailSyncService } from "@/services/mail-sync";
import { ensureMicrosoftSubscription } from "@/services/microsoft-subscriptions";
import { verifyQstashRequest } from "@/services/qstash";
import { sendTelegramMessage } from "@/telegram/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const raw = await request.text();
  if (!(await verifyQstashRequest(request, raw))) return new Response("Unauthorized", { status: 401 });
  const stale = await db.outgoingMessage.findMany({
    where: { status: "SENDING", claimedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    include: { draft: { include: { account: { include: { user: { include: { destinations: true } } } } } } },
    take: 20,
  });
  for (const outgoing of stale) {
    const changed = await db.outgoingMessage.updateMany({
      where: { id: outgoing.id, status: "SENDING" },
      data: { status: "UNKNOWN_SEND_STATUS", errorDetails: "Send worker ended before recording the provider result" },
    });
    if (changed.count === 1) {
      await db.emailDraft.update({ where: { id: outgoing.draftId }, data: { status: "UNKNOWN_SEND_STATUS" } });
      await Promise.allSettled(outgoing.draft.account.user.destinations
        .filter((destination) => destination.enabled && destination.pairedAt)
        .map((destination) => sendTelegramMessage(destination.chatId,
          "⚠️ <b>Send status is uncertain.</b>\n\nCheck Outlook before trying again; MailPulse will not retry automatically.")));
    }
  }

  const accounts = await db.emailAccount.findMany({
    where: { enabled: true }, select: { id: true, notificationsOn: true }, take: 10,
  });
  const sync = new MailSyncService(db);
  for (const account of accounts) {
    await sync.syncAccount(account.id);
    if (account.notificationsOn) await ensureMicrosoftSubscription(account.id);
  }
  await db.telegramProcessedUpdate.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
  });
  return new Response(null, { status: 204 });
}