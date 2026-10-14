import { db } from "../src/lib/db";

async function main() {
  const started = Date.now();
  const [account, destination, messages, scheduled, sent] = await db.$transaction([
    db.emailAccount.findFirst({ select: { connectionStatus: true, webhookSubscriptionId: true } }),
    db.telegramDestination.findFirst({ where: { enabled: true, pairedAt: { not: null } }, select: { id: true } }),
    db.emailMessage.count(),
    db.outgoingMessage.count({ where: { status: "SCHEDULED" } }),
    db.outgoingMessage.count({ where: { status: "SENT" } }),
  ]);
  console.log(JSON.stringify({
    database: "ready",
    outlook: account?.connectionStatus ?? "missing",
    graphWebhook: Boolean(account?.webhookSubscriptionId),
    telegram: Boolean(destination),
    messages,
    scheduled,
    sent,
    durationMs: Date.now() - started,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());