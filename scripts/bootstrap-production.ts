import { db } from "../src/lib/db";
import { config } from "../src/config";
import { configureTelegramWebhook } from "../src/telegram/client";
import { MailSyncService } from "../src/services/mail-sync";
import { ensureMicrosoftSubscription } from "../src/services/microsoft-subscriptions";
import { qstashClient } from "../src/services/qstash";

async function main() {
  const env = config();
  const base = new URL(env.APPLICATION_BASE_URL);
  if (base.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(base.hostname)) {
    throw new Error("APPLICATION_BASE_URL must be the deployed HTTPS Vercel URL before bootstrap");
  }
  await configureTelegramWebhook(`${env.APPLICATION_BASE_URL}/api/telegram/webhook`);
  const sync = new MailSyncService(db);
  const accounts = await db.emailAccount.findMany({ where: { enabled: true }, select: { id: true } });
  if (!accounts.length) throw new Error("No connected Outlook account was found");
  for (const account of accounts) {
    await sync.syncAccount(account.id);
    await ensureMicrosoftSubscription(account.id);
  }
  await qstashClient().schedules.create({
    destination: `${env.APPLICATION_BASE_URL}/api/jobs/maintenance`,
    cron: "*/5 * * * *",
    scheduleId: "mailpulse-maintenance-v1",
    retries: 3,
    body: JSON.stringify({ source: "schedule" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  console.log("MailPulse production hooks and reconciliation schedule are active.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());