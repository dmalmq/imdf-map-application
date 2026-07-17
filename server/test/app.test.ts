import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, cleanupTestApps } from "./helpers";

afterEach(cleanupTestApps);

describe("app skeleton", () => {
  it("answers healthz and serves an OpenAPI document", async () => {
    const { app } = await makeTestApp();
    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const spec = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().openapi).toMatch(/^3\./);
  });

  it("runs migrations idempotently", async () => {
    const { app, dataDir } = await makeTestApp();
    const { openDb, migrate } = await import("../src/db/migrate-reexport");
    const db = openDb(dataDir);
    migrate(db); // second run must be a no-op, not an error
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining(["blobs", "jobs", "sessions", "tenants", "users", "venues", "versions"]),
    );
    db.close();
    await app.close();
  });
});
