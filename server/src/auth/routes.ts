import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { createSession, destroySession } from "./sessions";
import { requireSession } from "./guard";
import { verifyPassword } from "./passwords";

const UserSchema = Type.Object({
  id: Type.Number(),
  username: Type.String(),
  role: Type.String(),
});

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post(
    "/api/auth/login",
    {
      schema: {
        body: Type.Object({ username: Type.String(), password: Type.String() }),
        response: { 200: Type.Object({ user: UserSchema }), 401: Type.Object({ error: Type.String() }) },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };
      const row = request.server.db
        .prepare("SELECT id, username, role, password_hash FROM users WHERE username = ?")
        .get(username) as
        | { id: number; username: string; role: string; password_hash: string }
        | undefined;
      if (!row || !verifyPassword(password, row.password_hash)) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      const token = createSession(request.server.db, row.id, request.server.config.sessionTtlDays);
      void reply.setCookie("kiriko_session", token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: request.server.config.sessionTtlDays * 24 * 60 * 60,
      });
      return { user: { id: row.id, username: row.username, role: row.role } };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies["kiriko_session"];
    if (token) {
      destroySession(request.server.db, token);
    }
    void reply.clearCookie("kiriko_session", { path: "/" });
    return reply.code(204).send();
  });

  app.get(
    "/api/auth/me",
    { preHandler: requireSession, schema: { response: { 200: Type.Object({ user: UserSchema }) } } },
    async (request) => ({ user: request.user }),
  );
}
