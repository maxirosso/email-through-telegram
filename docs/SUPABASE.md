# Supabase connection

Project reference: `qlmoxskoztmmebkwtjzd`

There are three separate connections:

1. **Browser/session client** — `NEXT_PUBLIC_SUPABASE_URL` and the publishable key. These are intentionally public and are stored in `.env.local` (which is gitignored).
2. **MailPulse database runtime** — `DATABASE_URL` uses Supabase's transaction pooler. `DIRECT_URL` is used only by Prisma migrations. Obtain both from the project's **Connect** panel; never paste the database password into chat or commit it.
3. **Codex MCP** — a project-scoped developer connection. Its config reads a PAT from `SUPABASE_ACCESS_TOKEN`; the token is not stored in this repository or in Codex's config file.

## Finish MCP authentication on Windows

Supabase OAuth currently fails in this installed Codex build because the authorization response omits the issuer expected by the client. Use the documented PAT fallback:

```powershell
.\scripts\set-supabase-mcp-token.ps1
```

Restart Codex after running the script so it inherits the environment variable. Then verify with:

```powershell
codex mcp get supabase
```

The MCP is scoped to this project and only enables `docs`, `database`, `debugging`, and `development`. Account management, functions, storage, and branching are not enabled.

## Apply the schema

After `DATABASE_URL` and `DIRECT_URL` are present in `.env.local`:

Before production migration, configure Supabase Auth URL settings:

- Site URL: `https://mailpulse-topaz.vercel.app`
- Production redirect: `https://mailpulse-topaz.vercel.app/auth/callback`
- Local redirect: `http://localhost:3000/auth/callback`
- Keep `ALLOW_PUBLIC_SIGNUPS=false`; invite users through Supabase Auth unless public signup is deliberately approved.

Then take or confirm a recovery point, run the security and performance advisors, and apply exactly once:

```powershell
npm run db:migrate
```

Run both advisors again after migration. The application tables intentionally have RLS with no browser-client policies because all tenant data is accessed by server-only Prisma; the `rls_enabled_no_policy` informational advisor notice is therefore expected.

Do not use the publishable key as a database password or MCP token; it cannot authenticate either connection.
