import { describe, expect, it } from "vitest";
import { parseRecipients, validateBody, validateSubject } from "./compose";

describe("Telegram new-email input", () => {
  it("accepts, normalizes, and deduplicates multiple recipients", () => {
    expect(parseRecipients("One@Example.com, two@example.com; one@example.com")).toEqual([
      { address: "one@example.com" },
      { address: "two@example.com" },
    ]);
  });

  it("rejects malformed recipients", () => {
    expect(() => parseRecipients("not-an-email")).toThrow();
  });

  it("requires bounded subjects and non-empty bodies", () => {
    expect(validateSubject("  Project update  ")).toBe("Project update");
    expect(() => validateSubject(" ")).toThrow();
    expect(validateBody("  Everything is ready.  ")).toBe("Everything is ready.");
    expect(() => validateBody("\n")).toThrow();
  });
});
