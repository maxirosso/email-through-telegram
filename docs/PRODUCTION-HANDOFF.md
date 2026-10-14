# MailPulse Production Handoff

Last updated: 2026-10-14
Production URL: https://mailpulse-topaz.vercel.app

## Executive status

MailPulse has a deployed, verified single-owner production baseline for Outlook and Telegram. It receives Outlook email, notifies the authorized Telegram chat, creates reply/reply-all drafts, accepts files and iPhone photos, previews replies, and sends after a durable 10-second undo window.

The tenant-aware Outlook/Telegram foundation is deployed and its production migration is applied. It is suitable for the owner's personal use and an invite-only pilot within free-tier limitations. It is not yet a finished commercial multi-provider SaaS.

Supabase Auth still needs project-level configuration and the first owner invite. Until then, the HTTPS-only Basic-auth bootstrap remains the working dashboard login. Gmail, Microsoft 365 shared-mailbox validation, paid billing, commercial backup/SLA coverage, and the final human acceptance run remain outside this release.

## Completed and deployed

### Infrastructure

- Next.js is deployed on Vercel.
- Supabase Postgres is the durable cloud database; production data is not stored locally.
- Upstash QStash US East provides signed delayed jobs and scheduled maintenance.
- No always-on server is required. Vercel runs APIs and QStash invokes background work.
- Microsoft Graph handles Outlook OAuth, sync, webhooks, drafts, attachments, and sending.
- Telegram Bot API is the private operational interface.
- Health endpoints exist at `/api/health/live` and `/api/health/ready`.

### Outlook and Telegram behavior

- Microsoft personal-account OAuth uses PKCE and signed, expiring state.
- Microsoft tokens are encrypted at rest.
- Inbox sync uses Graph delta cursors.
- Graph subscriptions are created and renewed.
- Telegram webhooks require the configured secret header.
- Access is restricted to the paired owner user/chat.
- Duplicate Telegram updates are safely ignored.
- Incoming notifications support Reply and Reply All.
- Provider drafts and previews are created before sending.
- Sends are persisted before QStash schedules them.
- Undo Send is 10 seconds and send work is claimed atomically.
- Ambiguous sends become `UNKNOWN_SEND_STATUS` and are not blindly retried.
- Maintenance detects stale send workers.
- Incoming attachments can be downloaded through Telegram.
- Outgoing photos/documents are attached to Outlook drafts.
- Multiple attachments and removal are supported.
- iPhone photos receive useful filenames and MIME types instead of generic `attachment` files.
- Attachment size/count limits and idempotency are enforced.

### Security

- Secrets remain server-side, are Git-ignored, and are not intentionally rendered in the browser.
- The Supabase publishable key has no application-table policies.
- Prisma data access is server-only.
- Existing tables have RLS enabled with no public client policies.
- Database connections use Supabase pooling and TLS.
- QStash signatures are verified.
- Provider tokens are encrypted.
- OAuth state is signed and time-limited.
- The deployed dashboard has an HTTPS-only Basic-auth fallback.
- The baseline limits Microsoft OAuth to the configured owner email.
- External calls have timeouts and processing loops are bounded.
- Database constraints protect provider IDs, deliveries, Telegram updates, and outgoing drafts.

### Last verified release

Vercel deployment `dpl_AW34fqdgcY6SFD5Wtj7adkJAfh4j` is live at the production URL. The release passed 21 tests, TypeScript checking, the Next.js 16.4 production build, readiness checks, HTTP 200 live/ready/login/dashboard checks, and HTTP 401 rejection checks for unsigned Telegram, send-job, and dashboard-export requests.

## Architecture

```text
Microsoft Graph webhook --+
Telegram webhook ---------+--> Vercel / Next.js --> Supabase Postgres
QStash signed jobs -------+          |
                                     +--> Microsoft Graph
                                     +--> Telegram Bot API
```

The mailbox remains the source of truth for email. MailPulse stores operational metadata, provider IDs, drafts, delivery state, sync checkpoints, and encrypted tokens.

## Tenant foundation shipped in this release

The deployed SaaS foundation includes:

- `prisma/schema.prisma` and applied migration `prisma/migrations/20261014220000_saas_foundation/migration.sql`.
- Supabase magic-link login, callback, logout, and session middleware.
- Server-only dashboard authorization with a Basic-auth bootstrap fallback.
- Supabase Auth identity-to-tenant linkage.
- Subscription plans and monthly usage counters.
- Tenant audit events and deduplicated operational alerts.
- Support cases, retention settings, and deletion requests.
- Expiring one-time Telegram pairing codes.
- Gmail/Microsoft provider types and primary/shared mailbox mode.
- Supporting indexes, foreign keys, check constraints, and deny-by-default RLS.
- Audit, alert, quota, and pairing services.

These changes are integrated, migrated, tested, and deployed. The database now has 19 public application tables with RLS enabled; the six new tables expose no `SELECT` privilege to `anon` or `authenticated`.

### P0 implementation update (2026-10-14)

Completed and deployed:

- Tenant-scoped dashboard reads and server-side actions.
- Tenant-bound Microsoft OAuth with cross-tenant mailbox takeover prevention.
- One-time private-chat Telegram pairing through `/start MP-######`.
- Authenticated setup/operations dashboard with mailbox health, messages, sends, deliveries, alerts, audits, quota, settings, support, export, retention, and deletion-request controls.
- Safe failed-notification retry; uncertain email sends remain non-retryable.
- Pre-schedule quota checks including scheduled/in-flight reservations, with usage counted only after confirmed provider send.
- Audit events for auth linkage, OAuth, pairing, settings, send/undo, alert acknowledgement, export, support, disconnect, deletion requests, and confirmed/uncertain sends.
- Deduplicated alerts for sync, subscription removal, delivery, maintenance, retention, and uncertain-send failures.
- Per-mailbox maintenance failure isolation and safe retention cleanup that excludes messages referenced by drafts.
- Automated cross-tenant denial tests for alerts, mailbox operations, and delivery retry.
- Current Supabase SSR token refresh/cache-header handling.

Verified:

- Prisma client generation and schema validation.
- 21 automated tests pass across 7 files.
- TypeScript checking passes.
- Next.js 16.4 production build passes.
- Existing production readiness check passes: database ready, Outlook connected, Graph webhook active, Telegram paired.
- An encrypted, locally verified pre-migration logical backup exists at `backups/mailpulse-pre-saas-20261014-165321.mpbk`; plaintext was never written.
- Migration `20261014220000_saas_foundation` is recorded exactly once in `_prisma_migrations`.
- Post-migration Supabase security advisor has only the expected informational `rls_enabled_no_policy` findings for deliberately server-only tables.
- Post-migration performance advisor has only unused-index informational findings; the indexes are retained because they support production query and foreign-key access paths as data grows.
- Production bootstrap renewed the Telegram webhook, Graph subscription/sync state, and QStash schedule.
- Production readiness reports database ready, Outlook connected, Graph webhook active, Telegram paired, 51 messages, 0 scheduled sends, and 3 sent messages.
- The first maintenance pass applied the new default 90-day retention to historical data before the intended production policy was persisted. The encrypted backup was restored idempotently, restoring the original 51-message count, and the current tenant retention is now 3650 days.

Still intentionally gated:

- With a Supabase project-admin credential, set Auth Site URL to `https://mailpulse-topaz.vercel.app`, allow production/local `/auth/callback` URLs, disable provider-level public signup, and invite/link the owner.
- Rotate the Supabase database password in the project dashboard, then replace the production and local database URLs. The current management token cannot perform this project-admin action, and the credential appeared in local command output during a failed CLI backup dry run.
- Run the human acceptance checks, including a deliberate live send. Automated verification must never send a real email.
- Move encrypted backups to independent protected storage and rehearse a restore before treating this as a commercial recovery process.

## P0 release gate status

1. Completed: tenant scoping across dashboard, OAuth, Telegram, send/undo, retry, export, support, and settings paths; provider webhooks and signed jobs resolve ownership from durable server-side records.
2. Completed: one-time pairing through `/start MP-######` in a private chat.
3. Completed: tenant operations dashboard with Basic-auth bootstrap and Supabase session support.
4. Completed: settings, alert acknowledgement, safe delivery retry, support, export, retention, and deletion-request/cancellation actions.
5. Completed: quota enforcement before scheduling and usage after confirmed send.
6. Completed: security/critical action audits and failure alerts.
7. Completed: mailbox-isolated maintenance and draft-safe retention cleanup.
8. Completed: cross-tenant denial tests, Prisma validation, tests, typecheck, and build.
9. Completed: encrypted pre-migration backup, one-time migration, schema/RLS verification, and post-migration advisors.
10. Completed: production deployment, bootstrap, readiness, positive HTTP checks, and negative signature/auth checks.
11. Pending project-admin action: Supabase Auth configuration, owner invite, and database-password rotation.
12. Pending human action: acceptance workflow and deliberate live send.

## Remaining requested product features

### Guided onboarding

- The dashboard setup checklist and reconnect/disconnect states are implemented.
- Add production/local Supabase Auth callback URLs at project level and invite the owner.
- Keep signup invite-only unless public signup is deliberately approved. `ALLOW_PUBLIC_SIGNUPS=false` already blocks app-route creation, but provider-level signup must also be disabled.

### Shared Outlook mailboxes

- Configure Entra for organizational accounts.
- Add delegated `Mail.ReadWrite.Shared` and `Mail.Send.Shared`.
- Implement mailbox selection/validation.
- Route Graph operations and subscriptions to the selected mailbox.
- Test send-as/send-on-behalf with a real Microsoft 365 tenant.

### Gmail

Gmail is represented in the deployed schema only. A complete provider does not exist.

- Create a Google Cloud OAuth app and enable Gmail API.
- Add OAuth credentials and redirect URI.
- Implement token refresh, inbox/history sync, drafts, reply/reply-all, attachments, sending, revocation, and watch renewal.
- Complete Google OAuth verification if external clients use it.

### Operations dashboard

The tenant dashboard exposes setup health, recent messages, draft/scheduled/sent/failed/uncertain history, notification attempts, safe retries, alerts, audits, quota, retention, export/deletion, and support. Continue keeping these controls on the web rather than expanding Telegram commands.

### Billing and quotas

- The owner can remain on the free plan.
- Select Stripe or another provider before paid plans.
- Add checkout, customer portal, signed/idempotent webhooks, cancellations, and plan-to-quota mapping.
- Never trust plan state supplied by the browser.

The deployed schema supports billing state; no payment provider is integrated.

### Backups, support, and privacy

- Free Supabase is practical for personal use but is not a commercial recovery/SLA guarantee.
- Add encrypted logical exports to separate storage or use a plan with suitable backups/PITR.
- Perform a restore drill and define recovery objectives.
- Finish the support form, admin queue, and operator runbook.
- Add reviewed privacy policy, terms, subprocessors, retention, export, and erasure procedures.
- Revoke sessions during identity deletion; deleting an Auth user does not immediately invalidate every existing token.

## Credentials still needed

Already configured for the baseline: Supabase connections/publishable key, Telegram bot/webhook data, Microsoft client credentials and webhook secret, QStash token/signing keys, encryption/session secrets, and dashboard credentials.

Needed for expanded features or final hardening:

- A Supabase project-admin credential or dashboard access to configure Auth, invite the owner, and rotate the database password.
- Supabase Auth redirect: `https://mailpulse-topaz.vercel.app/auth/callback`, plus the local callback for development.
- Supabase server secret only for automated Auth administration/deletion; never prefix it with `NEXT_PUBLIC_`.
- Google OAuth credentials and callback.
- Stripe secret, webhook secret, and price IDs if paid billing is enabled.
- Optional external monitoring webhook.
- Separate secure backup destination if independent backups are required.

Never commit or paste secret values into documentation, screenshots, or client-side environment variables.

## Migration record

Migration `20261014220000_saas_foundation` was backed up, reviewed, applied once with Prisma Migrate, verified in `_prisma_migrations`, and followed by table/RLS/privilege checks and both Supabase advisors. Do not manually replay or edit this applied migration; create a new migration for later schema changes.

## Release gates

All must pass:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run check:readiness`
- Supabase advisor review.
- Live/ready HTTP 200.
- Outlook OAuth/reconnect.
- Incoming notification and text reply.
- One and multiple iPhone-photo/file replies.
- Correct recipient filenames/MIME types.
- Undo within 10 seconds and confirmed send afterward.
- Duplicate-update protection.
- Invalid QStash/Telegram signature rejection.
- Unauthorized Telegram rejection.
- Cross-tenant isolation.
- Failure alert/acknowledgement.
- Export/delete and retention cleanup.
- Provider reconnect/recovery.

Automated tests must not send real email. A human must deliberately confirm the final live-send test.

## Recommended Telegram UX

Keep visible commands limited to `/inbox`, `/drafts`, `/status`, `/settings`, and `/help`. Keep Reply, Reply All, Add attachment, Send, Undo, and Cancel as contextual buttons. Put history, retries, billing, retention, export/delete, support, and audits in the dashboard.

## Honest readiness assessment

- Deployed single-owner version: operationally ready for personal use, with free-tier availability/recovery limitations understood.
- Tenant-aware Outlook/Telegram release: deployed and technically verified, but Supabase Auth project configuration and human acceptance are still required before inviting another tenant.
- Commercial product: not finished. Gmail, shared mailbox validation, paid billing, commercial backups, privacy/legal work, monitoring, and support operations remain.

## Recommended execution order

1. Configure Supabase Auth, invite/link the owner, and rotate the exposed database credential.
2. Run and record the human acceptance workflow and deliberate live send.
3. Move encrypted backups to separate protected storage and rehearse recovery.
4. Validate Microsoft 365 shared mailboxes.
5. Implement and verify Gmail.
6. Add Stripe only if paid plans are needed.
7. Establish commercial monitoring, privacy/legal, and support procedures.
