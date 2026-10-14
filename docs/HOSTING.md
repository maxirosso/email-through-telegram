# Hosting architecture

MailPulse uses a free serverless layout with tenant-isolated application data:

```text
Telegram + Microsoft Graph
          |
          v
Vercel Hobby: Next.js dashboard and signed webhook/job endpoints
          |
          +------> Supabase Free: PostgreSQL
          |
          +<------ Upstash QStash Free: durable 10-second callbacks
```

No always-running server is required. Vercel starts functions when HTTP requests arrive. Supabase keeps durable state, and QStash wakes the send endpoint after the Undo window.

See `HOSTING-SERVERLESS.md` for the failure model, required QStash secrets, and deployment details.

## Optional paid fallback

`railway.worker.toml` remains available only as an optional always-on worker deployment if free-tier limits or service guarantees later become insufficient. It is not part of the zero-cost deployment.

## Deployment status

The single-owner baseline is deployed at `https://mailpulse-topaz.vercel.app`. The multi-tenant release remains local until the pending SaaS migration is backed up/rehearsed, applied once, rechecked with Supabase advisors, and accepted with the manual release checklist in `PRODUCTION-HANDOFF.md`.
