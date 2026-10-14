-- MailPulse is a server-side application. Prisma connects with the trusted
-- database role, while the public Supabase API must not expose application
-- records through the publishable key.
ALTER TABLE "public"."ApplicationUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EmailAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EmailMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EmailAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EmailDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."OutgoingMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TelegramDestination" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TelegramConversationState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."NotificationDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."SyncCheckpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ApplicationSettings" ENABLE ROW LEVEL SECURITY;

-- Cover foreign keys used during deletes and joins.
CREATE INDEX "EmailDraft_originalMessageId_idx"
    ON "public"."EmailDraft"("originalMessageId");
CREATE INDEX "NotificationDelivery_destinationId_idx"
    ON "public"."NotificationDelivery"("destinationId");
CREATE INDEX "TelegramDestination_userId_idx"
    ON "public"."TelegramDestination"("userId");
