-- Allow a durable draft to represent either a reply or a newly composed email.
ALTER TYPE "public"."ReplyType" ADD VALUE 'NEW';

ALTER TABLE "public"."EmailDraft"
  ALTER COLUMN "originalMessageId" DROP NOT NULL;
