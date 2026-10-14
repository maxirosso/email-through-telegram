import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function when(value?: Date | null) {
  return value ? value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "Never";
}

export default async function Home({ searchParams }: { searchParams: Promise<{ microsoft?: string }> }) {
  const microsoft = (await searchParams).microsoft;
  const [account, destination, messageCount, scheduledCount, sentCount, recent] = await db.$transaction([
    db.emailAccount.findFirst({ orderBy: { createdAt: "asc" } }),
    db.telegramDestination.findFirst({ where: { enabled: true, pairedAt: { not: null } } }),
    db.emailMessage.count(),
    db.outgoingMessage.count({ where: { status: "SCHEDULED" } }),
    db.outgoingMessage.count({ where: { status: "SENT" } }),
    db.emailMessage.findMany({ orderBy: { receivedAt: "desc" }, take: 6 }),
  ]);
  const connected = account?.connectionStatus === "CONNECTED";
  const status = microsoft === "error" ? "Outlook connection failed — try again"
    : connected ? "Outlook connected securely" : "Connect your Outlook mailbox to finish setup";

  return (
    <main>
      <section className="hero compact">
        <div className="eyebrow">MAILPULSE CONTROL PANEL</div>
        <h1>Your inbox, moving at your pace.</h1>
        <p>Outlook monitoring and Telegram replies with a durable 10-second Undo Send window.</p>
        <div className={`status ${connected ? "good" : ""}`}><span />{status}</div>
        <div><a className="button" href="/api/oauth/microsoft/start">{connected ? "Reconnect Outlook" : "Connect Outlook"}</a></div>
      </section>
      <section className="grid stats">
        <article><small>OUTLOOK</small><strong>{account?.emailAddress ?? "Not connected"}</strong><p>{account?.connectionStatus ?? "DISCONNECTED"}<br />Last sync: {when(account?.lastSyncedAt)}</p></article>
        <article><small>TELEGRAM</small><strong>{destination ? "Paired" : "Not paired"}</strong><p>{destination ? "Private owner chat authorized" : "Run the pairing script"}<br />Notifications: {account?.notificationsOn ? "On" : "Paused"}</p></article>
        <article><small>WEBHOOK</small><strong>{account?.webhookSubscriptionId ? "Active" : "Pending deployment"}</strong><p>Expires: {when(account?.webhookExpiresAt)}<br />Renewed automatically.</p></article>
        <article><small>EMAILS</small><strong>{messageCount}</strong><p>Synchronized safely with provider IDs.</p></article>
        <article><small>SCHEDULED</small><strong>{scheduledCount}</strong><p>Each send has a 10-second cancellation deadline.</p></article>
        <article><small>SENT</small><strong>{sentCount}</strong><p>Uncertain outcomes are never retried blindly.</p></article>
      </section>
      <section className="panel">
        <div><small>RECENT EMAIL</small><h2>Latest synchronized messages</h2></div>
        {recent.length ? <div className="mail-list">{recent.map((message) => (
          <div className="mail-row" key={message.id}>
            <div><strong>{message.subject}</strong><span>{message.senderName || message.senderAddress}</span></div>
            <time>{when(message.receivedAt)}</time>
          </div>
        ))}</div> : <p className="muted">Messages will appear after the production webhook and reconciliation schedule are activated.</p>}
      </section>
    </main>
  );
}