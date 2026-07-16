// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashPassword, newSessionToken, parseCookies, verifyPassword } from "./auth";

describe("auth", () => {
  it("scrypt hash round-trips and rejects a wrong password", () => {
    const { salt, passwordHash } = hashPassword("secret-pw");
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(passwordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPassword("secret-pw", salt, passwordHash)).toBe(true);
    expect(verifyPassword("wrong", salt, passwordHash)).toBe(false);
    expect(verifyPassword("secret-pw", salt, "zz")).toBe(false);
    expect(verifyPassword("secret-pw", salt, `${passwordHash}zz`)).toBe(false);
  });

  it("session tokens are 64 hex chars and unique", () => {
    const a = newSessionToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newSessionToken()).not.toBe(a);
  });

  it("parses cookie headers tolerantly", () => {
    expect(parseCookies("gis_session=abc; other=1")).toEqual({ gis_session: "abc", other: "1" });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("junk")).toEqual({});
    expect(parseCookies("gis_session=first; gis_session=second")).toEqual({
      gis_session: "first",
    });
  });
});
