import { requireDashboardUser } from "@/auth/dashboard-session";
import { getTenantDashboardData } from "@/services/tenant-operations";

export const dynamic = "force-dynamic";

function when(value?: Date | null) {
  return value ? value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "Never";
}

function ActionForm({ action, id, label, danger = false }: { action: string; id?: string; label: string; danger?: boolean }) {
  return <form action="/api/dashboard/actions" method="post" className="inline-form">
    <input type="hidden" name="action" value={action} />
    {id && <input type="hidden" name="id" value={id} />}
    <button className={danger ? "text-button danger" : "text-button"}>{label}</button>
  </form>;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ microsoft?: string; result?: string; welcome?: string }> }) {
  const user = await requireDashboardUser();
  const params = await searchParams;
  const data = await getTenantDashboardData(user.id);
  const connected = data.accounts.some((account) => account.enabled && account.connectionStatus === "CONNECTED");
  const paired = Boolean(data.destination);
  const webhook = data.accounts.some((account) => account.webhookSubscriptionId && account.webhookExpiresAt && account.webhookExpiresAt > new Date());
  const pairingCode = params.result?.startsWith("pair:") ? params.result.slice(5) : undefined;
  const settings = data.settings;
  const quotaLimit = data.subscription?.monthlyMessageLimit ?? 1000;

  return <main>
    <nav className="topbar">
      <div><b>MailPulse</b><span>{user.email ?? "Bootstrap operator"}</span></div>
      <form action="/api/auth/logout" method="post"><button className="text-button">Sign out</button></form>
    </nav>

    <section className="hero compact">
      <div className="eyebrow">TENANT OPERATIONS</div>
      <h1>Your inbox, under control.</h1>
      <p>Monitor mailbox health, Telegram delivery, scheduled replies, and recovery actions from one place.</p>
      {params.result && <div className={params.result === "error" ? "notice error" : "notice"}>
        {pairingCode ? <>Pairing code: <b>{pairingCode}</b>. In a private chat with your bot, send <code>/start {pairingCode}</code>. It expires in 15 minutes.</> : params.result.replaceAll("-", " ")}
      </div>}
    </section>

    <section className="panel setup">
      <div className="section-heading"><div><small>GUIDED ONBOARDING</small><h2>Setup checklist</h2></div><span>{[connected, paired, webhook].filter(Boolean).length}/3 ready</span></div>
      <div className="checklist">
        <div className={connected ? "complete" : ""}><b>1</b><span><strong>Connect Outlook</strong><small>{connected ? "Mailbox authorized" : "Authorization required"}</small></span><a className="button small-button" href="/api/oauth/microsoft/start">{connected ? "Reconnect" : "Connect"}</a></div>
        <div className={paired ? "complete" : ""}><b>2</b><span><strong>Pair Telegram</strong><small>{paired ? "Private chat authorized" : "Generate a one-time code"}</small></span>{paired ? <span className="tag">Paired</span> : <ActionForm action="pair" label="Generate code" />}</div>
        <div className={webhook ? "complete" : ""}><b>3</b><span><strong>Activate inbox sync</strong><small>{webhook ? "Webhook subscription active" : "Runs automatically after connection"}</small></span><span className="tag">{webhook ? "Active" : "Pending"}</span></div>
      </div>
    </section>

    <section className="grid stats">
      <article><small>MAILBOXES</small><strong>{data.accounts.length}</strong><p>{connected ? "Connected" : "Needs attention"}<br />Latest sync: {when(data.accounts[0]?.lastSyncedAt)}</p></article>
      <article><small>TELEGRAM</small><strong>{paired ? "Paired" : "Not paired"}</strong><p>{data.destination ? `Chat ${data.destination.chatId.toString()}` : "No destination"}</p></article>
      <article><small>MONTHLY QUOTA</small><strong>{data.usage} / {quotaLimit}</strong><p>{data.pendingUsage} send(s) reserved · {data.subscription?.plan ?? "FREE"} · {data.subscription?.status ?? "ACTIVE"}</p></article>
      <article><small>OPEN ALERTS</small><strong>{data.alerts.filter((alert) => alert.status === "OPEN").length}</strong><p>Failures are deduplicated and rate-limited.</p></article>
      <article><small>MESSAGES</small><strong>{data.messages.length}</strong><p>Showing the 10 most recent tenant messages.</p></article>
      <article><small>SENDS</small><strong>{data.outgoing.filter((item) => item.status === "SENT").length}</strong><p>Recent confirmed sends in this view.</p></article>
    </section>

    <section className="two-column">
      <div className="panel">
        <small>CONNECTED ACCOUNTS</small><h2>Mailbox health</h2>
        {data.accounts.length ? data.accounts.map((account) => <div className="operation-row" key={account.id}>
          <div><strong>{account.emailAddress}</strong><span>{account.provider} · {account.connectionStatus} · sync {when(account.lastSyncedAt)}</span></div>
          {account.enabled && <ActionForm action="disconnect-account" id={account.id} label="Disconnect" danger />}
        </div>) : <p className="muted">No mailbox connected.</p>}
      </div>
      <div className="panel">
        <small>RECENT EMAIL</small><h2>Latest synchronized</h2>
        {data.messages.length ? data.messages.map((message) => <div className="operation-row" key={message.id}>
          <div><strong>{message.subject}</strong><span>{message.senderName || message.senderAddress}</span></div><time>{when(message.receivedAt)}</time>
        </div>) : <p className="muted">No synchronized messages yet.</p>}
      </div>
    </section>

    <section className="two-column">
      <div className="panel">
        <small>SEND HISTORY</small><h2>Draft and delivery state</h2>
        {data.outgoing.map((item) => <div className="operation-row" key={item.id}><div><strong>{item.draft.subject}</strong><span>{item.status}{item.errorDetails ? ` · ${item.errorDetails}` : ""}</span></div><time>{when(item.updatedAt)}</time></div>)}
        {!data.outgoing.length && <p className="muted">No outgoing messages.</p>}
      </div>
      <div className="panel">
        <small>NOTIFICATIONS</small><h2>Telegram deliveries</h2>
        {data.deliveries.map((delivery) => <div className="operation-row" key={delivery.id}><div><strong>{delivery.message.subject}</strong><span>{delivery.status} · {delivery.attempts} attempt(s){delivery.lastError ? ` · ${delivery.lastError}` : ""}</span></div>{delivery.status === "FAILED" && <ActionForm action="retry-delivery" id={delivery.id} label="Retry safely" />}</div>)}
        {!data.deliveries.length && <p className="muted">No notification attempts.</p>}
      </div>
    </section>

    <section className="two-column">
      <div className="panel">
        <small>OPERATIONAL ALERTS</small><h2>Failures and recovery</h2>
        {data.alerts.map((alert) => <div className="operation-row" key={alert.id}><div><strong>{alert.title}</strong><span>{alert.message} · seen {alert.occurrenceCount} time(s)</span></div>{alert.status === "OPEN" ? <ActionForm action="ack-alert" id={alert.id} label="Acknowledge" /> : <span className="tag">{alert.status}</span>}</div>)}
        {!data.alerts.length && <p className="muted">No operational alerts.</p>}
      </div>
      <div className="panel">
        <small>AUDIT TRAIL</small><h2>Security-sensitive activity</h2>
        {data.audits.map((event) => <div className="operation-row" key={event.id}><div><strong>{event.action}</strong><span>{event.entityType}{event.entityId ? ` · ${event.entityId}` : ""}</span></div><time>{when(event.createdAt)}</time></div>)}
        {!data.audits.length && <p className="muted">No audit events.</p>}
      </div>
    </section>

    <section className="panel">
      <small>SETTINGS & PRIVACY</small><h2>Tenant controls</h2>
      <form action="/api/dashboard/actions" method="post" className="settings-grid">
        <input type="hidden" name="action" value="settings" />
        <label>Timezone<input name="timezone" defaultValue={settings?.timezone ?? "America/Buenos_Aires"} required /></label>
        <label>Undo seconds<input name="undoSendSeconds" type="number" min="1" max="300" defaultValue={settings?.undoSendSeconds ?? 10} required /></label>
        <label>Message retention days<input name="messageRetentionDays" type="number" min="7" max="3650" defaultValue={settings?.messageRetentionDays ?? 90} required /></label>
        <label>Audit retention days<input name="auditRetentionDays" type="number" min="30" max="3650" defaultValue={settings?.auditRetentionDays ?? 365} required /></label>
        <label className="checkbox"><input name="alertOnFailure" type="checkbox" defaultChecked={settings?.alertOnFailure ?? true} /> Notify Telegram on failures</label>
        <button className="button small-button">Save settings</button>
      </form>
      <div className="privacy-actions">
        <a className="text-button" href="/api/dashboard/export">Export my data</a>
        <ActionForm action="retention" label="Run retention now" />
        {settings?.deletionRequestedAt
          ? <ActionForm action="cancel-deletion" label="Cancel deletion request" />
          : <ActionForm action="request-deletion" label="Request account deletion" danger />}
      </div>
      {settings?.deletionRequestedAt && <p className="notice error">Deletion requested {when(settings.deletionRequestedAt)}. The operator must revoke active Auth sessions before final erasure.</p>}
    </section>

    <section className="panel">
      <small>SUPPORT</small><h2>Open a support case</h2>
      <form action="/api/dashboard/actions" method="post" className="stack">
        <input type="hidden" name="action" value="support" />
        <label>Subject<input name="subject" minLength={3} maxLength={160} required /></label>
        <label>What happened?<textarea name="message" minLength={10} maxLength={5000} rows={4} required /></label>
        <button className="button small-button">Submit case</button>
      </form>
      {data.supportCases.map((item) => <div className="operation-row" key={item.id}><div><strong>{item.subject}</strong><span>{item.status} · {when(item.createdAt)}</span></div></div>)}
    </section>
  </main>;
}
