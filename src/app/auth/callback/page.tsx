"use client";

import { useEffect, useRef, useState } from "react";
import { readAuthCallback } from "@/auth/callback-credentials";
import { createClient } from "@/utils/supabase/client";

export default function AuthCallbackPage() {
  const started = useRef(false);
  const [message, setMessage] = useState("Securely signing you in...");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function finishSignIn() {
      const callback = readAuthCallback(window.location.href);
      const supabase = createClient({ detectSessionInUrl: false });
      let error: Error | null = null;

      if (callback?.kind === "code") {
        ({ error } = await supabase.auth.exchangeCodeForSession(callback.code));
      } else if (callback?.kind === "tokens") {
        ({ error } = await supabase.auth.setSession({
          access_token: callback.accessToken,
          refresh_token: callback.refreshToken,
        }));
      } else {
        error = new Error("The sign-in link did not contain a session");
      }

      // Remove credentials from browser history before leaving this page.
      window.history.replaceState(null, "", "/auth/callback");
      if (error) {
        setMessage("This sign-in link could not be completed. Returning to login...");
        window.location.replace("/login?error=callback");
        return;
      }
      window.location.replace("/?welcome=1");
    }

    void finishSignIn();
  }, []);

  return <main className="auth-shell">
    <section className="auth-card" aria-live="polite">
      <div className="brand-mark">MP</div>
      <small>MAILPULSE</small>
      <h1>Opening your dashboard</h1>
      <p className="auth-lead">{message}</p>
    </section>
  </main>;
}
