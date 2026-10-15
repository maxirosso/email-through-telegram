export const TELEGRAM_EMAIL_CHUNK_LENGTH = 3_800;
export const TELEGRAM_EMAIL_FILE_THRESHOLD = TELEGRAM_EMAIL_CHUNK_LENGTH * 8;

function safeBoundary(value: string, index: number): number {
  if (index > 0 && /[\uD800-\uDBFF]/.test(value[index - 1] ?? "")) return index - 1;
  return index;
}

export function splitTelegramEmail(
  value: string,
  maxLength = TELEGRAM_EMAIL_CHUNK_LENGTH,
): string[] {
  if (maxLength < 1) throw new Error("Chunk length must be positive");
  let remaining = value.replaceAll("\r\n", "\n").trim();
  if (!remaining) return ["(This email has no text body.)"];

  const chunks: string[] = [];
  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    const minimumNaturalBreak = Math.floor(maxLength * 0.55);
    const candidates = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" ")];
    let boundary = candidates.find((candidate) => candidate >= minimumNaturalBreak) ?? maxLength;
    boundary = safeBoundary(remaining, boundary);
    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function fullEmailFilename(subject: string): string {
  const safeSubject = subject
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${safeSubject || "email"}.txt`;
}
