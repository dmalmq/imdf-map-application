import type Database from "better-sqlite3";

export interface VersionStats {
  levels: number;
  features: number;
}

export interface VenueRow {
  id: number;
  slug: string;
  name: string;
  createdAt: string;
}

export interface VenueSummary extends VenueRow {
  latest: { seq: number; status: string; stats: VersionStats | null; createdAt: string } | null;
}

/** ASCII-only slug; non-latin names fall back to "venue". */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base !== "" ? base : "venue";
}

export function createVenue(
  db: Database.Database,
  tenantId: number,
  name: string,
  userId: number,
): VenueRow {
  const base = slugify(name);
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    try {
      const info = db
        .prepare("INSERT INTO venues (tenant_id, slug, name, created_by) VALUES (?, ?, ?, ?)")
        .run(tenantId, slug, name, userId);
      const row = db
        .prepare("SELECT id, slug, name, created_at AS createdAt FROM venues WHERE id = ?")
        .get(info.lastInsertRowid) as VenueRow;
      return row;
    } catch (error) {
      if ((error as { code?: string }).code !== "SQLITE_CONSTRAINT_UNIQUE") {
        throw error;
      }
    }
  }
}

export function listVenues(db: Database.Database, tenantId: number): VenueSummary[] {
  const venues = db
    .prepare(
      "SELECT id, slug, name, created_at AS createdAt FROM venues WHERE tenant_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(tenantId) as VenueRow[];
  const latestStmt = db.prepare(
    `SELECT seq, status, stats_json AS statsJson, created_at AS createdAt
     FROM versions WHERE venue_id = ? AND status = 'published'
     ORDER BY seq DESC LIMIT 1`,
  );
  return venues.map((venue) => {
    const latest = latestStmt.get(venue.id) as
      | { seq: number; status: string; statsJson: string | null; createdAt: string }
      | undefined;
    return {
      ...venue,
      latest: latest
        ? {
            seq: latest.seq,
            status: latest.status,
            stats: latest.statsJson ? (JSON.parse(latest.statsJson) as VersionStats) : null,
            createdAt: latest.createdAt,
          }
        : null,
    };
  });
}

export function deleteVenue(db: Database.Database, tenantId: number, venueId: number): boolean {
  const info = db
    .prepare("DELETE FROM venues WHERE id = ? AND tenant_id = ?")
    .run(venueId, tenantId);
  return info.changes > 0;
}
