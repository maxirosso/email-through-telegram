import { z } from "zod";
import { db } from "@/lib/db";
import { MailSyncService } from "@/services/mail-sync";
import { verifyQstashRequest } from "@/services/qstash";
import { recordOperationalAlert } from "@/services/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  accountId: z.string().min(1).max(64),
  providerMessageId: z.string().min(1).max(512).optional(),
});

export async function POST(request: Request) {
  const raw = await request.text();
  if (!(await verifyQstashRequest(request, raw))) return new Response("Unauthorized", { status: 401 });
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return new Response("Invalid job", { status: 400 });
  const service = new MailSyncService(db);
  try {
    if (parsed.data.providerMessageId) {
      await service.processMessageId(parsed.data.accountId, parsed.data.providerMessageId);
    } else {
      await service.syncAccount(parsed.data.accountId);
    }
  } catch (error) {
    const account = await db.emailAccount.findUnique({ where: { id: parsed.data.accountId }, select: { userId: true } });
    if (account) await recordOperationalAlert({
      userId: account.userId, accountId: parsed.data.accountId, dedupeKey: `sync:${parsed.data.accountId}`,
      kind: "SYNC_FAILED", title: "Mailbox synchronization failed",
      message: error instanceof Error ? error.message.slice(0, 1000) : "Unknown synchronization error",
    });
    throw error;
  }
  return new Response(null, { status: 204 });
}
