import { describe, expect, it } from "vitest";
import { fullEmailFilename, splitTelegramEmail } from "./full-email";

describe("full email delivery", () => {
  it("splits long email text at readable boundaries within Telegram's limit", () => {
    const text = `${"A".repeat(2_000)} ${"B".repeat(2_000)}\n\n${"C".repeat(2_000)}`;
    const chunks = splitTelegramEmail(text, 2_500);

    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= 2_500)).toBe(true);
    expect(chunks.join(" ").replaceAll("\n\n", " ")).toContain("A".repeat(2_000));
    expect(chunks.join(" ")).toContain("C".repeat(2_000));
  });

  it("does not split a Unicode surrogate pair at a hard boundary", () => {
    const chunks = splitTelegramEmail(`1234😀5678`, 5);
    expect(chunks[0]).toBe("1234");
    expect(chunks.join("")).toBe("1234😀5678");
  });

  it("creates a filesystem-safe text filename", () => {
    expect(fullEmailFilename('Re: quote / final: "yes"')).toBe("Re quote final yes.txt");
  });
});
