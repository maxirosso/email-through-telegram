import { NextResponse, type NextRequest } from "next/server";

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function proxy(request: NextRequest) {
  const expectedUser = process.env.DASHBOARD_USERNAME || "mailpulse";
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedPassword) return new NextResponse("Dashboard authentication is not configured", { status: 503 });

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      if (separator > 0 && await digest(username) === await digest(expectedUser) &&
          await digest(password) === await digest(expectedPassword)) {
        return NextResponse.next();
      }
    } catch {}
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="MailPulse", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: ["/((?!api/telegram/webhook|api/microsoft/webhook|api/jobs|api/health|api/oauth/microsoft/callback|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};