import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MICROSOFT_OAUTH_COOKIE, verifyMicrosoftOAuthState } from "@/auth/microsoft-oauth-state";
import { config } from "@/config";
import { encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});

const profileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().nullable().optional(),
  mail: z.string().nullable().optional(),
  userPrincipalName: z.string().nullable().optional(),
  otherMails: z.array(z.string()).optional(),
});

function home(request: Request, status: "connected" | "error") {
  return new URL("/?microsoft=" + status, request.url);
}

export async function GET(request: Request) {
  const env = config();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(MICROSOFT_OAUTH_COOKIE)?.value;
  cookieStore.delete(MICROSOFT_OAUTH_COOKIE);
  if (!code || !state || !stateCookie || url.searchParams.has("error")) {
    return NextResponse.redirect(home(request, "error"));
  }

  try {
    const verified = verifyMicrosoftOAuthState(stateCookie, state, env.SESSION_SECRET);
    if (!verified.userId) throw new Error("OAuth state is not linked to a tenant");
    const tokenResponse = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID,
        client_secret: env.MICROSOFT_CLIENT_SECRET,
        code,
        code_verifier: verified.verifier,
        grant_type: "authorization_code",
        redirect_uri: env.MICROSOFT_REDIRECT_URI,
        scope: "offline_access User.Read Mail.ReadWrite Mail.Send",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!tokenResponse.ok) throw new Error("Microsoft token exchange failed");
    const token = tokenSchema.parse(await tokenResponse.json());

    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,otherMails", {
      headers: { Authorization: "Bearer " + token.access_token },
      signal: AbortSignal.timeout(20_000),
    });
    if (!profileResponse.ok) throw new Error("Microsoft profile request failed");
    const profile = profileSchema.parse(await profileResponse.json());
    const profileEmails = [profile.mail, profile.userPrincipalName, ...(profile.otherMails ?? [])]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    const primaryEmail = (profile.mail ?? profile.userPrincipalName ?? profileEmails[0])?.toLowerCase();
    if (!primaryEmail) throw new Error("Microsoft profile did not include an email address");

    const encryptedTokens = encryptJson({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      scope: token.scope,
    }, env.ENCRYPTION_KEY);

    await db.$transaction(async (tx) => {
      const user = await tx.applicationUser.findUniqueOrThrow({ where: { id: verified.userId } });
      const existingAccount = await tx.emailAccount.findUnique({
        where: { provider_providerAccountId: { provider: "MICROSOFT", providerAccountId: profile.id } },
      });
      if (existingAccount && existingAccount.userId !== user.id) {
        throw new Error("This Microsoft mailbox is already connected to another tenant");
      }
      await tx.applicationSettings.upsert({
        where: { userId: user.id },
        create: { userId: user.id, timezone: env.DEFAULT_TIMEZONE, undoSendSeconds: env.UNDO_SEND_SECONDS },
        update: {},
      });
      if (existingAccount) {
        await tx.emailAccount.update({
          where: { id: existingAccount.id },
          data: {
            emailAddress: primaryEmail, encryptedTokens, enabled: true, notificationsOn: true,
            connectionStatus: "CONNECTED",
          },
        });
      } else {
        await tx.emailAccount.create({ data: {
          userId: user.id,
          provider: "MICROSOFT",
          providerAccountId: profile.id,
          emailAddress: primaryEmail,
          encryptedTokens,
        } });
      }
    });
    await writeAudit({
      userId: verified.userId, action: "MICROSOFT_CONNECTED", entityType: "EmailAccount",
      entityId: profile.id, metadata: { emailAddress: primaryEmail },
    });
    return NextResponse.redirect(home(request, "connected"));
  } catch {
    return NextResponse.redirect(home(request, "error"));
  }
}
