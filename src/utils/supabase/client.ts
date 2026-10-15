import { createBrowserClient } from "@supabase/ssr";

export function createClient(options?: { detectSessionInUrl?: boolean }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase browser environment is not configured");
  return createBrowserClient(url, key, {
    auth: { detectSessionInUrl: options?.detectSessionInUrl ?? true },
  });
}
