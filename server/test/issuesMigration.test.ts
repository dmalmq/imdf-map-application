import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/db";
import { migrate } from "../src/db/migrate";

const INITIAL_MIGRATION = readFileSync(new URL("../src/db/migrations/001_init.sql", import.meta.url), "utf8");
const PUBLIC_ID_PATTERN = /^[0-9a-f]{64}$/;

function open001Database() {
  const dataDir = mkdtempSync(join(tmpdir(), "kiriko-issues-migration-"));
  const db = openDb(dataDir);
  db.exec(INITIAL_MIGRATION);
  db.exec(
    "CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  db.prepare("INSERT INTO schema_migrations (name) VALUES ('001_init.sql')").run();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (7, 'reviewer', 'hash', 'member', '2026-01-01 00:00:00')",
  ).run();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (8, 'author', 'hash', 'admin', '2026-01-02 00:00:00')",
  ).run();
  db.prepare(
    "INSERT INTO venues (id, tenant_id, slug, name, created_by, created_at) VALUES (11, 1, 'station', 'Station', 7, '2026-02-01 00:00:00')",
  ).run();
  db.prepare(
    `INSERT INTO versions (
       id, venue_id, seq, source_blob_hash, bundle_hash, status, source_kind, stats_json, error, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(41, 11, 3, "source-a", "bundle-a", "published", "imdf", '{"levels":1}', null, "2026-03-01 00:00:00");
  db.prepare(
    `INSERT INTO versions (
       id, venue_id, seq, source_blob_hash, bundle_hash, status, source_kind, stats_json, error, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(77, 11, 4, "source-b", null, "failed", "gdb", null, "failure", "2026-03-02 00:00:00");
  return { dataDir, db };
}

describe("002 review issues migration", () => {
  it("preserves every version value and numeric id while assigning stable permanent public ids", () => {
    const { dataDir, db } = open001Database();
    try {
      migrate(db);

      const rows = db
        .prepare(
          `SELECT id, venue_id AS venueId, seq, public_id AS publicId,
                  source_blob_hash AS sourceHash, bundle_hash AS bundleHash,
                  status, source_kind AS sourceKind, stats_json AS statsJson,
                  error, created_at AS createdAt
           FROM versions ORDER BY id`,
        )
        .all() as Array<{
        id: number;
        venueId: number;
        seq: number;
        publicId: string;
        sourceHash: string;
        bundleHash: string | null;
        status: string;
        sourceKind: string;
        statsJson: string | null;
        error: string | null;
        createdAt: string;
      }>;

      expect(rows.map(({ publicId: _publicId, ...row }) => row)).toEqual([
        {
          id: 41,
          venueId: 11,
          seq: 3,
          sourceHash: "source-a",
          bundleHash: "bundle-a",
          status: "published",
          sourceKind: "imdf",
          statsJson: '{"levels":1}',
          error: null,
          createdAt: "2026-03-01 00:00:00",
        },
        {
          id: 77,
          venueId: 11,
          seq: 4,
          sourceHash: "source-b",
          bundleHash: null,
          status: "failed",
          sourceKind: "gdb",
          statsJson: null,
          error: "failure",
          createdAt: "2026-03-02 00:00:00",
        },
      ]);
      expect(rows[0]!.publicId).toMatch(PUBLIC_ID_PATTERN);
      expect(rows[1]!.publicId).toMatch(PUBLIC_ID_PATTERN);
      expect(rows[1]!.publicId).not.toBe(rows[0]!.publicId);

      const assignedPublicIds = rows.map((row) => row.publicId);
      migrate(db);
      const rerunPublicIds = db
        .prepare("SELECT public_id AS publicId FROM versions ORDER BY id")
        .all()
        .map((row) => (row as { publicId: string }).publicId);
      expect(rerunPublicIds).toEqual(assignedPublicIds);

      const publicIdColumn = (
        db.prepare("PRAGMA table_info(versions)").all() as Array<{ name: string; notnull: number }>
      ).find((column) => column.name === "public_id");
      expect(publicIdColumn?.notnull).toBe(1);
      expect(() =>
        db
          .prepare("INSERT INTO versions (venue_id, seq, public_id, source_blob_hash) VALUES (11, 5, ?, 'source-c')")
          .run(rows[0]!.publicId),
      ).toThrow();
      for (const invalid of ["A".repeat(64), "g".repeat(64), "a".repeat(63)]) {
        expect(() =>
          db
            .prepare("INSERT INTO versions (venue_id, seq, public_id, source_blob_hash) VALUES (11, 5, ?, 'source-c')")
            .run(invalid),
        ).toThrow();
      }
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("creates constrained comment state, root comments, and version-scoped replies", () => {
    const { dataDir, db } = open001Database();
    try {
      migrate(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tables).toEqual(expect.arrayContaining(["comment_state", "comments"]));

      db.prepare("INSERT INTO comment_state (version_id) VALUES (41)").run();
      expect(db.prepare("SELECT revision, next_pin_number AS nextPinNumber FROM comment_state WHERE version_id = 41").get()).toEqual({
        revision: 0,
        nextPinNumber: 1,
      });
      expect(() => db.prepare("INSERT INTO comment_state (version_id, revision) VALUES (77, -1)").run()).toThrow();

      db.prepare(
        `INSERT INTO comments (
           id, version_id, author_id, create_request_id, create_request_hash,
           pin_number, level_id, longitude, latitude, feature_id, body_markdown,
           status, assignee_id, due_date, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "root-1",
        41,
        7,
        "create-root-1",
        "a".repeat(64),
        1,
        "level-1",
        139.7,
        35.6,
        "feature-1",
        "Review this",
        "open",
        8,
        "2026-08-01",
        "2026-07-18 00:00:00",
        "2026-07-18 00:00:00",
      );
      db.prepare(
        `INSERT INTO comments (
           id, version_id, parent_id, author_id, create_request_id, create_request_hash,
           body_markdown, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "reply-1",
        41,
        "root-1",
        8,
        "create-reply-1",
        "b".repeat(64),
        "Acknowledged",
        "2026-07-18 00:01:00",
        "2026-07-18 00:01:00",
      );

      expect(() =>
        db
          .prepare(
            `INSERT INTO comments (
               id, version_id, author_id, create_request_id, create_request_hash,
               pin_number, level_id, longitude, latitude, body_markdown, status, created_at, updated_at
             ) VALUES ('duplicate-pin', 41, 8, 'duplicate-pin', ?, 1, 'level-1', 0, 0, 'body', 'open', 'now', 'now')`,
          )
          .run("c".repeat(64)),
      ).toThrow();
      expect(() =>
        db
          .prepare(
            `INSERT INTO comments (
               id, version_id, author_id, create_request_id, create_request_hash,
               pin_number, level_id, longitude, latitude, body_markdown, status, created_at, updated_at
             ) VALUES ('invalid-hash', 41, 8, 'invalid-hash', ?, 2, 'level-1', 0, 0, 'body', 'open', 'now', 'now')`,
          )
          .run("G".repeat(64)),
      ).toThrow();
      expect(() =>
        db
          .prepare(
            `INSERT INTO comments (
               id, version_id, parent_id, author_id, create_request_id, create_request_hash,
               feature_id, body_markdown, created_at, updated_at
             ) VALUES ('invalid-reply', 41, 'root-1', 7, 'invalid-reply', ?, 'feature', 'body', 'now', 'now')`,
          )
          .run("d".repeat(64)),
      ).toThrow();
      expect(() =>
        db
          .prepare(
            `INSERT INTO comments (
               id, version_id, parent_id, author_id, create_request_id, create_request_hash,
               body_markdown, created_at, updated_at
             ) VALUES ('cross-version', 77, 'root-1', 7, 'cross-version', ?, 'body', 'now', 'now')`,
          )
          .run("e".repeat(64)),
      ).toThrow();
      expect(() =>
        db
          .prepare(
            `INSERT INTO comments (
               id, version_id, author_id, create_request_id, create_request_hash,
               pin_number, level_id, longitude, latitude, body_markdown, status, created_at, updated_at
             ) VALUES ('bad-longitude', 41, 8, 'bad-longitude', ?, 2, 'level-1', 181, 0, 'body', 'open', 'now', 'now')`,
          )
          .run("f".repeat(64)),
      ).toThrow();
      expect(() =>
        db
          .prepare(
            `INSERT INTO comments (
               id, version_id, author_id, create_request_id, create_request_hash,
               pin_number, level_id, longitude, latitude, body_markdown, status, deleted_at, created_at, updated_at
             ) VALUES ('bad-tombstone', 41, 8, 'bad-tombstone', ?, 2, 'level-1', 0, 0, 'body', 'open', 'now', 'now', 'now')`,
          )
          .run("0".repeat(64)),
      ).toThrow();
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
