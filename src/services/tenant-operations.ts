import { db } from "@/lib/db";
import { MailSyncService } from "./mail-sync";
import { writeAudit } from "./audit";
import { usageSummary } from "./quota";

export async function getTenantDashboardData(userId: string) {
  const [accounts, destination, settings, usage, messages, outgoing, deliveries, alerts, audits, supportCases] = await db.$transaction([
    db.emailAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.telegramDestination.findFirst({ where: { userId, enabled: true, pairedAt: { not: null } } }),
    db.applicationSettings.findUnique({ where: { userId } }),
    db.billingSubscription.findUnique({ where: { userId } }),
    db.emailMessage.findMany({ where: { account: { userId } }, orderBy: { receivedAt: "desc" }, take: 10 }),
    db.outgoingMessage.findMany({
      where: { draft: { account: { userId } } },
      include: { draft: { select: { subject: true } } }, orderBy: { createdAt: "desc" }, take: 15,
    }),
    db.notificationDelivery.findMany({
      where: { destination: { userId } },
      include: { message: { select: { subject: true } } }, orderBy: { updatedAt: "desc" }, take: 15,
    }),
    db.alertEvent.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
    db.auditEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.supportCase.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const currentUsage = await usageSummary(userId);
  return { accounts, destination, settings, subscription: usage, usage: currentUsage.used, pendingUsage: currentUsage.pending, messages, outgoing, deliveries, alerts, audits, supportCases };
}

export async function updateTenantSettings(userId: string, input: {
  timezone: string; undoSendSeconds: number; messageRetentionDays: number;
  auditRetentionDays: number; alertOnFailure: boolean;
}, actorAuthUserId?: string | null) {
  const settings = await db.applicationSettings.upsert({
    where: { userId }, create: { userId, ...input }, update: input,
  });
  await writeAudit({ userId, actorAuthUserId, action: "SETTINGS_UPDATED", entityType: "ApplicationSettings", entityId: settings.id });
  return settings;
}

export async function acknowledgeTenantAlert(userId: string, alertId: string, actorAuthUserId?: string | null) {
  const changed = await db.alertEvent.updateMany({
    where: { id: alertId, userId, status: "OPEN" }, data: { status: "ACKNOWLEDGED" },
  });
  if (changed.count !== 1) return false;
  await writeAudit({ userId, actorAuthUserId, action: "ALERT_ACKNOWLEDGED", entityType: "AlertEvent", entityId: alertId });
  return true;
}

export async function retryTenantDelivery(userId: string, deliveryId: string, actorAuthUserId?: string | null) {
  const delivery = await db.notificationDelivery.findFirst({
    where: { id: deliveryId, destination: { userId }, status: "FAILED" }, select: { id: true, messageId: true },
  });
  if (!delivery) return false;
  await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "PENDING", lastError: null } });
  await new MailSyncService(db).retryDelivery(delivery.messageId);
  await writeAudit({ userId, actorAuthUserId, action: "DELIVERY_RETRIED", entityType: "NotificationDelivery", entityId: deliveryId });
  return true;
}

export async function setTenantAccountEnabled(userId: string, accountId: string, enabled: boolean, actorAuthUserId?: string | null) {
  const changed = await db.emailAccount.updateMany({
    where: { id: accountId, userId },
    data: enabled
      ? { enabled: true, connectionStatus: "REAUTH_REQUIRED" }
      : { enabled: false, notificationsOn: false, connectionStatus: "DISCONNECTED", webhookSubscriptionId: null, webhookExpiresAt: null },
  });
  if (changed.count !== 1) return false;
  await writeAudit({
    userId, actorAuthUserId, action: enabled ? "ACCOUNT_RECONNECT_REQUESTED" : "ACCOUNT_DISCONNECTED",
    entityType: "EmailAccount", entityId: accountId, severity: enabled ? "INFO" : "WARNING",
  });
  return true;
}

export async function createTenantSupportCase(userId: string, subject: string, message: string, actorAuthUserId?: string | null) {
  const supportCase = await db.supportCase.create({ data: { userId, subject: subject.slice(0, 160), message: message.slice(0, 5000) } });
  await writeAudit({ userId, actorAuthUserId, action: "SUPPORT_CASE_CREATED", entityType: "SupportCase", entityId: supportCase.id });
  return supportCase;
}

export async function setTenantDeletionRequest(userId: string, requested: boolean, actorAuthUserId?: string | null) {
  const settings = await db.applicationSettings.update({
    where: { userId }, data: { deletionRequestedAt: requested ? new Date() : null },
  });
  await writeAudit({
    userId, actorAuthUserId, action: requested ? "DELETION_REQUESTED" : "DELETION_CANCELLED",
    entityType: "ApplicationUser", entityId: userId, severity: requested ? "WARNING" : "INFO",
  });
  return settings;
}

export async function runTenantRetention(userId: string, now = new Date()) {
  const settings = await db.applicationSettings.findUnique({ where: { userId } });
  if (!settings) return { messages: 0, audits: 0 };
  const messageCutoff = new Date(now.getTime() - settings.messageRetentionDays * 86_400_000);
  const auditCutoff = new Date(now.getTime() - settings.auditRetentionDays * 86_400_000);
  const [messages, audits] = await db.$transaction([
    db.emailMessage.deleteMany({
      where: { account: { userId }, receivedAt: { lt: messageCutoff }, drafts: { none: {} } },
    }),
    db.auditEvent.deleteMany({ where: { userId, createdAt: { lt: auditCutoff } } }),
  ]);
  return { messages: messages.count, audits: audits.count };
}

export async function exportTenantData(userId: string) {
  const user = await db.applicationUser.findUniqueOrThrow({
    where: { id: userId },
    include: {
      accounts: { include: { messages: { include: { attachments: true }, orderBy: { receivedAt: "desc" } }, drafts: { include: { attachments: true, outgoing: true } } } },
      destinations: true, settings: true, billing: true, usageCounters: true,
      auditEvents: { orderBy: { createdAt: "desc" } }, alerts: true, supportCases: true,
    },
  });
  return JSON.parse(JSON.stringify(user, (_, value) => typeof value === "bigint" ? value.toString() : value));
}
