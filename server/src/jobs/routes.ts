import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { requireSession } from "../auth/guard";

export function registerJobRoutes(app: FastifyInstance): void {
  app.get(
    "/api/jobs/:id",
    { preHandler: requireSession, schema: { params: Type.Object({ id: Type.String() }) } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = request.server.db
        .prepare(
          "SELECT id, kind, status, error, result_json AS resultJson FROM jobs WHERE id = ?",
        )
        .get(id) as
        | { id: string; kind: string; status: string; error: string | null; resultJson: string | null }
        | undefined;
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        error: row.error,
        result: row.resultJson ? (JSON.parse(row.resultJson) as unknown) : null,
      };
    },
  );
}
