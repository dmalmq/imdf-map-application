import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import type { AppConfig } from "../src/config";
import { seedDevUsers, DEV_USERS, DEV_PASSWORD } from "../src/auth/devSeed";
import { hashPassword, verifyPassword } from "../src/auth/passwords";
import { cleanupTestApps, makeTestDb } from "./helpers";

const baseConfig: AppConfig = {
  dataDir: "",
  sessionTtlDays: 30,
  secureCookies: false,
  issueSseMaxConnections: 512,
  issueSseMaxPerVersion: 128,
};

interface UserRow {
  username: string;
  role: string;
  password_hash: string;
}

function users(db: Database.Database): UserRow[] {
  return db
    .prepare("SELECT username, role, password_hash FROM users ORDER BY username")
    .all() as UserRow[];
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanupTestApps();
});

describe("seedDevUsers", () => {
  it("seeds one account per role with the dev password when opted in", () => {
    const db = makeTestDb();
    seedDevUsers(db, { ...baseConfig, seedDevUsers: true });

    const rows = users(db);
    expect(rows.map((r) => [r.username, r.role])).toEqual([
      ["admin", "admin"],
      ["member", "member"],
      ["viewer", "viewer"],
    ]);
    for (const row of rows) {
      expect(verifyPassword(DEV_PASSWORD, row.password_hash)).toBe(true);
    }
    // The exported table is the source of truth for docs/tests.
    expect(DEV_USERS.map((u) => u.username)).toEqual(["admin", "member", "viewer"]);
  });

  it("does nothing when the flag is off", () => {
    const db = makeTestDb();
    seedDevUsers(db, { ...baseConfig, seedDevUsers: false });
    expect(users(db)).toHaveLength(0);
  });

  it("is safe to re-run and keeps the dev password", () => {
    const db = makeTestDb();
    seedDevUsers(db, { ...baseConfig, seedDevUsers: true });
    seedDevUsers(db, { ...baseConfig, seedDevUsers: true });
    const rows = users(db);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(verifyPassword(DEV_PASSWORD, row.password_hash)).toBe(true);
    }
  });

  it("resets a pre-existing account to the dev password (upsert)", () => {
    const db = makeTestDb();
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')").run(
      hashPassword("some-other-password"),
    );
    seedDevUsers(db, { ...baseConfig, seedDevUsers: true });
    const admin = users(db).find((r) => r.username === "admin")!;
    expect(verifyPassword(DEV_PASSWORD, admin.password_hash)).toBe(true);
    expect(verifyPassword("some-other-password", admin.password_hash)).toBe(false);
    expect(users(db)).toHaveLength(3);
  });

  it("refuses to seed under NODE_ENV=production even when opted in", () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = makeTestDb();
    const warnings: string[] = [];
    seedDevUsers(db, { ...baseConfig, seedDevUsers: true }, (message) => warnings.push(message));
    expect(users(db)).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
