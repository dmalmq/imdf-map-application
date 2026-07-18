ALTER TABLE versions RENAME TO versions_before_review_issues;

CREATE TABLE versions (
  id INTEGER PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  public_id TEXT NOT NULL UNIQUE
    CHECK (length(public_id) = 64 AND public_id = lower(public_id) AND public_id NOT GLOB '*[^0-9a-f]*'),
  source_blob_hash TEXT NOT NULL,
  bundle_hash TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','failed','archived')),
  source_kind TEXT NOT NULL DEFAULT 'imdf' CHECK (source_kind IN ('imdf','gdb')),
  stats_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (venue_id, seq)
);

INSERT INTO versions (
  id, venue_id, seq, public_id, source_blob_hash, bundle_hash,
  status, source_kind, stats_json, error, created_at
)
SELECT
  id, venue_id, seq, lower(hex(randomblob(32))), source_blob_hash, bundle_hash,
  status, source_kind, stats_json, error, created_at
FROM versions_before_review_issues;

DROP TABLE versions_before_review_issues;

CREATE TABLE comment_state (
  version_id INTEGER PRIMARY KEY REFERENCES versions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  next_pin_number INTEGER NOT NULL DEFAULT 1 CHECK (next_pin_number >= 1)
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  parent_id TEXT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  create_request_id TEXT NOT NULL,
  create_request_hash TEXT NOT NULL
    CHECK (length(create_request_hash) = 64 AND create_request_hash = lower(create_request_hash)
      AND create_request_hash NOT GLOB '*[^0-9a-f]*'),
  pin_number INTEGER,
  level_id TEXT,
  longitude REAL,
  latitude REAL,
  feature_id TEXT,
  body_markdown TEXT,
  status TEXT CHECK (status IN ('open','in_review','closed')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (id, version_id),
  UNIQUE (version_id, pin_number),
  UNIQUE (author_id, create_request_id),
  FOREIGN KEY (parent_id, version_id) REFERENCES comments(id, version_id),
  CHECK (
    (parent_id IS NULL AND pin_number IS NOT NULL AND level_id IS NOT NULL
      AND longitude IS NOT NULL AND latitude IS NOT NULL AND status IS NOT NULL)
    OR
    (parent_id IS NOT NULL AND pin_number IS NULL AND level_id IS NULL
      AND longitude IS NULL AND latitude IS NULL AND feature_id IS NULL
      AND status IS NULL AND assignee_id IS NULL AND due_date IS NULL)
  ),
  CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CHECK ((deleted_at IS NULL AND body_markdown IS NOT NULL AND length(body_markdown) > 0)
    OR (deleted_at IS NOT NULL AND body_markdown IS NULL))
);
