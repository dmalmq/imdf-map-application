import type { IssueErrorCode, IssueReply, ReviewIssue } from "./types";

export const ISSUE_ERROR_STATUS = {
  invalid_request: 400,
  invalid_anchor: 400,
  invalid_due_date: 400,
  invalid_markdown: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  stale_issue: 409,
  idempotency_conflict: 409,
  issue_deleted: 409,
  internal_error: 500,
  sse_capacity: 503,
} as const satisfies Record<IssueErrorCode, number>;

export const INTERNAL_ERROR_MESSAGE = "Could not update review issues.";

export interface IssueErrorDetail {
  field: string;
  reason: string;
}

export interface IssueCurrentResource {
  kind: "issue" | "reply";
  value: ReviewIssue | IssueReply;
}

export interface IssueApiError {
  error: IssueErrorCode;
  message: string;
  details?: IssueErrorDetail[];
  current?: IssueCurrentResource;
  revision?: number;
}

export interface IssueServiceErrorExtras {
  details?: IssueErrorDetail[];
  current?: IssueCurrentResource;
  revision?: number;
}

export class IssueServiceError extends Error {
  readonly code: IssueErrorCode;
  readonly details: IssueErrorDetail[] | undefined;
  readonly current: IssueCurrentResource | undefined;
  readonly revision: number | undefined;

  constructor(code: IssueErrorCode, message: string, extras?: IssueServiceErrorExtras) {
    super(message);
    this.name = "IssueServiceError";
    this.code = code;
    this.details = extras?.details;
    this.current = extras?.current;
    this.revision = extras?.revision;
  }

  get status(): number {
    return ISSUE_ERROR_STATUS[this.code];
  }
}

/**
 * Maps any thrown value to the wire error envelope. Unexpected failures and
 * `internal_error` service errors carrying raw database/blob/native detail are
 * logged server-side and serialized only as the sanitized internal copy.
 */
export function toIssueErrorResponse(
  error: unknown,
  log: (cause: unknown) => void,
): { status: number; body: IssueApiError } {
  if (error instanceof IssueServiceError && error.code !== "internal_error") {
    const body: IssueApiError = { error: error.code, message: error.message };
    if (error.details !== undefined) {
      body.details = error.details;
    }
    if (error.current !== undefined) {
      body.current = error.current;
    }
    if (error.revision !== undefined) {
      body.revision = error.revision;
    }
    return { status: error.status, body };
  }
  log(error);
  return {
    status: ISSUE_ERROR_STATUS.internal_error,
    body: { error: "internal_error", message: INTERNAL_ERROR_MESSAGE },
  };
}
