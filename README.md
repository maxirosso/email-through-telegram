# MailPulse

MailPulse is a tenant-isolated Outlook manager operated from Telegram with a secure web operations dashboard. It runs as a Next.js serverless application, stores durable state in Supabase Postgres, and uses Upstash QStash for signed delayed jobs and reconciliation.

## Implemented

- Microsoft personal-account OAuth with PKCE, signed state, owner-email enforcement, encrypted refresh tokens, and refresh handling.
- Microsoft Graph Inbox delta synchronization plus change-notification subscriptions and automatic renewal.
- Durable email/attachment metadata in Supabase; attachment bytes are streamed only when needed.
- Authorized Telegram notifications plus a polished `/new` compose flow, Reply/Reply All drafts, editable previews, incoming/outgoing attachments, confirmation, cancellation, and Undo Send.
- A database-enforced, atomic **10-second Undo Send** window.
- Signed QStash jobs, duplicate-update protection, conservative unknown-send handling, and stale-worker recovery without blind retries.
- Password-protected operational dashboard, liveness/readiness endpoints, RLS on all application tables, and pooled TLS database connections.
- Supabase magic-link authentication, invite-only tenant provisioning, tenant-bound Outlook OAuth, and one-time Telegram pairing codes.
- Tenant-scoped settings, alerts, audits, quotas, notification retry, support, export/deletion requests, and safe retention cleanup.

## Architecture

```text
Microsoft Graph webhooks ─┐
Telegram webhook ─────────┼─> Vercel / Next.js ─> Supabase Postgres
QStash signed jobs ───────┘          │
                                     └─> Microsoft Graph / Telegram APIs
```

There is no mandatory always-on server. QStash performs the delayed send and invokes maintenance every five minutes; Graph webhooks provide the fast path.

## Local verification

Use Node.js 22 or newer. Put secrets in `.env.local`; never commit it.

```powershell
npm ci
npm run db:migrate
npm test
npm run typecheck
npm run build
npm run dev
```

The dashboard uses Supabase magic-link authentication. HTTP Basic auth (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`) remains an HTTPS-only emergency bootstrap fallback for the original owner tenant.

## Production deployment

1. Import this directory into Vercel and select the Hobby plan.
2. Copy every variable from `.env.example` into Vercel Production environment variables, using the real values from `.env.local`.
3. Set these URL values to the final Vercel domain:
   - `APPLICATION_BASE_URL=https://YOUR-PROJECT.vercel.app`
   - `MICROSOFT_REDIRECT_URI=https://YOUR-PROJECT.vercel.app/api/oauth/microsoft/callback`
4. Set the Supabase Auth Site URL to the production domain, allow `https://YOUR-PROJECT.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`, and keep public signup disabled.
5. Add the Microsoft redirect URI to the MailPulse Microsoft Entra application.
6. Deploy, then pull/use the production environment locally and run:

```powershell
npm run bootstrap:production
```

That command refuses localhost. It registers the Telegram webhook and command menu, initializes Outlook delta sync, creates the Graph subscription, and creates/updates the QStash five-minute maintenance schedule.

7. Verify:
   - `GET /api/health/live` returns 200.
   - `GET /api/health/ready` returns 200.
   - The authenticated dashboard shows Outlook, Telegram, and Webhook as active.
   - Use `/new` to create a harmless new email, review it, tap Send, and test Undo within 10 seconds.
   - Send a harmless email to the connected mailbox and verify Reply and Reply All from Telegram.

Do not run a live email send as part of automated tests. The final end-to-end send requires the owner’s deliberate Telegram confirmation.

## Security notes

- The browser never receives the database password, Microsoft secret, bot token, QStash keys, or token-encryption key.
- Supabase’s publishable key has no table policies and therefore no application-data access; Prisma is server-only.
- Rotate a leaked credential immediately. Rotating `ENCRYPTION_KEY` requires a token re-encryption migration.
- Free tiers are suitable for this one-user workload, but they do not provide paid recovery/SLA guarantees. Keep external mailbox data as the source of truth.
