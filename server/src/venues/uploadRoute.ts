import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { requireSession } from "../auth/guard";

const TENANT_ID = 1;

export function registerUploadRoute(app: FastifyInstance): void {
  app.post(
    "/api/venues/:id/versions",
    {
      preHandler: requireSession,
      schema: {
        params: Type.Object({ id: Type.Integer() }),
        response: {
          202: Type.Object({ jobId: Type.String(), versionId: Type.Number(), seq: Type.Number() }),
          400: Type.Object({ error: Type.String() }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const venue = request.server.db
        .prepare("SELECT id FROM venues WHERE id = ? AND tenant_id = ?")
        .get(id, TENANT_ID);
      if (!venue) {
        return reply.code(404).send({ error: "not_found" });
      }
      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ error: "file_required" });
      }
      const bytes = await file.toBuffer();
      const { hash, size } = request.server.blobs.put(bytes);
      request.server.db
        .prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)")
        .run(hash, size);

      const db = request.server.db;
      const nextSeq =
        ((db.prepare("SELECT MAX(seq) AS m FROM versions WHERE venue_id = ?").get(id) as {
          m: number | null;
        }).m ?? 0) + 1;
      const info = db
        .prepare(
          "INSERT INTO versions (venue_id, seq, source_blob_hash, source_kind) VALUES (?, ?, ?, 'imdf')",
        )
        .run(id, nextSeq, hash);
      const versionId = Number(info.lastInsertRowid);
      const jobId = request.server.queue.enqueue("publish_imdf", { versionId });
      return reply.code(202).send({ jobId, versionId, seq: nextSeq });
    },
  );
}
