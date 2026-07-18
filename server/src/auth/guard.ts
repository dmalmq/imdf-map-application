import type { FastifyReply, FastifyRequest } from "fastify";
import { sessionUser, type SessionUser } from "./sessions";

export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies["kiriko_session"];
  const user = token ? sessionUser(request.server.db, token) : null;
  if (user === null) {
    await reply.code(401).send({ error: "unauthorized" });
    return;
  }
  request.user = user;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser;
  }
}
