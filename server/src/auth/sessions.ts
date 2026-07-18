import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export const SESSION_ROLES = ["viewer", "member", "admin"] as const;

export type SessionRole = (typeof SESSION_ROLES)[number];

export interface SessionUser {
  id: number;
  username: string;
  role: SessionRole;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(db: Database.Database, userId: number, ttlDays: number): string {
  const token = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))",
  ).run(tokenHash(token), userId, `+${ttlDays} days`);
  return token;
}

export function sessionUser(db: Database.Database, token: string): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    )
    .get(tokenHash(token));
  return (row as SessionUser | undefined) ?? null;
}

export function destroySession(db: Database.Database, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}
