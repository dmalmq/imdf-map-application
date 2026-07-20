/**
 * `POST /api/gdb/inspect` and `POST /api/gdb/publish`.
 *
 * Inspect stages the uploaded `.gdb.zip` as a content-addressed blob and
 * returns the OGR layer summary plus the blob hash. Publish re-opens that blob
 * by hash, converts the reviewed layers to WGS84 GeoJSON via gdal3.js,
 * synthesizes an IMDF archive, stores it as a fresh blob, inserts a
 * `source_kind='gdb'` version row pointing at the synthesized IMDF, and
 * enqueues the existing `publish_imdf` job — which then compiles the IMDF
 * through the Rust core exactly like a direct IMDF upload.
 *
 * No per-session GDAL state crosses HTTP requests: both endpoints re-open the
 * blob via `/vsizip/<blob-path>`. The job queue serializes the heavy compile
 * regardless; the conversion in the publish handler is fast for typical
 * station-scale geodatabases.
 */
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { requireSession } from "../auth/guard";
import { inspectGdbArchive, convertGdbLayers } from "./convert";
import { GdbConversionError, resolveGdbImdfWithExclusions, suggestGdbMapping } from "./mapping";
import { writeImdfZip } from "./imdfZip";
import { GdbSourceError, validateGdbArchive } from "./sourceValidation";
import { removeStagedGdb, stageGdbBlobForGdal } from "./staging";
import type {
  GdbInspectResponse,
  GdbInspection,
  GdbPublishRequest,
} from "./types";
import { newPublicVersionId } from "../venues/uploadRoute";

const TENANT_ID = 1;

const GdbLayerKeySchema = Type.Object({
  databaseId: Type.String(),
  layerName: Type.String(),
});

const GdbLevelRuleSchema = Type.Union([
  Type.Object({ kind: Type.Literal("source-reference"), field: Type.String() }),
  Type.Object({ kind: Type.Literal("property"), field: Type.String() }),
  Type.Object({ kind: Type.Literal("layer-name") }),
  Type.Object({ kind: Type.Literal("fixed"), label: Type.String(), ordinal: Type.Number() }),
]);

const GdbLayerPlanSchema = Type.Object({
  key: GdbLayerKeySchema,
  included: Type.Boolean(),
  targetType: Type.Union([
    Type.Literal("level"),
    Type.Literal("unit"),
    Type.Literal("opening"),
    Type.Literal("detail"),
    Type.Literal("fixture"),
    Type.Literal("kiosk"),
    Type.Literal("amenity"),
    Type.Literal("occupant"),
    Type.Null(),
  ]),
  buildingId: Type.Union([Type.String(), Type.Null()]),
  levelRule: Type.Union([GdbLevelRuleSchema, Type.Null()]),
  idField: Type.Union([Type.String(), Type.Null()]),
  ordinalField: Type.Union([Type.String(), Type.Null()]),
  shortNameField: Type.Union([Type.String(), Type.Null()]),
  nameField: Type.Union([Type.String(), Type.Null()]),
  categoryField: Type.Union([Type.String(), Type.Null()]),
});

const GdbMappingPlanSchema = Type.Object({
  venueName: Type.String({ minLength: 1, maxLength: 200 }),
  buildings: Type.Array(
    Type.Object({ id: Type.String(), name: Type.String({ minLength: 1, maxLength: 200 }) }),
  ),
  layers: Type.Array(GdbLayerPlanSchema),
});

const GdbPublishSchema = Type.Object({
  venueId: Type.Integer({ minimum: 1 }),
  blobHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  plan: GdbMappingPlanSchema,
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  code: Type.String(),
  details: Type.Optional(Type.Unknown()),
});

interface ErrorBody {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

function errorBody(code: string, message: string, details?: Record<string, unknown>): ErrorBody {
  return details === undefined ? { error: message, code } : { error: message, code, details };
}

function isGdbSourceError(error: unknown): error is GdbSourceError {
  return error instanceof GdbSourceError;
}
function isGdbConversionError(error: unknown): error is GdbConversionError {
  return error instanceof GdbConversionError;
}

/**
 * Register the inspect + publish endpoints. The shared blob store and job
 * queue are reached through the Fastify server decorations installed in
 * `buildApp`.
 */
export function registerGdbRoutes(app: FastifyInstance): void {
  app.post(
    "/api/gdb/inspect",
    {
      preHandler: requireSession,
      schema: {
        response: {
          200: Type.Object({
            blobHash: Type.String(),
            inspection: Type.Unknown(),
            suggestedPlan: Type.Unknown(),
          }),
          400: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.code(400).send(errorBody("file_required", "file_required"));
      }
      const bytes = await file.toBuffer();
      let rootName: string;
      try {
        const validated = await validateGdbArchive(bytes);
        rootName = validated.rootName;
      } catch (error) {
        if (isGdbSourceError(error)) {
          return reply
            .code(400)
            .send(errorBody(error.code, error.message, error.details));
        }
        request.log.error({ err: error }, "gdb inspect validation failed");
        return reply.code(500).send(errorBody("internal_error", "internal_error"));
      }

      const { hash, size } = request.server.blobs.put(bytes);
      request.server.db
        .prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)")
        .run(hash, size);
      const stagedPath = stageGdbBlobForGdal(request.server.blobs.path(hash), hash);
      let inspection: GdbInspection;
      try {
        inspection = await inspectGdbArchive(stagedPath, rootName);
      } catch (error) {
        request.log.warn({ err: error }, "gdb inspect failed");
        return reply.code(400).send(
          errorBody("gdb_inspection_failed", "gdb_inspection_failed", {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        removeStagedGdb(stagedPath);
      }
      const body: GdbInspectResponse = {
        blobHash: hash,
        inspection,
        suggestedPlan: suggestGdbMapping(inspection),
      };
      return reply.send(body);
    },
  );

  app.post(
    "/api/gdb/publish",
    {
      preHandler: requireSession,
      schema: {
        body: GdbPublishSchema,
        response: {
          202: Type.Object({
            jobId: Type.String(),
            versionId: Type.Number(),
            seq: Type.Number(),
            excludedLayers: Type.Array(
              Type.Object({ layer: Type.String(), reason: Type.String() }),
            ),
          }),
          400: ErrorSchema,
          404: Type.Object({ error: Type.String() }),
          500: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as GdbPublishRequest;
      const { venueId, blobHash, plan } = body;

      const venue = request.server.db
        .prepare("SELECT id FROM venues WHERE id = ? AND tenant_id = ?")
        .get(venueId, TENANT_ID);
      if (!venue) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (!request.server.blobs.has(blobHash)) {
        return reply.code(404).send({ error: "blob_not_found" });
      }

      const includedLayerNames = plan.layers
        .filter((layer) => layer.included && layer.targetType !== null)
        .map((layer) => layer.key.layerName);
      if (includedLayerNames.length === 0) {
        return reply.code(400).send(errorBody("no_included_layers", "no_included_layers"));
      }

      let conversion;
      const stagedPath = stageGdbBlobForGdal(
        request.server.blobs.path(blobHash),
        blobHash,
      );
      try {
        conversion = await convertGdbLayers(stagedPath, includedLayerNames);
      } catch (error) {
        request.log.error({ err: error }, "gdb convert failed");
        return reply.code(400).send(
          errorBody("gdb_conversion_failed", "gdb_conversion_failed", {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        removeStagedGdb(stagedPath);
      }

      let archive;
      let excludedLayers: Array<{ layer: string; reason: string }> = [];
      try {
        const resolved = resolveGdbImdfWithExclusions(conversion, plan);
        archive = resolved.archive;
        excludedLayers = resolved.excludedLayers;
      } catch (error) {
        if (isGdbConversionError(error)) {
          return reply.code(400).send(
            errorBody("gdb_conversion_failed", "gdb_conversion_failed", {
              reason: error.reason,
              ...error.details,
            }),
          );
        }
        request.log.error({ err: error }, "gdb imdf build failed");
        return reply.code(500).send(errorBody("internal_error", "internal_error"));
      }

      const imdfBytes = await writeImdfZip(archive);
      const { hash: imdfHash, size: imdfSize } = request.server.blobs.put(imdfBytes);

      const db = request.server.db;
      db.prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)").run(
        imdfHash,
        imdfSize,
      );
      const nextSeq =
        ((db.prepare("SELECT MAX(seq) AS m FROM versions WHERE venue_id = ?").get(venueId) as {
          m: number | null;
        }).m ?? 0) + 1;
      const info = db
        .prepare(
          "INSERT INTO versions (venue_id, seq, public_id, source_blob_hash, source_kind) VALUES (?, ?, ?, ?, 'gdb')",
        )
        .run(venueId, nextSeq, newPublicVersionId(), imdfHash);
      const versionId = Number(info.lastInsertRowid);
      const jobId = request.server.queue.enqueue("publish_imdf", { versionId });
      return reply.code(202).send({ jobId, versionId, seq: nextSeq, excludedLayers });
    },
  );
}
