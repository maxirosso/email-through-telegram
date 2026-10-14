import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config } from "@/config";
import { createMicrosoftOAuthState, MICROSOFT_OAUTH_COOKIE } from "@/auth/microsoft-oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = config();
  const oauth = createMicrosoftOAuthState(env.SESSION_SECRET);
  const authorizeUrl = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
  authorizeUrl.search = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: env.MICROSOFT_REDIRECT_URI,
    response_mode: "query",
    scope: "offline_access User.Read Mail.ReadWrite Mail.Send",
    state: oauth.state,
    code_challenge: oauth.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  const cookieStore = await cookies();
  cookieStore.set(MICROSOFT_OAUTH_COOKIE, oauth.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/oauth/microsoft/callback",
  });
  return NextResponse.redirect(authorizeUrl);
}