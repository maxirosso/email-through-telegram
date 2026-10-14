import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const stateSchema = z.object({
  state: z.string().min(32),
  verifier: z.string().min(43),
  expiresAt: z.number().int(),
  userId: z.string().min(1).max(64).optional(),
});

export const MICROSOFT_OAUTH_COOKIE = "mailpulse_ms_oauth";

export function createMicrosoftOAuthState(secret: string, userIdOrNow?: string | number, clock = Date.now()) {
  const userId = typeof userIdOrNow === "string" ? userIdOrNow : undefined;
  const now = typeof userIdOrNow === "number" ? userIdOrNow : clock;
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ state, verifier, userId, expiresAt: now + 10 * 60_000 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return {
    state,
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    cookieValue: payload + "." + signature,
  };
}

export function verifyMicrosoftOAuthState(cookieValue: string, returnedState: string, secret: string, now = Date.now()) {
  const [payload, signature, extra] = cookieValue.split(".");
  if (!payload || !signature || extra) throw new Error("Invalid OAuth state cookie");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("Invalid OAuth state signature");
  const parsed = stateSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (parsed.expiresAt < now || parsed.state !== returnedState) throw new Error("Expired or mismatched OAuth state");
  return parsed;
}
