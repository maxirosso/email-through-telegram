import { DraftStatus, PrismaClient } from "@prisma/client";
import { MicrosoftGraphProvider } from "@/providers/microsoft-graph";
import { accessTokenForAccount } from "@/auth/microsoft-tokens";
import { sendTelegramMessage } from "@/telegram/client";
import { recordSentUsage } from "./quota";
import { writeAudit } from "./audit";
import { recordOperationalAlert } from "./alerts";

export type ServerlessSendResult = "SENT" | "IGNORED" | "TOO_EARLY" | "UNKNOWN";

export async function processScheduledOutgoing(
  prisma: PrismaClient,
  outgoingId: string,
  now = new Date(),
): Promise<ServerlessSendResult> {
  const candidate = await prisma.outgoingMessage.findUnique({ where: { id: outgoingId } });
  if (!candidate || candidate.status !== DraftStatus.SCHEDULED || !candidate.scheduledSendAt) return "IGNORED";
  if (candidate.scheduledSendAt.getTime() > now.getTime()) return "TOO_EARLY";

  const claimed = await prisma.outgoingMessage.updateMany({
    where: { id: outgoingId, status: DraftStatus.SCHEDULED, scheduledSendAt: { lte: now } },
    data: { status: DraftStatus.SENDING, claimedAt: now, attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return "IGNORED";

  const outgoing = await prisma.outgoingMessage.findUniqueOrThrow({
    where: { id: outgoingId }, include: { draft: true },
  });
  await prisma.emailDraft.update({ where: { id: outgoing.draftId }, data: { status: DraftStatus.SENDING } });

  try {
    const token = await accessTokenForAccount(outgoing.draft.accountId);
    await new MicrosoftGraphProvider(token).sendDraft(outgoing.draft.providerDraftId);
    await prisma.$transaction([
      prisma.outgoingMessage.update({
        where: { id: outgoingId }, data: { status: DraftStatus.SENT, sentAt: new Date() },
      }),
      prisma.emailDraft.update({
        where: { id: outgoing.draftId }, data: { status: DraftStatus.SENT },
      }),
    ]);
    const completed = await prisma.outgoingMessage.findUnique({
      where: { id: outgoingId },
      include: { draft: { include: { account: { include: { user: { include: { destinations: true } } } } } } },
    });
    if (completed) {
      await recordSentUsage(completed.draft.account.userId);
      await writeAudit({
        userId: completed.draft.account.userId, action: "EMAIL_SENT", entityType: "OutgoingMessage", entityId: outgoingId,
      });
      await Promise.allSettled(completed.draft.account.user.destinations
        .filter((destination) => destination.enabled && destination.pairedAt)
        .map((destination) => sendTelegramMessage(destination.chatId,
          `✅ <b>Email sent.</b>\n\n${completed.draft.subject.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}`)));
    }
    return "SENT";
  } catch (error) {
    // Once the external request starts, a transport error can be ambiguous. Never auto-retry it.
    const detail = error instanceof Error ? error.message : "Unknown provider error";
    await prisma.$transaction([
      prisma.outgoingMessage.update({
        where: { id: outgoingId },
        data: { status: DraftStatus.UNKNOWN_SEND_STATUS, errorDetails: detail },
      }),
      prisma.emailDraft.update({
        where: { id: outgoing.draftId }, data: { status: DraftStatus.UNKNOWN_SEND_STATUS },
      }),
    ]);
    const affected = await prisma.emailDraft.findUnique({
      where: { id: outgoing.draftId },
      include: { account: { include: { user: { include: { destinations: true } } } } },
    });
    if (affected) {
      await recordOperationalAlert({
        userId: affected.account.userId, accountId: affected.accountId,
        dedupeKey: `send-uncertain:${outgoingId}`, kind: "SEND_UNCERTAIN",
        title: "Email send status is uncertain", message: detail.slice(0, 1000),
      });
      await writeAudit({
        userId: affected.account.userId, action: "EMAIL_SEND_UNCERTAIN", entityType: "OutgoingMessage",
        entityId: outgoingId, severity: "ERROR", metadata: { error: detail.slice(0, 1000) },
      });
      await Promise.allSettled(affected.account.user.destinations
        .filter((destination) => destination.enabled && destination.pairedAt)
        .map((destination) => sendTelegramMessage(destination.chatId,
          "⚠️ <b>Send status is uncertain.</b>\n\nCheck Outlook before trying again; MailPulse will not retry automatically.")));
    }
    return "UNKNOWN";
  }
}
