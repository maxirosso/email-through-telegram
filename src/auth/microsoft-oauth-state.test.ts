import { describe, expect, it } from "vitest";
import { createMicrosoftOAuthState, verifyMicrosoftOAuthState } from "./microsoft-oauth-state";

describe("Microsoft OAuth state", () => {
  const secret = "a-secure-session-secret-that-is-long-enough";

  it("round-trips a signed PKCE state", () => {
    const created = createMicrosoftOAuthState(secret, 1_000);
    const verified = verifyMicrosoftOAuthState(created.cookieValue, created.state, secret, 2_000);
    expect(verified.verifier).toBe(created.verifier);
    expect(created.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("binds an OAuth attempt to the initiating tenant", () => {
    const created = createMicrosoftOAuthState(secret, "tenant-a", 1_000);
    const verified = verifyMicrosoftOAuthState(created.cookieValue, created.state, secret, 2_000);
    expect(verified.userId).toBe("tenant-a");
  });

  it("rejects a mismatched state", () => {
    const created = createMicrosoftOAuthState(secret, 1_000);
    expect(() => verifyMicrosoftOAuthState(created.cookieValue, "wrong-state-value-that-is-at-least-32", secret, 2_000)).toThrow();
  });

  it("rejects an expired state", () => {
    const created = createMicrosoftOAuthState(secret, 1_000);
    expect(() => verifyMicrosoftOAuthState(created.cookieValue, created.state, secret, 1_000 + 10 * 60_000 + 1)).toThrow();
  });
});
