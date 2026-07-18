import { Type } from "@sinclair/typebox";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const LATEST_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const PINNED_CACHE_CONTROL = "public, max-age=31536000, immutable";

function findPublished(
  db: Database.Database,
  tenantSlug: string,
  venueSlug: string,
  seq: number | null,
): { hash: string; publicId: string } | null {
  const row = db
    .prepare(
      `SELECT vr.bundle_hash AS hash, vr.public_id AS publicId FROM versions vr
       JOIN venues v ON v.id = vr.venue_id
       JOIN tenants t ON t.id = v.tenant_id
       WHERE t.slug = ? AND v.slug = ? AND vr.status = 'published'
         AND (? IS NULL OR vr.seq = ?)
       ORDER BY vr.seq DESC LIMIT 1`,
    )
    .get(tenantSlug, venueSlug, seq, seq) as { hash: string | null; publicId: string } | undefined;
  return row?.hash ? { hash: row.hash, publicId: row.publicId } : null;
}

export function registerServeRoutes(app: FastifyInstance): void {
  const params = Type.Object({ tenant: Type.String(), venue: Type.String() });
  const pinnedParams = Type.Object({ tenant: Type.String(), venue: Type.String(), seq: Type.Integer() });

  function send(
    reply: FastifyReply,
    request: FastifyRequest,
    tenant: string,
    venue: string,
    seq: number | null,
    cacheControl: string,
  ) {
    const found = findPublished(app.db, tenant, venue, seq);
    if (!found) {
      return reply.code(404).send({ error: "not_found" });
    }
    reply.header("Kiriko-Version-Id", found.publicId);
    reply.header("ETag", `"${found.hash}"`);
    reply.header("cache-control", cacheControl);
    if (request.headers["if-none-match"] === `"${found.hash}"`) {
      return reply.code(304).send();
    }
    return reply.type("application/vnd.kiriko.bundle").send(app.blobs.read(found.hash));
  }

  app.get("/v/:tenant/:venue/bundle", { schema: { params } }, async (request, reply) => {
    const { tenant, venue } = request.params as { tenant: string; venue: string };
    return send(reply, request, tenant, venue, null, LATEST_CACHE_CONTROL);
  });

  app.get(
    "/v/:tenant/:venue/bundle@:seq",
    { schema: { params: pinnedParams } },
    async (request, reply) => {
      const { tenant, venue, seq } = request.params as { tenant: string; venue: string; seq: number };
      return send(reply, request, tenant, venue, seq, PINNED_CACHE_CONTROL);
    },
  );
}
