import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifySchemaValidationError } from "fastify";
import { requireSession } from "../auth/guard";
import type { IssueEventHub } from "./events";
import { IssueServiceError, toIssueErrorResponse } from "./errors";
import {
  DeleteBodySchema,
  IssueApiErrorSchema,
  IssueCollectionSchema,
  IssuePatchSchema,
  MutationResponseSchema,
  PublicVersionIdSchema,
  ReplyCreateBodySchema,
  ReplyPatchSchema,
  ReviewersResponseSchema,
  RootCreateBodySchema,
} from "./schemas";
import type { IssueSseRepository } from "./sseRoutes";
import { issueSseRoutes } from "./sseRoutes";
import type { IssueService } from "./service";
import type {
  DeleteBody,
  IssuePatch,
  ReplyCreateBody,
  ReplyPatch,
  RootCreateBody,
} from "./types";

export interface IssueRoutesOptions {
  service: IssueService;
  repository: IssueSseRepository;
  hub: IssueEventHub;
}

const strict = { additionalProperties: false } as const;
const PublicVersionParamsSchema = Type.Object({ publicVersionId: PublicVersionIdSchema }, strict);
const IssueParamsSchema = Type.Object({ issueId: Type.String({ minLength: 1 }) }, strict);
const ReplyParamsSchema = Type.Object({ replyId: Type.String({ minLength: 1 }) }, strict);
const errorResponses = {
  400: IssueApiErrorSchema,
  401: IssueApiErrorSchema,
  403: IssueApiErrorSchema,
  404: IssueApiErrorSchema,
  409: IssueApiErrorSchema,
  500: IssueApiErrorSchema,
} as const;

interface FastifyValidationFailure {
  validation: FastifySchemaValidationError[];
}

function isFastifyValidationError(error: unknown): error is FastifyValidationFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    "validation" in error &&
    Array.isArray(error.validation)
  );
}

function validationField(error: FastifySchemaValidationError): string {
  const additionalProperty = error.params?.additionalProperty;
  if (typeof additionalProperty === "string") {
    return additionalProperty;
  }
  const missingProperty = error.params?.missingProperty;
  if (typeof missingProperty === "string") {
    return missingProperty;
  }
  const path = error.instancePath?.replace(/^\//, "").replaceAll("/", ".");
  return path && path.length > 0 ? path : "request";
}

type IssueContentParserFailure = "invalid_json" | "sanitized";

function issueContentParserFailure(error: unknown): IssueContentParserFailure | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  switch (error.code) {
    case "FST_ERR_CTP_INVALID_JSON_BODY":
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
      return "invalid_json";
    case "FST_ERR_CTP_BODY_TOO_LARGE":
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
    case "FST_ERR_CTP_INVALID_CONTENT_LENGTH":
      return "sanitized";
    default:
      return null;
  }
}

function mutationProjection(result: { revision: number; resourceId: string }) {
  return { revision: result.revision, resourceId: result.resourceId };
}

export const issueRoutes: FastifyPluginAsync<IssueRoutesOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.setErrorHandler((error, request, reply) => {
    const parserFailure = issueContentParserFailure(error);
    if (parserFailure !== null) {
      const extras =
        parserFailure === "invalid_json"
          ? { details: [{ field: "body", reason: "must be valid JSON" }] }
          : undefined;
      const invalidRequest = new IssueServiceError(
        "invalid_request",
        "The request is invalid.",
        extras,
      );
      const mapped = toIssueErrorResponse(invalidRequest, (cause) => request.log.error(cause));
      return reply.code(mapped.status).send(mapped.body);
    }

    if (isFastifyValidationError(error)) {
      const validationError = new IssueServiceError("invalid_request", "The request is invalid.", {
        details: error.validation.map((entry) => ({
          field: validationField(entry),
          reason: entry.message ?? "is invalid",
        })),
      });
      const mapped = toIssueErrorResponse(validationError, (cause) => request.log.error(cause));
      return reply.code(mapped.status).send(mapped.body);
    }

    const mapped = toIssueErrorResponse(error, (cause) => request.log.error(cause));
    return reply.code(mapped.status).send(mapped.body);
  });

  await app.register(issueSseRoutes, { repository: options.repository, hub: options.hub });

  app.get(
    "/api/review/versions/:publicVersionId/issues",
    {
      schema: {
        params: PublicVersionParamsSchema,
        response: { 200: IssueCollectionSchema, 400: IssueApiErrorSchema, 404: IssueApiErrorSchema, 500: IssueApiErrorSchema },
      },
    },
    async (request) => {
      const { publicVersionId } = request.params as { publicVersionId: string };
      return options.service.getCollection(publicVersionId);
    },
  );

  app.post(
    "/api/review/versions/:publicVersionId/issues",
    {
      preHandler: requireSession,
      schema: {
        params: PublicVersionParamsSchema,
        body: RootCreateBodySchema,
        response: { 200: MutationResponseSchema, ...errorResponses },
      },
    },
    async (request) => {
      const { publicVersionId } = request.params as { publicVersionId: string };
      const result = await options.service.createIssue(
        request.user,
        publicVersionId,
        request.body as RootCreateBody,
      );
      return mutationProjection(result);
    },
  );

  app.get(
    "/api/reviewers",
    {
      preHandler: requireSession,
      schema: {
        response: { 200: ReviewersResponseSchema, 401: IssueApiErrorSchema, 500: IssueApiErrorSchema },
      },
    },
    async (request) => ({ reviewers: options.service.listReviewers(request.user) }),
  );

  app.post(
    "/api/issues/:issueId/replies",
    {
      preHandler: requireSession,
      schema: {
        params: IssueParamsSchema,
        body: ReplyCreateBodySchema,
        response: { 200: MutationResponseSchema, ...errorResponses },
      },
    },
    async (request) => {
      const { issueId } = request.params as { issueId: string };
      const result = await options.service.createReply(
        request.user,
        issueId,
        request.body as ReplyCreateBody,
      );
      return mutationProjection(result);
    },
  );

  app.patch(
    "/api/issues/:issueId",
    {
      preHandler: requireSession,
      schema: {
        params: IssueParamsSchema,
        body: IssuePatchSchema,
        response: { 200: MutationResponseSchema, ...errorResponses },
      },
    },
    async (request) => {
      const { issueId } = request.params as { issueId: string };
      const result = await options.service.patchIssue(request.user, issueId, request.body as IssuePatch);
      return mutationProjection(result);
    },
  );

  app.patch(
    "/api/replies/:replyId",
    {
      preHandler: requireSession,
      schema: {
        params: ReplyParamsSchema,
        body: ReplyPatchSchema,
        response: { 200: MutationResponseSchema, ...errorResponses },
      },
    },
    async (request) => {
      const { replyId } = request.params as { replyId: string };
      const result = await options.service.patchReply(request.user, replyId, request.body as ReplyPatch);
      return mutationProjection(result);
    },
  );

  app.delete(
    "/api/issues/:issueId",
    {
      preHandler: requireSession,
      schema: {
        params: IssueParamsSchema,
        body: DeleteBodySchema,
        response: { 200: MutationResponseSchema, ...errorResponses },
      },
    },
    async (request) => {
      const { issueId } = request.params as { issueId: string };
      const { expectedVersion } = request.body as DeleteBody;
      const result = await options.service.deleteIssue(request.user, issueId, expectedVersion);
      return mutationProjection(result);
    },
  );

  app.delete(
    "/api/replies/:replyId",
    {
      preHandler: requireSession,
      schema: {
        params: ReplyParamsSchema,
        body: DeleteBodySchema,
        response: { 200: MutationResponseSchema, ...errorResponses },
      },
    },
    async (request) => {
      const { replyId } = request.params as { replyId: string };
      const { expectedVersion } = request.body as DeleteBody;
      const result = await options.service.deleteReply(request.user, replyId, expectedVersion);
      return mutationProjection(result);
    },
  );
};
