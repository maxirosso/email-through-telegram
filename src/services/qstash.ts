import { Client, Receiver } from "@upstash/qstash";
import { config } from "@/config";

export function qstashClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  const baseUrl = process.env.QSTASH_URL;
  if (!token || !baseUrl) throw new Error("QStash is not configured");
  return new Client({ token, baseUrl });
}

export async function verifyQstashRequest(request: Request, rawBody: string): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  const signature = request.headers.get("upstash-signature");
  if (!currentSigningKey || !nextSigningKey || !signature) return false;
  try {
    await new Receiver({ currentSigningKey, nextSigningKey }).verify({
      signature, body: rawBody, url: request.url,
    });
    return true;
  } catch {
    return false;
  }
}

export async function enqueueSync(accountId: string, providerMessageId?: string) {
  const body = { accountId, ...(providerMessageId ? { providerMessageId } : {}) };
  return qstashClient().publishJSON({
    url: `${config().APPLICATION_BASE_URL}/api/jobs/sync`,
    body,
    retries: 3,
    deduplicationId: `mailpulse-sync-${accountId}-${providerMessageId ?? Math.floor(Date.now() / 60_000)}`,
  });
}