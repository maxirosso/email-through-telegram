import { z } from "zod";
import { config } from "@/config";
import { db } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";

const tokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int(),
  scope: z.string().optional(),
});
export type MicrosoftTokens = z.infer<typeof tokenSchema>;

const TOKEN_ENDPOINT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

export async function accessTokenForAccount(accountId: string): Promise<string> {
  const account = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (account.provider !== "MICROSOFT") throw new Error("Unsupported email provider");
  const env = config();
  const tokens = tokenSchema.parse(decryptJson(account.encryptedTokens, env.ENCRYPTION_KEY));
  if (tokens.expiresAt > Date.now() + 120_000) return tokens.accessToken;

  const body = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    scope: "offline_access Mail.ReadWrite Mail.Send User.Read",
  });
  if (env.MICROSOFT_CLIENT_SECRET) body.set("client_secret", env.MICROSOFT_CLIENT_SECRET);

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await db.emailAccount.update({ where: { id: accountId }, data: { connectionStatus: "REAUTH_REQUIRED" } });
    throw new Error(`Microsoft token refresh failed (${response.status})`);
  }
  const refreshed = z.object({
    access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number(), scope: z.string().optional(),
  }).parse(await response.json());
  const next: MicrosoftTokens = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    scope: refreshed.scope,
  };
  await db.emailAccount.update({
    where: { id: accountId },
    data: { encryptedTokens: encryptJson(next, env.ENCRYPTION_KEY), connectionStatus: "CONNECTED" },
  });
  return next.accessToken;
}
