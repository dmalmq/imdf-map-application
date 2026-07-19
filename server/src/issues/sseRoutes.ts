import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { IssueEventHub, IssueSseCapacityError } from "./events";
import type { IssueRepository } from "./repository";
import { IssueApiErrorSchema, PublicVersionIdSchema } from "./schemas";

export type IssueSseRepository = Pick<IssueRepository, "resolvePublishedVersion" | "getCurrentRevision">;

export interface IssueSseRoutesOptions {
  repository: IssueSseRepository;
  hub: IssueEventHub;
}

const PUBLIC_NOT_FOUND_MESSAGE = "The review issue was not found.";
const HEARTBEAT_INTERVAL_MS = 15_000;

function revisionEvent(revision: number): string {
  return `event: revision\ndata: ${JSON.stringify({ revision })}\n\n`;
}

export const issueSseRoutes: FastifyPluginAsync<IssueSseRoutesOptions> = async (app, options) => {
  app.get<{ Params: { publicVersionId: string } }>(
    "/api/review/versions/:publicVersionId/issues/events",
    {
      schema: {
        params: Type.Object(
          { publicVersionId: PublicVersionIdSchema },
          { additionalProperties: false },
        ),
        response: {
          400: IssueApiErrorSchema,
          404: IssueApiErrorSchema,
          503: IssueApiErrorSchema,
          500: IssueApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { publicVersionId } = request.params;
      const version = options.repository.resolvePublishedVersion(publicVersionId);
      if (version === null) {
        return reply
          .code(404)
          .header("Cache-Control", "no-store")
          .send({ error: "not_found", message: PUBLIC_NOT_FOUND_MESSAGE });
      }

      let initializing = true;
      let bufferedRevision = -1;
      let heartbeat: NodeJS.Timeout | undefined;
      let unsubscribe = () => {};
      let cleaned = false;

      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        request.raw.off("aborted", cleanup);
        reply.raw.off("close", cleanup);
        reply.raw.off("error", cleanup);
        unsubscribe();
      };

      const closeStream = () => {
        cleanup();
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      };

      try {
        unsubscribe = options.hub.subscribe(
          publicVersionId,
          (revision) => {
            if (initializing) {
              bufferedRevision = Math.max(bufferedRevision, revision);
              return;
            }
            if (cleaned || reply.raw.writableEnded) return;
            try {
              reply.raw.write(revisionEvent(revision));
            } catch {
              cleanup();
              reply.raw.destroy();
            }
          },
          closeStream,
        );
      } catch (error) {
        if (!(error instanceof IssueSseCapacityError)) throw error;
        return reply
          .code(503)
          .headers({
            "Cache-Control": "no-store",
            "Retry-After": "15",
          })
          .send({ error: error.code, message: error.message });
      }

      let currentRevision: number;
      try {
        currentRevision = options.repository.getCurrentRevision(version.versionId);
      } catch (error) {
        cleanup();
        throw error;
      }

      request.raw.once("aborted", cleanup);
      reply.raw.once("close", cleanup);
      reply.raw.once("error", cleanup);
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.write(revisionEvent(Math.max(currentRevision, bufferedRevision)));
      initializing = false;

      heartbeat = setInterval(() => {
        if (!cleaned && !reply.raw.writableEnded) {
          reply.raw.write(": heartbeat\n\n");
        }
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();
      return reply;
    },
  );
};
