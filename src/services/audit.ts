import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export async function writeAudit(input: {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  actorAuthUserId?: string | null;
  severity?: "INFO" | "WARNING" | "ERROR";
  metadata?: Prisma.InputJsonValue;
}) {
  return db.auditEvent.create({ data: {
    userId: input.userId,
    action: input.action.slice(0, 100),
    entityType: input.entityType.slice(0, 100),
    entityId: input.entityId?.slice(0, 191),
    actorAuthUserId: input.actorAuthUserId ?? undefined,
    severity: input.severity ?? "INFO",
    metadata: input.metadata,
  } });
}