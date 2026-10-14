import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APPLICATION_BASE_URL: z.string().url(),
  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),
  MICROSOFT_REDIRECT_URI: z.string().url(),
  MICROSOFT_WEBHOOK_SECRET: z.string().min(32),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  DEFAULT_TIMEZONE: z.string().default("America/Buenos_Aires"),
  UNDO_SEND_SECONDS: z.coerce.number().int().min(1).max(300).default(10),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(1000),
});

export type Config = z.infer<typeof schema>;
let cached: Config | undefined;
export function config(): Config {
  cached ??= schema.parse(process.env);
  return cached;
}
