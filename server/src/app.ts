import fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { AppConfig } from "./config";
import { openDb } from "./db/db";
import { migrate } from "./db/migrate";
import { ensureBootstrapUser } from "./auth/bootstrap";
import { registerAuthRoutes } from "./auth/routes";
import { BlobStore } from "./blobs/store";

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const db = openDb(config.dataDir);
  migrate(db);

  const app = fastify({ logger: { level: process.env["NODE_ENV"] === "test" ? "warn" : "info" } })
    .withTypeProvider<TypeBoxTypeProvider>();

  app.decorate("db", db);
  app.decorate("config", config);
  app.decorate("blobs", new BlobStore(config.dataDir));

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
  await app.register(swagger, {
    openapi: { info: { title: "Kiriko API", version: "0.1.0" } },
  });

  ensureBootstrapUser(db, config);
  registerAuthRoutes(app);

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/api/openapi.json", async () => app.swagger());

  app.addHook("onClose", async () => {
    db.close();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: import("better-sqlite3").Database;
    config: AppConfig;
    blobs: BlobStore;
  }
}
