export type AuthCallback =
  | { kind: "code"; code: string }
  | { kind: "tokens"; accessToken: string; refreshToken: string };

export function readAuthCallback(rawUrl: string): AuthCallback | null {
  const url = new URL(rawUrl);
  const code = url.searchParams.get("code");
  if (code) return { kind: "code", code };

  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (accessToken && refreshToken) {
    return { kind: "tokens", accessToken, refreshToken };
  }
  return null;
}
