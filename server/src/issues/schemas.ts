import { type TSchema, Type } from "@sinclair/typebox";

// Every request/response object schema is strict: unknown properties are
// rejected rather than stripped or ignored.
const strict = { additionalProperties: false } as const;

export const PublicVersionIdSchema = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const RequestIdSchema = Type.String({
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});

const DueDateSchema = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

// Application-generated UTC RFC 3339 instants with a trailing Z.
const TimestampSchema = Type.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?Z$",
});

function nullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}

export const IssueStatusSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("in_review"),
  Type.Literal("closed"),
]);

export const ReviewerSummarySchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    username: Type.String({ minLength: 1 }),
  },
  strict,
);

export const ReviewersResponseSchema = Type.Object(
  { reviewers: Type.Array(ReviewerSummarySchema) },
  strict,
);

export const IssueAnchorSchema = Type.Object(
  {
    levelId: Type.String({ minLength: 1 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 }),
    latitude: Type.Number({ minimum: -90, maximum: 90 }),
    featureId: Type.Optional(Type.String({ minLength: 1 })),
  },
  strict,
);

export const IssueReplySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    rowVersion: Type.Integer({ minimum: 1 }),
    bodyMarkdown: nullable(Type.String()),
    author: ReviewerSummarySchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    deletedAt: nullable(TimestampSchema),
  },
  strict,
);

export const ReviewIssueSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    pinNumber: Type.Integer({ minimum: 1 }),
    rowVersion: Type.Integer({ minimum: 1 }),
    anchor: IssueAnchorSchema,
    bodyMarkdown: nullable(Type.String()),
    status: IssueStatusSchema,
    author: ReviewerSummarySchema,
    assignee: nullable(ReviewerSummarySchema),
    dueDate: nullable(DueDateSchema),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    deletedAt: nullable(TimestampSchema),
    replies: Type.Array(IssueReplySchema),
  },
  strict,
);

export const IssueCollectionSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
    issues: Type.Array(ReviewIssueSchema),
  },
  strict,
);

export const RootCreateBodySchema = Type.Object(
  {
    requestId: RequestIdSchema,
    bodyMarkdown: Type.String(),
    anchor: Type.Object(
      {
        levelId: Type.String({ minLength: 1 }),
        longitude: Type.Number(),
        latitude: Type.Number(),
        featureId: Type.Optional(nullable(Type.String({ minLength: 1 }))),
      },
      strict,
    ),
    assigneeId: Type.Optional(nullable(Type.Integer({ minimum: 1 }))),
    dueDate: Type.Optional(nullable(DueDateSchema)),
  },
  strict,
);

export const ReplyCreateBodySchema = Type.Object(
  {
    requestId: RequestIdSchema,
    bodyMarkdown: Type.String(),
  },
  strict,
);

const ExpectedVersionSchema = Type.Integer({ minimum: 1 });

export const IssuePatchBodySchema = Type.Object(
  {
    type: Type.Literal("body"),
    bodyMarkdown: Type.String(),
    expectedVersion: ExpectedVersionSchema,
  },
  strict,
);

export const IssuePatchAssignmentSchema = Type.Object(
  {
    type: Type.Literal("assignment"),
    assigneeId: nullable(Type.Integer({ minimum: 1 })),
    expectedVersion: ExpectedVersionSchema,
  },
  strict,
);

export const IssuePatchDueDateSchema = Type.Object(
  {
    type: Type.Literal("due_date"),
    dueDate: nullable(DueDateSchema),
    expectedVersion: ExpectedVersionSchema,
  },
  strict,
);

export const IssuePatchStatusSchema = Type.Object(
  {
    type: Type.Literal("status"),
    status: IssueStatusSchema,
    expectedVersion: ExpectedVersionSchema,
  },
  strict,
);

export const IssuePatchSchema = Type.Union([
  IssuePatchBodySchema,
  IssuePatchAssignmentSchema,
  IssuePatchDueDateSchema,
  IssuePatchStatusSchema,
]);

// Reply patches support exactly the body discriminant.
export const ReplyPatchSchema = IssuePatchBodySchema;

export const DeleteBodySchema = Type.Object({ expectedVersion: ExpectedVersionSchema }, strict);

export const MutationResponseSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
    resourceId: Type.String({ minLength: 1 }),
  },
  strict,
);

export const IssueApiErrorSchema = Type.Object(
  {
    error: Type.Union([
      Type.Literal("invalid_request"),
      Type.Literal("invalid_anchor"),
      Type.Literal("invalid_due_date"),
      Type.Literal("invalid_markdown"),
      Type.Literal("unauthorized"),
      Type.Literal("forbidden"),
      Type.Literal("not_found"),
      Type.Literal("stale_issue"),
      Type.Literal("idempotency_conflict"),
      Type.Literal("issue_deleted"),
      Type.Literal("sse_capacity"),
      Type.Literal("internal_error"),
    ]),
    message: Type.String(),
    details: Type.Optional(
      Type.Array(Type.Object({ field: Type.String(), reason: Type.String() }, strict)),
    ),
    current: Type.Optional(
      Type.Object(
        {
          kind: Type.Union([Type.Literal("issue"), Type.Literal("reply")]),
          value: Type.Union([ReviewIssueSchema, IssueReplySchema]),
        },
        strict,
      ),
    ),
    revision: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  strict,
);
