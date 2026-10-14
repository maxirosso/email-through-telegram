import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
const bodySchema = z.object({ email: z.string().email().max(320) });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const baseUrl = process.env.APPLICATION_BASE_URL;
  if (!baseUrl) return Response.json({ error: "Authentication is not configured." }, { status: 503 });
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email.toLowerCase(),
    options: {
      emailRedirectTo: `${baseUrl}/auth/callback`,
      shouldCreateUser: process.env.ALLOW_PUBLIC_SIGNUPS === "true",
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