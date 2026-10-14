import { describe, expect, it } from "vitest";
import { detectMimeType, normalizeTelegramAttachment, sanitizeFilename } from "./attachments";

describe("Telegram attachment metadata", () => {
  it("gives Telegram photos a unique JPEG filename and MIME type", () => {
    const result = normalizeTelegramAttachment(
      { file_id: "telegram-file", file_unique_id: "unique_ABCD1234" },
      "photo",
      { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), filePath: "photos/file_42.jpg" },
      new Date("2026-10-14T18:57:00Z"),
    );

    expect(result).toEqual({
      filename: "IMG_20261014_185700_ABCD1234.jpg",
      mimeType: "image/jpeg",
    });
  });

  it("keeps a safe document filename and corrects its MIME type from the bytes", () => {
    const result = normalizeTelegramAttachment(
      { file_id: "1", file_name: "quarterly/report", mime_type: "application/octet-stream" },
      "document",
      { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
      new Date(),
    );

    expect(result).toEqual({ filename: "quarterly_report.pdf", mimeType: "application/pdf" });
  });

  it("detects common iPhone and web image containers", () => {
    expect(detectMimeType(new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])))
      .toBe("image/heic");
    expect(detectMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      .toBe("image/png");
  });

  it("removes path separators and control characters from filenames", () => {
    expect(sanitizeFilename(" ../bad\\name\u0000.jpg ")).toBe("_bad_name_.jpg");
  });
});