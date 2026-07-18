import { Type } from "@sinclair/typebox";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** Which hash column identifies the immutable content to serve. */
type HashColumn = "bundle_hash" | "source_blob_hash";

const LATEST_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const PINNED_CACHE_CONTROL = "public, max-age=31536000, immutable";

function findPublished(
  db: Database.Database,
  column: HashColumn,
  tenantSlug: string,
  venueSlug: string,
  seq: number | null,
): { hash: string } | null {
  const row = db
    .prepare(
      `SELECT vr.${column} AS hash FROM versions vr
       JOIN venues v ON v.id = vr.venue_id
       JOIN tenants t ON t.id = v.tenant_id
       WHERE t.slug = ? AND v.slug = ? AND vr.status = 'published'
         AND (? IS NULL OR vr.seq = ?)
       ORDER BY vr.seq DESC LIMIT 1`,
    )
    .get(tenantSlug, venueSlug, seq, seq) as { hash: string | null } | undefined;
  return row?.hash ? { hash: row.hash } : null;
}

export function registerServeRoutes(app: FastifyInstance): void {
  const params = Type.Object({ tenant: Type.String(), venue: Type.String() });
  const pinnedParams = Type.Object({ tenant: Type.String(), venue: Type.String(), seq: Type.Integer() });

  function send(
    reply: FastifyReply,
    request: FastifyRequest,
    column: HashColumn,
    contentType: string,
    tenant: string,
    venue: string,
    seq: number | null,
    cacheControl: string,
  ) {
    const found = findPublished(app.db, column, tenant, venue, seq);
    if (!found) {
      return reply.code(404).send({ error: "not_found" });
    }
    const etag = `"${found.hash}"`;
    void reply.header("etag", etag).header("cache-control", cacheControl);
    if (request.headers["if-none-match"] === etag) {
      return reply.code(304).send();
    }
    return reply.type(contentType).send(app.blobs.read(found.hash));
  }

  // Transitional source-archive routes: retained only until Task 8 so the
  // existing web viewer keeps working between Tasks 5 and 7. Always reads
  // `source_blob_hash` — never the compiled bundle.
  app.get("/v/:tenant/:venue/archive", { schema: { params } }, async (request, reply) => {
    const { tenant, venue } = request.params as { tenant: string; venue: string };
    return send(reply, request, "source_blob_hash", "application/zip", tenant, venue, null, LATEST_CACHE_CONTROL);
  });

  app.get(
    "/v/:tenant/:venue/archive@:seq",
    { schema: { params: pinnedParams } },
    async (request, reply) => {
      const { tenant, venue, seq } = request.params as { tenant: string; venue: string; seq: number };
      return send(reply, request, "source_blob_hash", "application/zip", tenant, venue, seq, PINNED_CACHE_CONTROL);
    },
  );

  // Final public read API: compiled `.kvb` bundles only. Reads
  // `bundle_hash`, which is only ever set alongside `status = 'published'`
  // by a successful compile, so this can never emit ZIP-magic bytes.
  app.get("/v/:tenant/:venue/bundle", { schema: { params } }, async (request, reply) => {
    const { tenant, venue } = request.params as { tenant: string; venue: string };
    return send(
      reply,
      request,
      "bundle_hash",
      "application/vnd.kiriko.bundle",
      tenant,
      venue,
      null,
      LATEST_CACHE_CONTROL,
    );
  });

  app.get(
    "/v/:tenant/:venue/bundle@:seq",
    { schema: { params: pinnedParams } },
    async (request, reply) => {
      const { tenant, venue, seq } = request.params as { tenant: string; venue: string; seq: number };
      return send(
        reply,
        request,
        "bundle_hash",
        "application/vnd.kiriko.bundle",
        tenant,
        venue,
        seq,
        PINNED_CACHE_CONTROL,
      );
    },
  );
}
