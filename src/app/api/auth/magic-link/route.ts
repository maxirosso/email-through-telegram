import { z } from "zod";
import { db } from "@/lib/db";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
const bodySchema = z.object({ email: z.string().email().max(320) });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const publicSignups = process.env.ALLOW_PUBLIC_SIGNUPS === "true";
  const approved = publicSignups
    ? null
    : await db.applicationUser.findUnique({ where: { email }, select: { id: true } });
  if (!publicSignups && !approved) {
    return Response.json({ error: "This email has not been approved by the MailPulse administrator yet." }, { status: 403 });
  }
  const baseUrl = process.env.APPLICATION_BASE_URL;
  if (!baseUrl) return Response.json({ error: "Authentication is not configured." }, { status: 503 });
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${baseUrl}/auth/callback`,
      shouldCreateUser: publicSignups || Boolean(approved),
    },
  });
  if (error) {
    const safe = error.message.toLowerCase().includes("signups")
      ? "This email has not been invited yet."
      : "Unable to send a sign-in link right now.";
    return Response.json({ error: safe }, { status: 400 });
  }
  return Response.json({ ok: true });
}
