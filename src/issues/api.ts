import type {
  CreateIssueInput,
  CreateReplyInput,
  IssueApiErrorBody,
  IssueCollection,
  IssueErrorCode,
  IssueMutationResponse,
  IssuePatch,
  IssueReply,
  ReplyBodyPatch,
  ReviewerSummary,
  ReviewIssue,
} from "./types";

export class IssueApiError extends Error {
  readonly status: number;
  readonly error: IssueErrorCode;
  readonly details: Array<{ field: string; reason: string }> | undefined;
  readonly current: { kind: "issue" | "reply"; value: ReviewIssue | IssueReply } | undefined;
  readonly revision: number | undefined;

  constructor(status: number, body: IssueApiErrorBody) {
    super(body.message);
    this.name = "IssueApiError";
    this.status = status;
    this.error = body.error;
    this.details = body.details;
    this.current = body.current;
    this.revision = body.revision;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const candidate = body as Partial<IssueApiErrorBody>;
    if (typeof candidate.error === "string" && typeof candidate.message === "string") {
      throw new IssueApiError(response.status, candidate as IssueApiErrorBody);
    }
    throw new IssueApiError(response.status, {
      error: "internal_error",
      message: "The issue request failed.",
    });
  }
  return body as T;
}

async function mutate<T>(url: string, method: "POST" | "PATCH" | "DELETE", body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

export async function getIssues(publicId: string, signal: AbortSignal): Promise<IssueCollection> {
  const response = await fetch(
    `/api/review/versions/${encodeURIComponent(publicId)}/issues`,
    { credentials: "same-origin", signal },
  );
  return parseResponse<IssueCollection>(response);
}

export function createIssue(publicId: string, input: CreateIssueInput): Promise<IssueMutationResponse> {
  return mutate(
    `/api/review/versions/${encodeURIComponent(publicId)}/issues`,
    "POST",
    input,
  );
}

export function createReply(issueId: string, input: CreateReplyInput): Promise<IssueMutationResponse> {
  return mutate(`/api/issues/${encodeURIComponent(issueId)}/replies`, "POST", input);
}

export function patchIssue(issueId: string, patch: IssuePatch): Promise<IssueMutationResponse> {
  return mutate(`/api/issues/${encodeURIComponent(issueId)}`, "PATCH", patch);
}

export function patchReply(replyId: string, patch: ReplyBodyPatch): Promise<IssueMutationResponse> {
  return mutate(`/api/replies/${encodeURIComponent(replyId)}`, "PATCH", patch);
}

export function deleteIssue(issueId: string, expectedVersion: number): Promise<IssueMutationResponse> {
  return mutate(`/api/issues/${encodeURIComponent(issueId)}`, "DELETE", { expectedVersion });
}

export function deleteReply(replyId: string, expectedVersion: number): Promise<IssueMutationResponse> {
  return mutate(`/api/replies/${encodeURIComponent(replyId)}`, "DELETE", { expectedVersion });
}

export async function listReviewers(): Promise<ReviewerSummary[]> {
  const response = await fetch("/api/reviewers", { credentials: "same-origin" });
  const body = await parseResponse<{ reviewers: ReviewerSummary[] }>(response);
  return body.reviewers;
}

export function issueEventUrl(publicId: string): string {
  return `/api/review/versions/${encodeURIComponent(publicId)}/issues/events`;
}

export interface IssueApiClient {
  getIssues: typeof getIssues;
  createIssue: typeof createIssue;
  createReply: typeof createReply;
  patchIssue: typeof patchIssue;
  patchReply: typeof patchReply;
  deleteIssue: typeof deleteIssue;
  deleteReply: typeof deleteReply;
  listReviewers: typeof listReviewers;
  issueEventUrl: typeof issueEventUrl;
}

export const issueApi: IssueApiClient = {
  getIssues,
  createIssue,
  createReply,
  patchIssue,
  patchReply,
  deleteIssue,
  deleteReply,
  listReviewers,
  issueEventUrl,
};
