# Security policy

Do not report vulnerabilities in a public issue. Rotate any exposed Telegram token, Microsoft client secret, database password, session secret, or encryption key immediately.

Production requirements:

- Keep `.env` and Supabase connection strings out of source control and browser bundles.
- Restrict Microsoft delegated permissions to `offline_access`, `User.Read`, `Mail.ReadWrite`, and `Mail.Send`.
- Accept Telegram webhooks only over HTTPS and validate `X-Telegram-Bot-Api-Secret-Token`.
- Authorize every callback against both Telegram user ID and chat ID.
- Store OAuth tokens only as AES-256-GCM authenticated ciphertext.
- Treat network interruption during a provider send as an unknown outcome; do not retry automatically.
- Retain only attachment metadata unless bytes are actively needed, and delete temporary bytes after completion or cancellation.
