import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";

type Backup = { format: string; tables: Record<string, Array<Record<string, unknown>>> };

function encryptionKey() {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

function reviver(_key: string, value: unknown) {
  if (value && typeof value === "object" && "$type" in value && "value" in value) {
    const tagged = value as { $type: string; value: string };
    if (tagged.$type === "bigint") return BigInt(tagged.value);
    if (tagged.$type === "bytes") return Buffer.from(tagged.value, "base64");
  }
  return value;
}

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("Pass an encrypted backup path");
  const encrypted = await readFile(input);
  if (encrypted.subarray(0, 5).toString() !== "MPBK1") throw new Error("Unsupported backup format");
  const iv = encrypted.subarray(5, 17);
  const tag = encrypted.subarray(17, 33);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted.subarray(33)), decipher.final()]);
  const backup = JSON.parse(plaintext.toString("utf8"), reviver) as Backup;
  if (backup.format !== "mailpulse-logical-backup-v1") throw new Error("Unsupported backup payload");

  const messages = backup.tables.EmailMessage ?? [];
  const attachments = backup.tables.EmailAttachment ?? [];
  const deliveries = backup.tables.NotificationDelivery ?? [];
  let restoredMessages = 0;
  let restoredAttachments = 0;
  let restoredDeliveries = 0;

  for (const row of messages) {
    const id = String(row.id);
    if (await db.emailMessage.findUnique({ where: { id }, select: { id: true } })) continue;
    await db.emailMessage.create({ data: {
      id, accountId: String(row.accountId), providerMessageId: String(row.providerMessageId),
      conversationId: row.conversationId ? String(row.conversationId) : null,
      internetMessageId: row.internetMessageId ? String(row.internetMessageId) : null,
      senderName: row.senderName ? String(row.senderName) : null, senderAddress: String(row.senderAddress),
      replyTo: row.replyTo === null ? Prisma.JsonNull : row.replyTo as Prisma.InputJsonValue,
      recipients: row.recipients as Prisma.InputJsonValue, subject: String(row.subject),
      sanitizedPreview: row.sanitizedPreview ? String(row.sanitizedPreview) : null,
      receivedAt: new Date(String(row.receivedAt)), providerWebLink: row.providerWebLink ? String(row.providerWebLink) : null,
      hasAttachments: Boolean(row.hasAttachments), createdAt: new Date(String(row.createdAt)),
    } });
    restoredMessages += 1;
  }
  for (const row of attachments.filter((item) => item.messageId)) {
    const id = String(row.id);
    if (await db.emailAttachment.findUnique({ where: { id }, select: { id: true } })) continue;
    if (!await db.emailMessage.findUnique({ where: { id: String(row.messageId) }, select: { id: true } })) continue;
    await db.emailAttachment.create({ data: {
      id, messageId: String(row.messageId), providerAttachmentId: row.providerAttachmentId ? String(row.providerAttachmentId) : null,
      telegramFileId: row.telegramFileId ? String(row.telegramFileId) : null, filename: String(row.filename),
      mimeType: String(row.mimeType), sizeBytes: BigInt(row.sizeBytes as bigint),
      temporaryStorageKey: row.temporaryStorageKey ? String(row.temporaryStorageKey) : null,
      createdAt: new Date(String(row.createdAt)),
    } });
    restoredAttachments += 1;
  }
  for (const row of deliveries) {
    const id = String(row.id);
    if (await db.notificationDelivery.findUnique({ where: { id }, select: { id: true } })) continue;
    if (!await db.emailMessage.findUnique({ where: { id: String(row.messageId) }, select: { id: true } })) continue;
    await db.notificationDelivery.create({ data: {
      id, messageId: String(row.messageId), destinationId: String(row.destinationId), status: row.status as never,
      attempts: Number(row.attempts), telegramMessageId: row.telegramMessageId === null ? null : BigInt(row.telegramMessageId as bigint),
      lastError: row.lastError ? String(row.lastError) : null, createdAt: new Date(String(row.createdAt)), updatedAt: new Date(String(row.updatedAt)),
    } });
    restoredDeliveries += 1;
  }
  const users = await db.applicationUser.findMany({ select: { id: true } });
  for (const user of users) {
    await db.applicationSettings.update({ where: { userId: user.id }, data: { messageRetentionDays: 3650 } });
    await db.auditEvent.create({ data: {
      userId: user.id, action: "RETENTION_EXTENDED_FOR_EXISTING_DATA", entityType: "ApplicationSettings",
      severity: "WARNING", metadata: { messageRetentionDays: 3650, restoredMessages },
    } });
  }
  console.log(JSON.stringify({ restoredMessages, restoredAttachments, restoredDeliveries, retentionDays: 3650 }));
}

main().finally(() => db.$disconnect());
