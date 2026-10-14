import { DraftStatus, PrismaClient } from "@prisma/client";

export type UndoResult = "CANCELLED" | "TOO_LATE" | "NOT_FOUND";

export class OutgoingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly defaultUndoSeconds = 10,
  ) {}

  async schedule(draftId: string, undoSeconds = this.defaultUndoSeconds, now = new Date()) {
    const deadline = new Date(now.getTime() + undoSeconds * 1000);
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.emailDraft.findUniqueOrThrow({ where: { id: draftId } });
      if (
        draft.status !== DraftStatus.DRAFT &&
        draft.status !== DraftStatus.READY &&
        draft.status !== DraftStatus.CANCELLED
      ) {
        throw new Error(`Draft cannot be scheduled from ${draft.status}`);
      }
      await tx.emailDraft.update({ where: { id: draftId }, data: { status: DraftStatus.SCHEDULED } });
      return tx.outgoingMessage.upsert({
        where: { draftId },
        create: {
          draftId,
          status: DraftStatus.SCHEDULED,
          confirmedAt: now,
          scheduledSendAt: deadline,
          cancellationDeadline: deadline,
        },
        update: {
          status: DraftStatus.SCHEDULED,
          confirmedAt: now,
          scheduledSendAt: deadline,
          cancellationDeadline: deadline,
          cancelledAt: null,
          claimedAt: null,
          sentAt: null,
          errorDetails: null,
        },
      });
    });
  }

  async undo(outgoingId: string, now = new Date()): Promise<UndoResult> {
    return this.prisma.$transaction(async (tx) => {
      const outgoing = await tx.outgoingMessage.findUnique({ where: { id: outgoingId } });
      if (!outgoing) return "NOT_FOUND";
      const cancelled = await tx.outgoingMessage.updateMany({
        where: {
          id: outgoingId,
          status: DraftStatus.SCHEDULED,
          cancellationDeadline: { gte: now },
        },
        data: { status: DraftStatus.CANCELLED, cancelledAt: now },
      });
      if (cancelled.count !== 1) return "TOO_LATE";
      await tx.emailDraft.update({
        where: { id: outgoing.draftId },
        data: { status: DraftStatus.CANCELLED },
      });
      return "CANCELLED";
    });
  }

  async returnToEditing(outgoingId: string, now = new Date()): Promise<UndoResult> {
    const result = await this.undo(outgoingId, now);
    if (result === "CANCELLED") {
      const outgoing = await this.prisma.outgoingMessage.findUniqueOrThrow({ where: { id: outgoingId } });
      await this.prisma.emailDraft.update({
        where: { id: outgoing.draftId },
        data: { status: DraftStatus.DRAFT },
      });
    }
    return result;
  }
}
