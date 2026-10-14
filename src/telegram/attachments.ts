export type TelegramAttachmentKind = "document" | "photo";

export type TelegramAttachmentInput = {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
};

type NormalizedAttachment = {
  filename: string;
  mimeType: string;
};

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

const EXTENSION_MIMES: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXTENSIONS).map(([mime, extension]) => [extension, mime]),
);
EXTENSION_MIMES.jpeg = "image/jpeg";

function beginsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectMimeType(bytes: Uint8Array): string | undefined {
  if (beginsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (beginsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (beginsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (beginsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (["avif", "avis"].includes(brand)) return "image/avif";
  }
  return undefined;
}

function validMimeType(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)
    ? normalized
    : undefined;
}

function pathExtension(path?: string): string | undefined {
  const match = path?.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match?.[1];
}

export function sanitizeFilename(value: string): string {
  const safe = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 180);
  return safe || "attachment";
}

function generatedFilename(
  kind: TelegramAttachmentKind,
  extension: string,
  receivedAt: Date,
  uniqueId: string,
): string {
  const timestamp = receivedAt.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  const suffix = uniqueId.replace(/[^a-z0-9]/gi, "").slice(-8) || "file";
  return `${kind === "photo" ? "IMG" : "file"}_${timestamp}_${suffix}.${extension}`;
}

export function normalizeTelegramAttachment(
  input: TelegramAttachmentInput,
  kind: TelegramAttachmentKind,
  download: { bytes: Uint8Array; filePath?: string },
  receivedAt: Date,
): NormalizedAttachment {
  const detectedMime = detectMimeType(download.bytes);
  const suppliedMime = validMimeType(input.mime_type);
  const extensionFromPath = pathExtension(download.filePath);
  const mimeType = detectedMime
    ?? suppliedMime
    ?? (extensionFromPath ? EXTENSION_MIMES[extensionFromPath] : undefined)
    ?? (kind === "photo" ? "image/jpeg" : "application/octet-stream");
  const extension = MIME_EXTENSIONS[mimeType] ?? extensionFromPath ?? "bin";

  if (input.file_name) {
    const filename = sanitizeFilename(input.file_name);
    return {
      filename: /\.[a-z0-9]{1,10}$/i.test(filename) ? filename : `${filename}.${extension}`,
      mimeType,
    };
  }

  return {
    filename: generatedFilename(kind, extension, receivedAt, input.file_unique_id ?? input.file_id),
    mimeType,
  };
}