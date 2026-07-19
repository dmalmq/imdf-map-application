import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { openDb } from "../src/db/db";
import { migrate } from "../src/db/migrate";

const cleanups: Array<() => Promise<void>> = [];

export const TEST_USER = "test";
export const TEST_PASSWORD = "test-password";

export function newTestPublicVersionId(): string {
  return randomBytes(32).toString("hex");
}

/** Opens a fresh migrated SQLite database without booting the Fastify app. */
export function makeTestDb(): Database.Database {
  const dataDir = mkdtempSync(join(tmpdir(), "kiriko-db-test-"));
  const db = openDb(dataDir);
  migrate(db);
  cleanups.push(async () => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return db;
}

export async function makeTestApp(): Promise<{ app: FastifyInstance; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), "kiriko-test-"));
  const app = await buildApp({
    dataDir,
    sessionTtlDays: 30,
    secureCookies: false,
    issueSseMaxConnections: 512,
    issueSseMaxPerVersion: 128,
    bootstrapUser: TEST_USER,
    bootstrapPassword: TEST_PASSWORD,
  });
  cleanups.push(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { app, dataDir };
}

export async function cleanupTestApps(): Promise<void> {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
}

/** Logs in as the bootstrap user; returns the session cookie header value. */
export async function loginCookie(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: TEST_USER, password: TEST_PASSWORD },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  const cookie = res.cookies.find((c) => c.name === "kiriko_session");
  if (!cookie) {
    throw new Error("no session cookie set");
  }
  return `kiriko_session=${cookie.value}`;
}
