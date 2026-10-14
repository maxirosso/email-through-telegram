import { z } from "zod";
import { db } from "@/lib/db";
import { MailSyncService } from "@/services/mail-sync";
import { verifyQstashRequest } from "@/services/qstash";

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
  if (parsed.data.providerMessageId) {
    await service.processMessageId(parsed.data.accountId, parsed.data.providerMessageId);
  } else {
    await service.syncAccount(parsed.data.accountId);
  }
  return new Response(null, { status: 204 });
}