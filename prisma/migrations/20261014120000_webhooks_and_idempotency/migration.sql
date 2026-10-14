ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'SENDING';

-- Add durable Microsoft Graph subscription state.
ALTER TABLE "EmailAccount"
  ADD COLUMN "webhookSubscriptionId" TEXT,
  ADD COLUMN "webhookExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "EmailAccount_webhookSubscriptionId_key"
  ON "EmailAccount"("webhookSubscriptionId");
CREATE INDEX "EmailAccount_enabled_notificationsOn_idx"
  ON "EmailAccount"("enabled", "notificationsOn");

-- Telegram retries non-2xx responses. Recording update ids makes processing idempotent.
CREATE TABLE "TelegramProcessedUpdate" (
  "updateId" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramProcessedUpdate_pkey" PRIMARY KEY ("updateId")
);
CREATE INDEX "TelegramProcessedUpdate_createdAt_idx"
  ON "TelegramProcessedUpdate"("createdAt");
ALTER TABLE "TelegramProcessedUpdate" ENABLE ROW LEVEL SECURITY;

-- An attachment must belong to exactly one message or one draft.
ALTER TABLE "EmailAttachment"
  ADD CONSTRAINT "EmailAttachment_exactly_one_parent_check"
  CHECK (("messageId" IS NOT NULL)::int + ("draftId" IS NOT NULL)::int = 1);