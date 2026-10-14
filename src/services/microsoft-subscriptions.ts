import { accessTokenForAccount } from "@/auth/microsoft-tokens";
import { config } from "@/config";
import { db } from "@/lib/db";

const GRAPH = "https://graph.microsoft.com/v1.0";
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;
const LIFETIME_MS = 6 * 24 * 60 * 60 * 1000;

async function graph(token: string, path: string, init: RequestInit) {
  const response = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Microsoft subscription request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response.status === 204 ? undefined : response.json();
}

export async function ensureMicrosoftSubscription(accountId: string, now = new Date()) {
  const account = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
  const token = await accessTokenForAccount(accountId);
  const expiration = new Date(now.getTime() + LIFETIME_MS);

  if (account.webhookSubscriptionId && account.webhookExpiresAt &&
      account.webhookExpiresAt.getTime() > now.getTime() + RENEW_BEFORE_MS) {
    return account.webhookSubscriptionId;
  }

  if (account.webhookSubscriptionId) {
    try {
      const value = await graph(token, `/subscriptions/${encodeURIComponent(account.webhookSubscriptionId)}`, {
        method: "PATCH", body: JSON.stringify({ expirationDateTime: expiration.toISOString() }),
      }) as { id: string; expirationDateTime: string };
      await db.emailAccount.update({
        where: { id: accountId },
        data: { webhookSubscriptionId: value.id, webhookExpiresAt: new Date(value.expirationDateTime) },
      });
      return value.id;
    } catch {
      await db.emailAccount.update({
        where: { id: accountId }, data: { webhookSubscriptionId: null, webhookExpiresAt: null },
      });
    }
  }

  const webhook = `${config().APPLICATION_BASE_URL}/api/microsoft/webhook`;
  const value = await graph(token, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: webhook,
      lifecycleNotificationUrl: webhook,
      resource: "me/mailFolders('inbox')/messages",
      expirationDateTime: expiration.toISOString(),
      clientState: config().MICROSOFT_WEBHOOK_SECRET,
      latestSupportedTlsVersion: "v1_2",
    }),
  }) as { id: string; expirationDateTime: string };
  await db.emailAccount.update({
    where: { id: accountId },
    data: { webhookSubscriptionId: value.id, webhookExpiresAt: new Date(value.expirationDateTime) },
  });
  return value.id;
}