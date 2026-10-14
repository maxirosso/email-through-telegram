-- CreateEnum
CREATE TYPE "AccountAccessMode" AS ENUM ('PRIMARY', 'SHARED');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- AlterEnum
ALTER TYPE "EmailProviderKind" ADD VALUE 'GMAIL';

-- AlterTable
ALTER TABLE "ApplicationSettings" ADD COLUMN     "alertOnFailure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "auditRetentionDays" INTEGER NOT NULL DEFAULT 365,
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "messageRetentionDays" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "ApplicationUser" ADD COLUMN     "authUserId" UUID,
ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "accessMode" "AccountAccessMode" NOT NULL DEFAULT 'PRIMARY',
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "mailboxAddress" TEXT;

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "status" "BillingStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingCustomerId" TEXT,
    "billingSubscriptionId" TEXT,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "monthlyMessageLimit" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorAuthUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastNotifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramPairingCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramPairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_userId_key" ON "BillingSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_billingCustomerId_key" ON "BillingSubscription"("billingCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_billingSubscriptionId_key" ON "BillingSubscription"("billingSubscriptionId");

-- CreateIndex
CREATE INDEX "UsageCounter_userId_periodStart_idx" ON "UsageCounter"("userId", "periodStart" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_userId_metric_periodStart_key" ON "UsageCounter"("userId", "metric", "periodStart");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_userId_severity_createdAt_idx" ON "AuditEvent"("userId", "severity", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AlertEvent_userId_status_lastSeenAt_idx" ON "AlertEvent"("userId", "status", "lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "AlertEvent_accountId_idx" ON "AlertEvent"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertEvent_userId_dedupeKey_key" ON "AlertEvent"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "SupportCase_userId_status_createdAt_idx" ON "SupportCase"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramPairingCode_codeHash_key" ON "TelegramPairingCode"("codeHash");

-- CreateIndex
CREATE INDEX "TelegramPairingCode_userId_expiresAt_idx" ON "TelegramPairingCode"("userId", "expiresAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationUser_authUserId_key" ON "ApplicationUser"("authUserId");

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ApplicationUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ApplicationUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ApplicationUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ApplicationUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ApplicationUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramPairingCode" ADD CONSTRAINT "TelegramPairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ApplicationUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed a free subscription for every existing tenant.
INSERT INTO "BillingSubscription" (
  "id", "userId", "plan", "status", "currentPeriodStart", "monthlyMessageLimit", "createdAt", "updatedAt"
)
SELECT concat('sub_', md5(random()::text || clock_timestamp()::text || "id")), "id", 'FREE', 'ACTIVE', CURRENT_TIMESTAMP, 1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ApplicationUser"
ON CONFLICT ("userId") DO NOTHING;

-- Bound user-controlled settings and counters at the database layer.
ALTER TABLE "ApplicationSettings"
  ADD CONSTRAINT "ApplicationSettings_messageRetentionDays_check" CHECK ("messageRetentionDays" BETWEEN 7 AND 3650),
  ADD CONSTRAINT "ApplicationSettings_auditRetentionDays_check" CHECK ("auditRetentionDays" BETWEEN 30 AND 3650);
ALTER TABLE "BillingSubscription"
  ADD CONSTRAINT "BillingSubscription_monthlyMessageLimit_check" CHECK ("monthlyMessageLimit" > 0);
ALTER TABLE "UsageCounter"
  ADD CONSTRAINT "UsageCounter_quantity_check" CHECK ("quantity" >= 0);
ALTER TABLE "AlertEvent"
  ADD CONSTRAINT "AlertEvent_occurrenceCount_check" CHECK ("occurrenceCount" > 0);

-- These tables are server-only. RLS with no client policies is deliberate deny-by-default isolation.
ALTER TABLE "BillingSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AlertEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TelegramPairingCode" ENABLE ROW LEVEL SECURITY;

-- The application accesses these records only through server-side Prisma.
-- Explicit revokes prevent accidental Data API exposure if project defaults change.
REVOKE ALL ON TABLE "BillingSubscription" FROM anon, authenticated;
REVOKE ALL ON TABLE "UsageCounter" FROM anon, authenticated;
REVOKE ALL ON TABLE "AuditEvent" FROM anon, authenticated;
REVOKE ALL ON TABLE "AlertEvent" FROM anon, authenticated;
REVOKE ALL ON TABLE "SupportCase" FROM anon, authenticated;
REVOKE ALL ON TABLE "TelegramPairingCode" FROM anon, authenticated;
