import { Receiver } from "@upstash/qstash";
import { z } from "zod";
import { db } from "@/lib/db";
import { processScheduledOutgoing } from "@/services/serverless-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ outgoingId: z.string().min(1).max(64) });

function receiver(): Receiver {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) throw new Error("QStash signing keys are not configured");
  return new Receiver({ currentSigningKey, nextSigningKey });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  if (!signature) return new Response("Unauthorized", { status: 401 });

  try {
    await receiver().verify({ signature, body: rawBody, url: request.url });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return new Response("Invalid job", { status: 400 });
  const result = await processScheduledOutgoing(db, parsed.data.outgoingId);
  if (result === "TOO_EARLY") {
    return new Response("Scheduled time has not arrived", { status: 503, headers: { "Retry-After": "1" } });
  }
  return new Response(null, { status: 204 });
}
