import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "@/config";
import { db } from "@/lib/db";
import { enqueueSync } from "@/services/qstash";
import { recordOperationalAlert } from "@/services/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const notificationSchema = z.object({
  value: z.array(z.object({
    subscriptionId: z.string().min(1),
    clientState: z.string().optional(),
    lifecycleEvent: z.string().optional(),
    resourceData: z.object({ id: z.string().min(1) }).passthrough().optional(),
  }).passthrough()).max(100),
});

function validClientState(value?: string): boolean {
  if (!value) return false;
  const expected = Buffer.from(config().MICROSOFT_WEBHOOK_SECRET);
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  const validationToken = new URL(request.url).searchParams.get("validationToken");
  if (validationToken !== null) {
    return new Response(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  const parsed = notificationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid notification", { status: 400 });

  for (const notification of parsed.data.value) {
    if (!validClientState(notification.clientState)) continue;
    const account = await db.emailAccount.findUnique({
      where: { webhookSubscriptionId: notification.subscriptionId }, select: { id: true, enabled: true },
    });
    if (!account?.enabled) continue;
    if (notification.lifecycleEvent === "subscriptionRemoved") {
      await db.emailAccount.update({
        where: { id: account.id }, data: { webhookSubscriptionId: null, webhookExpiresAt: null },
      });
      const owner = await db.emailAccount.findUnique({ where: { id: account.id }, select: { userId: true } });
      if (owner) await recordOperationalAlert({
        userId: owner.userId, accountId: account.id, dedupeKey: `subscription:${account.id}`,
        kind: "SUBSCRIPTION_REMOVED", title: "Outlook webhook subscription was removed",
        message: "MailPulse will attempt to recreate the subscription during maintenance.",
      });
    }
    await enqueueSync(account.id, notification.resourceData?.id);
  }
  return new Response(null, { status: 202 });
}
