import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { createClient } from "@/utils/supabase/server";
import { verifyBasicAuthorization } from "./basic-auth";

export type DashboardUser = {
  id: string;
  authUserId: string | null;
  email: string | null;
  displayName: string | null;
  isPlatformAdmin: boolean;
  bootstrap: boolean;
};

async function provisionAuthUser(authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }) {
  const email = authUser.email?.trim().toLowerCase();
  if (!email) throw new Error("Your Supabase account does not have a verified email address");
  return db.$transaction(async (tx) => {
    let user = await tx.applicationUser.findUnique({ where: { authUserId: authUser.id } });
    if (!user) {
      const existing = await tx.applicationUser.findUnique({ where: { email } });
      if (!existing && process.env.ALLOW_PUBLIC_SIGNUPS !== "true") {
        throw new Error("This email has not been approved by the MailPulse administrator");
      }
      if (existing?.authUserId && existing.authUserId !== authUser.id) {
        throw new Error("This email is already linked to another identity");
      }
      const displayName = typeof authUser.user_metadata?.full_name === "string"
        ? authUser.user_metadata.full_name.slice(0, 120)
        : email.split("@")[0];
      user = existing
        ? await tx.applicationUser.update({ where: { id: existing.id }, data: { authUserId: authUser.id, displayName: existing.displayName ?? displayName } })
        : await tx.applicationUser.create({ data: { authUserId: authUser.id, email, displayName } });
      await tx.auditEvent.create({
        data: { userId: user.id, actorAuthUserId: authUser.id, action: "AUTH_LINKED", entityType: "ApplicationUser", entityId: user.id },
      });
    }
    await tx.applicationSettings.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    await tx.billingSubscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, plan: "FREE", status: "ACTIVE", monthlyMessageLimit: 1000 },
      update: {},
    });
    return user;
  });
}

export async function getDashboardUser(): Promise<DashboardUser | null> {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (authUser) {
    const user = await provisionAuthUser({
      id: authUser.id,
      email: authUser.email,
      user_metadata: authUser.user_metadata,
    });
    return { ...user, bootstrap: false };
  }

  const authorization = (await headers()).get("authorization");
  if (await verifyBasicAuthorization(authorization)) {
    const user = await db.applicationUser.findFirst({ orderBy: { createdAt: "asc" } });
    return user ? { ...user, bootstrap: true } : null;
  }
  return null;
}

export async function requireDashboardUser(): Promise<DashboardUser> {
  const user = await getDashboardUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  return user;
}
