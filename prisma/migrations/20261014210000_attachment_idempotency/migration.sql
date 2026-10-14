-- Telegram may retry webhook updates. Enforce one copy of a Telegram file per draft.
-- PostgreSQL treats NULL values as distinct, so inbound email attachment metadata is unaffected.
DROP INDEX IF EXISTS "EmailAttachment_draftId_idx";
CREATE UNIQUE INDEX "EmailAttachment_draftId_telegramFileId_key"
  ON "EmailAttachment"("draftId", "telegramFileId");