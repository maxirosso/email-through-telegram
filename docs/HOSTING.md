# Hosting architecture

MailPulse uses a free serverless layout for one personal user:

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

## Not yet deployed

No Vercel or Upstash account is connected and no public service has been created. Deployment should happen after the remaining Microsoft OAuth, mailbox synchronization, and complete Telegram reply workflows are implemented and tested.