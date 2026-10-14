import { config } from "@/config";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { MicrosoftGraphProvider } from "@/providers/microsoft-graph";
import { SendWorker } from "@/services/send-worker";
import { accessTokenForAccount } from "@/auth/microsoft-tokens";

const env = config();
const worker = new SendWorker(db, async (accountId) => {
  return new MicrosoftGraphProvider(await accessTokenForAccount(accountId));
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { stopping = true; });
}

logger.info({ pollMs: env.WORKER_POLL_MS }, "send worker started");
while (!stopping) {
  try {
    const worked = await worker.processOne();
    if (!worked) await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_MS));
  } catch (error) {
    logger.error({ err: error }, "worker iteration failed");
    await new Promise((resolve) => setTimeout(resolve, Math.min(env.WORKER_POLL_MS * 5, 30_000)));
  }
}
await db.$disconnect();
logger.info("send worker stopped");
