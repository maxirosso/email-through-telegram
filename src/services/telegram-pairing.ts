import { createHmac, randomInt } from "node:crypto";
import { config } from "@/config";
import { db } from "@/lib/db";
import { writeAudit } from "./audit";

function hashCode(code: string) {
  return createHmac("sha256", config().SESSION_SECRET).update(code.trim().toUpperCase()).digest("hex");
}

export async function createTelegramPairingCode(userId: string) {
  const code = `MP-${randomInt(100000, 1000000)}`;
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await db.$transaction([
    db.telegramPairingCode.deleteMany({ where: { userId, usedAt: null } }),
    db.telegramPairingCode.create({ data: { userId, codeHash: hashCode(code), expiresAt } }),
  ]);
  await writeAudit({ userId, action: "TELEGRAM_PAIR_CODE_CREATED", entityType: "TelegramDestination" });
  return { code, expiresAt };
}

export async function redeemTelegramPairingCode(code: string, telegramUserId: bigint, chatId: bigint) {
  const pairing = await db.telegramPairingCode.findUnique({ where: { codeHash: hashCode(code) } });
  if (!pairing || pairing.usedAt || pairing.expiresAt < new Date()) return null;
  const destination = await db.$transaction(async (tx) => {
    const claimed = await tx.telegramPairingCode.updateMany({
      where: { id: pairing.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return null;
    const existing = await tx.telegramDestination.findUnique({ where: { telegramUserId } });
    if (existing && existing.userId !== pairing.userId) throw new Error("Telegram account is paired to another tenant");
    return tx.telegramDestination.upsert({
      where: { telegramUserId },
      create: { userId: pairing.userId, telegramUserId, chatId, pairedAt: new Date(), enabled: true },
      update: { userId: pairing.userId, chatId, pairedAt: new Date(), enabled: true },
    });
  });
  if (destination) {
    await writeAudit({
      userId: destination.userId, action: "TELEGRAM_PAIRED", entityType: "TelegramDestination",
      entityId: destination.id,
    });
  }
  return destination;
}
