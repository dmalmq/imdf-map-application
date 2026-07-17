import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestApps, loginCookie, makeTestApp, TEST_PASSWORD, TEST_USER } from "./helpers";

afterEach(cleanupTestApps);

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
});
