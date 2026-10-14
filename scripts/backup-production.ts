import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";

type TableNameRow = { table_name: string };
type ColumnRow = { table_name: string; column_name: string; data_type: string; ordinal_position: number };

function encryptionKey() {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

function replacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return { $type: "bigint", value: value.toString() };
  if (Buffer.isBuffer(value)) return { $type: "bytes", value: value.toString("base64") };
  return value;
}

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error("Pass an encrypted backup output path");
  const names = await db.$queryRaw<TableNameRow[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const safeNames = names.map(({ table_name }) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table_name)) throw new Error("Unsafe table identifier");
    return table_name;
  });
  const columns = await db.$queryRaw<ColumnRow[]>`
    SELECT table_name, column_name, data_type, ordinal_position
    FROM information_schema.columns WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;
  const tables: Record<string, unknown[]> = {};
  for (const table of safeNames) {
    tables[table] = await db.$queryRawUnsafe<unknown[]>(`SELECT * FROM public."${table}"`);
  }
  const migrationRoot = path.resolve("prisma/migrations");
  const migrationFiles: Record<string, string> = {};
  for (const name of [
    "20261013190000_init", "20261013191500_secure_public_tables", "20261013192500_secure_prisma_migrations",
    "20261014120000_webhooks_and_idempotency", "20261014210000_attachment_idempotency", "20261014220000_saas_foundation",
  ]) migrationFiles[name] = await readFile(path.join(migrationRoot, name, "migration.sql"), "utf8");

  const payload = Buffer.from(JSON.stringify({
    format: "mailpulse-logical-backup-v1", createdAt: new Date().toISOString(), columns, tables, migrationFiles,
  }, replacer));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encrypted = Buffer.concat([Buffer.from("MPBK1"), iv, tag, ciphertext]);
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, encrypted, { mode: 0o600 });

  const verify = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  verify.setAuthTag(tag);
  const decoded = Buffer.concat([verify.update(ciphertext), verify.final()]);
  if (!decoded.equals(payload)) throw new Error("Backup verification failed");
  console.log(JSON.stringify({ output: path.resolve(output), tables: safeNames.length, bytes: encrypted.length, verified: true }));
}

main().finally(() => db.$disconnect());
