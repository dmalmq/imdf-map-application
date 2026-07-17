import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function openDb(dataDir: string): Database.Database {
  mkdirSync(join(dataDir, "data"), { recursive: true });
  const db = new Database(join(dataDir, "data", "kiriko.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
