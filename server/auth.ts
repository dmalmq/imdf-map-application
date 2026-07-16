import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "gis_session";

export function hashPassword(
  password: string,
  salt?: string,
): { salt: string; passwordHash: string } {
  const actualSalt = salt ?? randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, actualSalt, 32).toString("hex");
  return { salt: actualSalt, passwordHash };
}

export function verifyPassword(password: string, salt: string, passwordHash: string): boolean {
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(passwordHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) {
    return cookies;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}
