import { PrismaClient } from "@prisma/client";

const ownerEmail = process.argv[2]?.trim().toLowerCase();
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatIdValue = process.env.TELEGRAM_CHAT_ID;
const userIdValue = process.env.TELEGRAM_USER_ID;

if (!ownerEmail || !ownerEmail.includes("@")) throw new Error("Pass the owner email as the first argument");
if (!token || !chatIdValue || !userIdValue) throw new Error("Telegram environment variables are incomplete");

const chatId = BigInt(chatIdValue);
const telegramUserId = BigInt(userIdValue);
const prisma = new PrismaClient();

try {
  const destination = await prisma.$transaction(async (tx) => {
    const user = await tx.applicationUser.upsert({
      where: { email: ownerEmail },
      create: { email: ownerEmail, displayName: "MailPulse Owner" },
      update: {},
    });

    await tx.applicationSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, undoSendSeconds: 10 },
      update: { undoSendSeconds: 10 },
    });

    return tx.telegramDestination.upsert({
      where: { telegramUserId },
      create: { userId: user.id, telegramUserId, chatId, pairedAt: new Date(), enabled: true },
      update: { userId: user.id, chatId, pairedAt: new Date(), enabled: true },
    });
  });

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: destination.chatId.toString(),
      text: "✅ MailPulse secure pairing complete.\n\nCloud database: connected\nUndo Send: 10 seconds",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Telegram confirmation failed (${response.status})`);

  console.log(JSON.stringify({ paired: true, confirmationSent: true }));
} finally {
  await prisma.$disconnect();
}
