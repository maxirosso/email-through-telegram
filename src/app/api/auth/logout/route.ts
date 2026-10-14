import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getDashboardUser } from "@/auth/dashboard-session";
import { writeAudit } from "@/services/audit";

export async function POST(request: Request) {
  const user = await getDashboardUser();
  if (user) await writeAudit({
    userId: user.id, actorAuthUserId: user.authUserId, action: "SIGNED_OUT",
    entityType: "ApplicationUser", entityId: user.id,
  });
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
