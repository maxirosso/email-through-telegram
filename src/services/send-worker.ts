import { DraftStatus, PrismaClient } from "@prisma/client";
import type { EmailProvider } from "@/providers/email-provider";
import { recordSentUsage } from "./quota";
import { writeAudit } from "./audit";
import { recordOperationalAlert } from "./alerts";

export type ProviderFactory = (accountId: string) => Promise<EmailProvider>;

export class SendWorker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerFor: ProviderFactory,
  ) {}

  async processOne(now = new Date()): Promise<boolean> {
    const candidate = await this.prisma.outgoingMessage.findFirst({
      where: { status: DraftStatus.SCHEDULED, scheduledSendAt: { lte: now } },
      orderBy: { scheduledSendAt: "asc" },
    });
    if (!candidate) return false;

    const claimed = await this.prisma.outgoingMessage.updateMany({
      where: {
        id: candidate.id,
        status: DraftStatus.SCHEDULED,
        scheduledSendAt: { lte: now },
      },
      data: { status: DraftStatus.SENDING, claimedAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return true;

    const outgoing = await this.prisma.outgoingMessage.findUniqueOrThrow({
      where: { id: candidate.id },
      include: { draft: { include: { account: { select: { userId: true } } } } },
    });
    await this.prisma.emailDraft.update({
      where: { id: outgoing.draftId },
      data: { status: DraftStatus.SENDING },
    });

    try {
      const provider = await this.providerFor(outgoing.draft.accountId);
      await provider.sendDraft(outgoing.draft.providerDraftId);
      await this.prisma.$transaction([
        this.prisma.outgoingMessage.update({
          where: { id: outgoing.id },
          data: { status: DraftStatus.SENT, sentAt: new Date() },
        }),
        this.prisma.emailDraft.update({
          where: { id: outgoing.draftId },
          data: { status: DraftStatus.SENT },
        }),
      ]);
      await recordSentUsage(outgoing.draft.account.userId);
      await writeAudit({ userId: outgoing.draft.account.userId, action: "EMAIL_SENT", entityType: "OutgoingMessage", entityId: outgoing.id });
    } catch (error) {
      // A network failure after starting send is ambiguous. Never retry automatically.
      const detail = error instanceof Error ? error.message : "Unknown provider error";
      await this.prisma.$transaction([
        this.prisma.outgoingMessage.update({
          where: { id: outgoing.id },
          data: { status: DraftStatus.UNKNOWN_SEND_STATUS, errorDetails: detail },
        }),
        this.prisma.emailDraft.update({
          where: { id: outgoing.draftId },
          data: { status: DraftStatus.UNKNOWN_SEND_STATUS },
        }),
      ]);
      await recordOperationalAlert({
        userId: outgoing.draft.account.userId, accountId: outgoing.draft.accountId,
        dedupeKey: `send-uncertain:${outgoing.id}`, kind: "SEND_UNCERTAIN",
        title: "Email send status is uncertain", message: detail.slice(0, 1000),
      });
    }
    return true;
  }
}
