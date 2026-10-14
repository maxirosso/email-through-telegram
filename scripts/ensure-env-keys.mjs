import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../.env.local", import.meta.url);
let contents = await readFile(path, "utf8");

const required = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  DATABASE_URL: "",
  DIRECT_URL: "",
  APPLICATION_BASE_URL: "",
  MICROSOFT_CLIENT_ID: "",
  MICROSOFT_CLIENT_SECRET: "",
  MICROSOFT_REDIRECT_URI: "",
  MICROSOFT_OWNER_EMAIL: "",
  MICROSOFT_WEBHOOK_CLIENT_STATE: "",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_CHAT_ID: "",
  TELEGRAM_USER_ID: "",
  TELEGRAM_WEBHOOK_SECRET: "",
  ENCRYPTION_KEY: "",
  SESSION_SECRET: "",
  QSTASH_URL: "https://qstash-us-east-1.upstash.io",
  QSTASH_TOKEN: "",
  QSTASH_CURRENT_SIGNING_KEY: "",
  QSTASH_NEXT_SIGNING_KEY: "",
  DEFAULT_TIMEZONE: "America/Buenos_Aires",
  UNDO_SEND_SECONDS: "10",
  WORKER_POLL_MS: "1000",
  LOG_LEVEL: "info",
};

const added = [];
for (const [name, defaultValue] of Object.entries(required)) {
  const pattern = new RegExp(`^${name}=`, "m");
  if (!pattern.test(contents)) {
    contents = `${contents.trimEnd()}\n${name}="${defaultValue}"\n`;
    added.push(name);
  }
}

await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ added, preservedExistingValues: true }));
