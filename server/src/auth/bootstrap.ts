import type Database from "better-sqlite3";
import type { AppConfig } from "../config";
import { hashPassword } from "./passwords";

export function ensureBootstrapUser(db: Database.Database, config: AppConfig): void {
  if (config.bootstrapUser === undefined || config.bootstrapPassword === undefined) {
    return;
  }
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count > 0) {
    return;
  }
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(
    config.bootstrapUser,
    hashPassword(config.bootstrapPassword),
  );
}
