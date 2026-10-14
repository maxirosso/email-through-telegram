export async function verifyBasicAuthorization(value: string | null): Promise<boolean> {
  const expectedUser = process.env.DASHBOARD_USERNAME || "mailpulse";
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedPassword || !value?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(value.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 1) return false;
    const [actualUser, actualPassword] = [decoded.slice(0, separator), decoded.slice(separator + 1)];
    const digest = async (input: string) => {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    return await digest(actualUser) === await digest(expectedUser)
      && await digest(actualPassword) === await digest(expectedPassword);
  } catch {
    return false;
  }
}