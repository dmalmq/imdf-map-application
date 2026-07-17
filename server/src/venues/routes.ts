import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { requireSession } from "../auth/guard";
import { createVenue, deleteVenue, listVenues } from "./service";

const TENANT_ID = 1; // single tenant in phase 1

export function registerVenueRoutes(app: FastifyInstance): void {
  app.get("/api/venues", { preHandler: requireSession }, async (request) => ({
    venues: listVenues(request.server.db, TENANT_ID),
  }));

  app.post(
    "/api/venues",
    {
      preHandler: requireSession,
      schema: { body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 200 }) }) },
    },
    async (request, reply) => {
      const { name } = request.body as { name: string };
      const venue = createVenue(request.server.db, TENANT_ID, name, request.user.id);
      return reply.code(201).send({ venue });
    },
  );

  app.delete(
    "/api/venues/:id",
    {
      preHandler: requireSession,
      schema: { params: Type.Object({ id: Type.Integer() }) },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const deleted = deleteVenue(request.server.db, TENANT_ID, id);
      return deleted ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
    },
  );
}
