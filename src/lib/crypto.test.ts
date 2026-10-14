import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "./crypto";

describe("credential encryption", () => {
  it("round trips authenticated JSON", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptJson({ refreshToken: "secret", expiresAt: 123 }, key);
    expect(encrypted).not.toContain("secret");
    expect(decryptJson(encrypted, key)).toEqual({ refreshToken: "secret", expiresAt: 123 });
  });

  it("rejects tampering", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptJson({ token: "secret" }, key);
    expect(() => decryptJson(`${encrypted.slice(0, -1)}A`, key)).toThrow();
  });
});
