-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EmailProviderKind" AS ENUM ('MICROSOFT');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'CANCELLED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN_SEND_STATUS');

-- CreateEnum
CREATE TYPE "ReplyType" AS ENUM ('REPLY', 'REPLY_ALL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "ApplicationUser" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "EmailProviderKind" NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "encryptedTokens" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notificationsOn" BOOLEAN NOT NULL DEFAULT true,
    "connectionStatus" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "syncCursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "conversationId" TEXT,
    "internetMessageId" TEXT,
    "senderName" TEXT,
    "senderAddress" TEXT NOT NULL,
    "replyTo" JSONB,
    "recipients" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "sanitizedPreview" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "providerWebLink" TEXT,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "draftId" TEXT,
    "providerAttachmentId" TEXT,
    "telegramFileId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "temporaryStorageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "originalMessageId" TEXT NOT NULL,
    "providerDraftId" TEXT NOT NULL,
    "replyType" "ReplyType" NOT NULL,
    "recipients" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutgoingMessage" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedAt" TIMESTAMP(3),
    "scheduledSendAt" TIMESTAMP(3),
    "cancellationDeadline" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "providerResponse" JSONB,
    "errorDetails" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutgoingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramDestination" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "pairedAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TelegramDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramConversationState" (
    "id" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "activeDraftId" TEXT,
    "expectedInput" TEXT,
    "state" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "telegramMessageId" BIGINT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCheckpoint" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerCursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "errorState" TEXT,

    CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Buenos_Aires',
    "undoSendSeconds" INTEGER NOT NULL DEFAULT 10,
    "notificationPreviewLength" INTEGER NOT NULL DEFAULT 2500,

    CONSTRAINT "ApplicationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationUser_email_key" ON "ApplicationUser"("email");

-- CreateIndex
CREATE INDEX "EmailAccount_userId_enabled_idx" ON "EmailAccount"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_provider_providerAccountId_key" ON "EmailAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_userId_emailAddress_key" ON "EmailAccount"("userId", "emailAddress");

-- CreateIndex
CREATE INDEX "EmailMessage_accountId_receivedAt_idx" ON "EmailMessage"("accountId", "receivedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_accountId_providerMessageId_key" ON "EmailMessage"("accountId", "providerMessageId");

-- CreateIndex
CREATE INDEX "EmailAttachment_messageId_idx" ON "EmailAttachment"("messageId");

-- CreateIndex
CREATE INDEX "EmailAttachment_draftId_idx" ON "EmailAttachment"("draftId");

-- CreateIndex
CREATE INDEX "EmailDraft_accountId_status_idx" ON "EmailDraft"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OutgoingMessage_draftId_key" ON "OutgoingMessage"("draftId");

-- CreateIndex
CREATE INDEX "OutgoingMessage_status_scheduledSendAt_idx" ON "OutgoingMessage"("status", "scheduledSendAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramDestination_telegramUserId_key" ON "TelegramDestination"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramDestination_chatId_key" ON "TelegramDestination"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramConversationState_destinationId_activeDraftId_key" ON "TelegramConversationState"("destinationId", "activeDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_messageId_destinationId_key" ON "NotificationDelivery"("messageId", "destinationId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCheckpoint_accountId_key" ON "SyncCheckpoint"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationSettings_userId_key" ON "ApplicationSettings"("userId");

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ApplicationUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "EmailDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_originalMessageId_fkey" FOREIGN KEY ("originalMessageId") REFERENCES "EmailMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingMessage" ADD CONSTRAINT "OutgoingMessage_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "EmailDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramDestination" ADD CONSTRAINT "TelegramDestination_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ApplicationUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramConversationState" ADD CONSTRAINT "TelegramConversationState_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "TelegramDestination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "TelegramDestination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCheckpoint" ADD CONSTRAINT "SyncCheckpoint_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSettings" ADD CONSTRAINT "ApplicationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ApplicationUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
