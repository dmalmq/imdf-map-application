import { Type } from "@sinclair/typebox";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

function findPublished(
  db: Database.Database,
  tenantSlug: string,
  venueSlug: string,
  seq: number | null,
): { hash: string } | null {
  const row = db
    .prepare(
      `SELECT vr.bundle_hash AS hash FROM versions vr
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

  app.get("/v/:tenant/:venue/archive", { schema: { params } }, async (request, reply) => {
    const { tenant, venue } = request.params as { tenant: string; venue: string };
    return send(reply, request, tenant, venue, null, "public, max-age=0, must-revalidate");
  });

  app.get(
    "/v/:tenant/:venue/archive@:seq",
    { schema: { params: Type.Object({ tenant: Type.String(), venue: Type.String(), seq: Type.Integer() }) } },
    async (request, reply) => {
      const { tenant, venue, seq } = request.params as { tenant: string; venue: string; seq: number };
      return send(reply, request, tenant, venue, seq, "public, max-age=31536000, immutable");
    },
  );

  function send(
    reply: import("fastify").FastifyReply,
    request: import("fastify").FastifyRequest,
    tenant: string,
    venue: string,
    seq: number | null,
    cacheControl: string,
  ) {
    const found = findPublished(app.db, tenant, venue, seq);
    if (!found) {
      return reply.code(404).send({ error: "not_found" });
    }
    const etag = `"${found.hash}"`;
    void reply.header("etag", etag).header("cache-control", cacheControl);
    if (request.headers["if-none-match"] === etag) {
      return reply.code(304).send();
    }
    return reply.type("application/zip").send(app.blobs.read(found.hash));
  }
}
