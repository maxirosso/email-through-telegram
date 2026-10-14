"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email") }),
    });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Check your email for the secure sign-in link." : payload.error ?? "Sign-in failed.");
    setPending(false);
  }
  return <main className="auth-shell">
    <section className="auth-card">
      <div className="brand-mark">MP</div>
      <small>MAILPULSE</small>
      <h1>Run email operations without living in your inbox.</h1>
      <p>Sign in with a secure email link. No dashboard password is stored in your browser.</p>
      <form onSubmit={submit} className="stack">
        <label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@company.com" /></label>
        <button className="button" disabled={pending}>{pending ? "Sending…" : "Email me a sign-in link"}</button>
      </form>
      {message && <p className="notice">{message}</p>}
      <p className="fine-print">Access is invitation-only unless public signup is enabled by the operator.</p>
    </section>
  </main>;
}