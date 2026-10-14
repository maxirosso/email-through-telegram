import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../.env.local", import.meta.url);
let contents = await readFile(path, "utf8");

function setValue(name, value) {
  const line = `${name}="${value}"`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  contents = pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.trimEnd()}\n${line}\n`;
}

setValue("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
setValue("SESSION_SECRET", randomBytes(32).toString("hex"));
setValue("TELEGRAM_WEBHOOK_SECRET", randomBytes(32).toString("hex"));
setValue("MICROSOFT_WEBHOOK_CLIENT_STATE", randomBytes(32).toString("hex"));

await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ secretsGenerated: true, valuesExposed: false }));
