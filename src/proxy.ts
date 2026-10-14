import { NextResponse, type NextRequest } from "next/server";
import { verifyBasicAuthorization } from "@/auth/basic-auth";
import { updateSession } from "@/utils/supabase/middleware";

const PUBLIC_PATHS = [
  "/login", "/auth/callback", "/api/auth/magic-link",
  "/api/telegram/webhook", "/api/microsoft/webhook", "/api/google/webhook",
  "/api/jobs/", "/api/health/", "/api/oauth/microsoft/callback", "/api/oauth/google/callback",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => path.endsWith("/") ? pathname.startsWith(path) : pathname === path);
}

export async function proxy(request: NextRequest) {
  if (isPublic(request.nextUrl.pathname)) return NextResponse.next();
  let response = NextResponse.next({ request });
  let userId: string | undefined;
  try {
    ({ response, userId } = await updateSession(request));
  } catch {
    // The HTTPS-only Basic credential remains the emergency bootstrap path
    // when Supabase Auth is temporarily unavailable.
  }
  if (userId) return response;
  if (await verifyBasicAuthorization(request.headers.get("authorization"))) return response;

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
