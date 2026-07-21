import type Database from "better-sqlite3";
import type { AppConfig } from "../config";
import { hashPassword } from "./passwords";

export interface DevUser {
  username: string;
  role: "admin" | "member" | "viewer";
}

/** Dev test accounts — one per role. All share {@link DEV_PASSWORD}. */
export const DEV_USERS: DevUser[] = [
  { username: "admin", role: "admin" },
  { username: "member", role: "member" },
  { username: "viewer", role: "viewer" },
];

/** Shared password for every seeded dev account. Dev-only; never used in production. */
export const DEV_PASSWORD = "password";

/**
 * Seed one account per role for local development so role-gated behavior can be
 * exercised without a user-management UI. Opt-in via `KIRIKO_SEED_DEV_USERS=1`
 * (`config.seedDevUsers`); hard-skipped under `NODE_ENV=production` so seeded
 * credentials can never reach a real deployment.
 *
 * Upserts: every run (re)sets each dev account's password to {@link DEV_PASSWORD}
 * and role, so the known credentials are guaranteed even when an account of the
 * same name already exists (e.g. a prior bootstrap `admin`). Only the three
 * {@link DEV_USERS} are touched; other accounts are untouched.
 */
export function seedDevUsers(
  db: Database.Database,
  config: AppConfig,
  log?: (message: string) => void,
): void {
  if (config.seedDevUsers !== true) {
    return;
  }
  if (process.env["NODE_ENV"] === "production") {
    log?.("KIRIKO_SEED_DEV_USERS is set but ignored under NODE_ENV=production");
    return;
  }
  const upsert = db.prepare(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role`,
  );
  for (const user of DEV_USERS) {
    upsert.run(user.username, hashPassword(DEV_PASSWORD), user.role);
  }
}
