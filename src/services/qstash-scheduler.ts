import { Client } from "@upstash/qstash";
import { config } from "@/config";
import { db } from "@/lib/db";
import { OutgoingService } from "./outgoing";

function qstashClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error("QSTASH_TOKEN is not configured");
  const baseUrl = process.env.QSTASH_URL;
  if (!baseUrl) throw new Error("QSTASH_URL is not configured");
  return new Client({ token, baseUrl });
}

export async function scheduleServerlessSend(draftId: string) {
  const env = config();
  const service = new OutgoingService(db, env.UNDO_SEND_SECONDS);
  const outgoing = await service.schedule(draftId, env.UNDO_SEND_SECONDS);

  try {
    const result = await qstashClient().publishJSON({
      url: `${env.APPLICATION_BASE_URL}/api/jobs/send`,
      body: { outgoingId: outgoing.id },
      delay: env.UNDO_SEND_SECONDS,
      retries: 3,
      deduplicationId: `mailpulse-send-${outgoing.id}-${outgoing.confirmedAt?.getTime() ?? Date.now()}`,
    });
    return { outgoing, qstashMessageId: "messageId" in result ? result.messageId : undefined };
  } catch (error) {
    // A publish timeout is ambiguous: the remote job might exist. Returning the row
    // to DRAFT makes any late delivery a no-op. Never overwrite SENDING or SENT.
    const reverted = await db.$transaction(async (tx) => {
      const changed = await tx.outgoingMessage.updateMany({
        where: { id: outgoing.id, status: "SCHEDULED" },
        data: { status: "CANCELLED", cancelledAt: new Date(), errorDetails: "QStash scheduling failed" },
      });
      if (changed.count === 1) {
        await tx.emailDraft.update({ where: { id: draftId }, data: { status: "DRAFT" } });
      }
      return changed.count === 1;
    });
    if (!reverted) throw new Error("Scheduling outcome is uncertain; check message status before retrying", { cause: error });
    throw error;
  }
}
