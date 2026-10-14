# MailPulse

MailPulse is a private, single-user Outlook manager operated from Telegram. It runs as a Next.js serverless application, stores durable state in Supabase Postgres, and uses Upstash QStash for signed delayed jobs and reconciliation.

## Implemented

- Microsoft personal-account OAuth with PKCE, signed state, owner-email enforcement, encrypted refresh tokens, and refresh handling.
- Microsoft Graph Inbox delta synchronization plus change-notification subscriptions and automatic renewal.
- Durable email/attachment metadata in Supabase; attachment bytes are streamed only when needed.
- Authorized Telegram notifications, commands, Reply/Reply All drafts, previews, incoming/outgoing attachments, confirmation, and cancellation.
- A database-enforced, atomic **10-second Undo Send** window.
- Signed QStash jobs, duplicate-update protection, conservative unknown-send handling, and stale-worker recovery without blind retries.
- Password-protected operational dashboard, liveness/readiness endpoints, RLS on all application tables, and pooled TLS database connections.

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

The dashboard uses HTTP Basic authentication. Its username is `DASHBOARD_USERNAME` (default `mailpulse`) and its password is `DASHBOARD_PASSWORD`. Use it only over HTTPS outside localhost.

## Production deployment

1. Import this directory into Vercel and select the Hobby plan.
2. Copy every variable from `.env.example` into Vercel Production environment variables, using the real values from `.env.local`.
3. Set these URL values to the final Vercel domain:
   - `APPLICATION_BASE_URL=https://YOUR-PROJECT.vercel.app`
   - `MICROSOFT_REDIRECT_URI=https://YOUR-PROJECT.vercel.app/api/oauth/microsoft/callback`
4. Add that exact redirect URI to the MailPulse Microsoft Entra application.
5. Deploy, then pull/use the production environment locally and run:

```powershell
npm run bootstrap:production
```

That command refuses localhost. It registers the Telegram webhook, initializes Outlook delta sync, creates the Graph subscription, and creates/updates the QStash five-minute maintenance schedule.

6. Verify:
   - `GET /api/health/live` returns 200.
   - `GET /api/health/ready` returns 200.
   - The authenticated dashboard shows Outlook, Telegram, and Webhook as active.
   - Send a harmless email to the connected mailbox, reply from Telegram, preview it, tap Send, and test Undo within 10 seconds.

Do not run a live email send as part of automated tests. The final end-to-end send requires the owner’s deliberate Telegram confirmation.

## Security notes

- The browser never receives the database password, Microsoft secret, bot token, QStash keys, or token-encryption key.
- Supabase’s publishable key has no table policies and therefore no application-data access; Prisma is server-only.
- Rotate a leaked credential immediately. Rotating `ENCRYPTION_KEY` requires a token re-encryption migration.
- Free tiers are suitable for this one-user workload, but they do not provide paid recovery/SLA guarantees. Keep external mailbox data as the source of truth.