import { db } from "@/lib/db";
import { MailSyncService } from "@/services/mail-sync";
import { ensureMicrosoftSubscription } from "@/services/microsoft-subscriptions";
import { verifyQstashRequest } from "@/services/qstash";
import { sendTelegramMessage } from "@/telegram/client";
import { recordOperationalAlert } from "@/services/alerts";
import { runTenantRetention } from "@/services/tenant-operations";
import { writeAudit } from "@/services/audit";

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
      await recordOperationalAlert({
        userId: outgoing.draft.account.userId, accountId: outgoing.draft.accountId,
        dedupeKey: `stale-send:${outgoing.id}`, kind: "SEND_UNCERTAIN",
        title: "A send worker stopped unexpectedly", message: "Check the provider mailbox before attempting another send.",
      });
      await Promise.allSettled(outgoing.draft.account.user.destinations
        .filter((destination) => destination.enabled && destination.pairedAt)
        .map((destination) => sendTelegramMessage(destination.chatId,
          "⚠️ <b>Send status is uncertain.</b>\n\nCheck Outlook before trying again; MailPulse will not retry automatically.")));
    }
  }

  const accounts = await db.emailAccount.findMany({
    where: { enabled: true }, select: { id: true, userId: true, notificationsOn: true }, take: 25,
  });
  const sync = new MailSyncService(db);
  for (const account of accounts) {
    try {
      await sync.syncAccount(account.id);
      if (account.notificationsOn) await ensureMicrosoftSubscription(account.id);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown maintenance error";
      await db.syncCheckpoint.upsert({
        where: { accountId: account.id }, create: { accountId: account.id, errorState: message }, update: { errorState: message },
      });
      await recordOperationalAlert({
        userId: account.userId, accountId: account.id, dedupeKey: `maintenance:${account.id}`,
        kind: "MAILBOX_MAINTENANCE_FAILED", title: "Mailbox synchronization needs attention", message,
      });
      await writeAudit({
        userId: account.userId, action: "MAILBOX_MAINTENANCE_FAILED", entityType: "EmailAccount",
        entityId: account.id, severity: "ERROR", metadata: { error: message },
      });
    }
  }
  const users = await db.applicationUser.findMany({ select: { id: true }, take: 100 });
  for (const user of users) {
    await runTenantRetention(user.id).catch((error) => recordOperationalAlert({
      userId: user.id, dedupeKey: `retention:${user.id}`, kind: "RETENTION_FAILED",
      title: "Retention cleanup failed", message: error instanceof Error ? error.message.slice(0, 1000) : "Unknown retention error",
    }));
  }
  await db.telegramProcessedUpdate.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
  });
  return new Response(null, { status: 204 });
}
