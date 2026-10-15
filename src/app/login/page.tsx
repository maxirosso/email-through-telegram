"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setHasError(false);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const payload = await response.json().catch(() => ({}));
      setHasError(!response.ok);
      setMessage(response.ok
        ? "Check your inbox. Open the secure link to continue setting up MailPulse."
        : payload.error ?? "We could not send the link. Check the address and try again.");
    } catch {
      setHasError(true);
      setMessage("MailPulse could not be reached. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }
  return <main className="auth-shell">
    <section className="auth-card">
      <div className="brand-mark">MP</div>
      <small>MAILPULSE</small>
      <h1>Use your Outlook email from Telegram.</h1>
      <p className="auth-lead">This website is for secure setup. Once connected, you can read, reply to, and send email from the MailPulse bot.</p>
      <div className="auth-steps" aria-label="How MailPulse works">
        <div><b>1</b><span><strong>Sign in</strong><small>Use your invited email address</small></span></div>
        <div><b>2</b><span><strong>Connect Outlook</strong><small>Authorize your own mailbox</small></span></div>
        <div><b>3</b><span><strong>Pair Telegram</strong><small>Use the bot for daily email</small></span></div>
      </div>
      <form onSubmit={submit} className="stack">
        <label>Your invited email address<input name="email" type="email" autoComplete="email" required placeholder="you@company.com" /></label>
        <button className="button" disabled={pending}>{pending ? "Sending…" : "Email me a sign-in link"}</button>
      </form>
      {message && <p className={hasError ? "notice error" : "notice"}>{message}</p>}
      <p className="fine-print"><b>Invitation-only:</b> New clients must be approved before they can sign in. No dashboard password is stored.</p>
    </section>
  </main>;
}
