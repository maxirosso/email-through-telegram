import { db } from "@/lib/db";

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function usageSummary(userId: string, now = new Date()) {
  const [subscription, counter, pending] = await db.$transaction([
    db.billingSubscription.findUnique({ where: { userId } }),
    db.usageCounter.findUnique({ where: { userId_metric_periodStart: { userId, metric: "EMAIL_SENT", periodStart: monthStart(now) } } }),
    db.outgoingMessage.count({ where: { draft: { account: { userId } }, status: { in: ["SCHEDULED", "SENDING"] } } }),
  ]);
  return { plan: subscription?.plan ?? "FREE", status: subscription?.status ?? "ACTIVE", used: counter?.quantity ?? 0, pending, limit: subscription?.monthlyMessageLimit ?? 1000 };
}

export async function assertSendQuota(userId: string) {
  const usage = await usageSummary(userId);
  if (usage.status !== "ACTIVE" && usage.status !== "TRIAL") throw new Error("Billing subscription is not active");
  if (usage.used + usage.pending >= usage.limit) throw new Error(`Monthly send quota reached (${usage.limit})`);
  return usage;
}

export async function recordSentUsage(userId: string, now = new Date()) {
  return db.usageCounter.upsert({
    where: { userId_metric_periodStart: { userId, metric: "EMAIL_SENT", periodStart: monthStart(now) } },
    create: { userId, metric: "EMAIL_SENT", periodStart: monthStart(now), quantity: 1 },
    update: { quantity: { increment: 1 } },
  });
}
