import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupTestApps, loginCookie, makeTestApp, TEST_PASSWORD, TEST_USER } from "./helpers";
import { configFromEnv, positiveInt } from "../src/config";
import { verifyPassword } from "../src/auth/passwords";

afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanupTestApps();
});

describe("config", () => {
  it("defaults issue SSE limits and accepts positive integer environment values", () => {
    vi.stubEnv("KIRIKO_ISSUE_SSE_MAX_CONNECTIONS", "");
    vi.stubEnv("KIRIKO_ISSUE_SSE_MAX_PER_VERSION", "");
    expect(configFromEnv()).toMatchObject({
      issueSseMaxConnections: 512,
      issueSseMaxPerVersion: 128,
    });

    vi.stubEnv("KIRIKO_ISSUE_SSE_MAX_CONNECTIONS", "24");
    vi.stubEnv("KIRIKO_ISSUE_SSE_MAX_PER_VERSION", "6");
    expect(configFromEnv()).toMatchObject({
      issueSseMaxConnections: 24,
      issueSseMaxPerVersion: 6,
    });
  });

  it.each(["0", "-1", "1.5", "many"])("falls back for invalid positive integer value %j", (value) => {
    expect(positiveInt(value, 19)).toBe(19);
  });
});

describe("auth", () => {
  it("rejects bad credentials and accepts the bootstrap user", async () => {
    const { app } = await makeTestApp();
    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: TEST_USER, password: "wrong" },
    });
    expect(bad.statusCode).toBe(401);

    const good = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: TEST_USER, password: TEST_PASSWORD },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().user.username).toBe(TEST_USER);
    expect(good.json().user.role).toBe("admin");
    expect(good.cookies.some((c) => c.name === "kiriko_session" && c.httpOnly)).toBe(true);
  });

  it("me reflects the session; logout invalidates it", async () => {
    const { app } = await makeTestApp();
    const anon = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(anon.statusCode).toBe(401);

    const cookie = await loginCookie(app);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe(TEST_USER);

    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it("rejects malformed stored hashes instead of verifying trivially", () => {
    expect(verifyPassword("anything", "scrypt$ab$zz")).toBe(false);
    expect(verifyPassword("anything", "scrypt$$")).toBe(false);
    expect(verifyPassword("anything", "plain$deadbeef$deadbeef")).toBe(false);
  });

  it("sets the Secure cookie attribute when secureCookies is enabled", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { buildApp } = await import("../src/app");
    const app = await buildApp({
      dataDir: mkdtempSync(join(tmpdir(), "kiriko-secure-")),
      sessionTtlDays: 30,
      secureCookies: true,
      issueSseMaxConnections: 512,
      issueSseMaxPerVersion: 128,
      bootstrapUser: TEST_USER,
      bootstrapPassword: TEST_PASSWORD,
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: TEST_USER, password: TEST_PASSWORD },
      });
      expect(res.cookies.find((c) => c.name === "kiriko_session")?.secure).toBe(true);
    } finally {
      await app.close();
    }
  });
});
