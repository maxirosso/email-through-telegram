# Free serverless hosting

MailPulse uses Vercel Hobby, Supabase Free, and Upstash QStash Free. It does not require an always-on worker.

- Graph change notifications are the fast path for new mail.
- A signed QStash maintenance request every five minutes reconciles missed changes, renews subscriptions, expires idempotency records, and identifies interrupted sends.
- QStash invokes `/api/jobs/send` after the ten-second cancellation deadline.
- Every QStash endpoint verifies the signature against the raw request body and exact public URL.
- Only one request can atomically claim a scheduled send. Transport ambiguity becomes `UNKNOWN_SEND_STATUS` and is never automatically retried.

Deploy with `vercel.json`, set the production environment variables, then run `npm run bootstrap:production` using the production environment. The bootstrap command is idempotent and uses a stable QStash schedule ID.

Render Free is unnecessary for this architecture. An always-on service can still run `src/worker.ts`, but it must not run at the same time as the QStash send path unless operationally intentional.