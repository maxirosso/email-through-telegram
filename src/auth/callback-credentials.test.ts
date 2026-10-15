import { describe, expect, it } from "vitest";
import { readAuthCallback } from "./callback-credentials";

describe("readAuthCallback", () => {
  it("reads a PKCE authorization code", () => {
    expect(readAuthCallback("https://mailpulse.example/auth/callback?code=pkce-code"))
      .toEqual({ kind: "code", code: "pkce-code" });
  });

  it("reads the implicit session returned by the default Supabase magic-link template", () => {
    expect(readAuthCallback("https://mailpulse.example/auth/callback#access_token=access&refresh_token=refresh&type=magiclink"))
      .toEqual({ kind: "tokens", accessToken: "access", refreshToken: "refresh" });
  });

  it("rejects callbacks without complete credentials", () => {
    expect(readAuthCallback("https://mailpulse.example/auth/callback#error=access_denied")).toBeNull();
  });
});
