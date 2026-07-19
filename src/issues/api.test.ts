import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IssueApiError,
  createIssue,
  createReply,
  deleteIssue,
  deleteReply,
  getIssues,
  issueEventUrl,
  listReviewers,
  patchIssue,
  patchReply,
} from "./api";
import type { CreateIssueInput, IssueCollection } from "./types";

const PUBLIC_ID = "a".repeat(64);
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyCollection(revision = 0): IssueCollection {
  return { revision, issues: [] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("issue API", () => {
  it("gets the exact pinned collection with same-origin credentials and the supplied signal", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue(json(emptyCollection(4)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getIssues(PUBLIC_ID, signal)).resolves.toEqual(emptyCollection(4));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/review/versions/${PUBLIC_ID}/issues`,
      { credentials: "same-origin", signal },
    );
  });

  it("posts root and reply UUID request IDs to their exact routes", async () => {
    const responses = [
      { revision: 1, resourceId: "issue-1" },
      { revision: 2, resourceId: "reply-1" },
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(responses.shift())));
    vi.stubGlobal("fetch", fetchMock);
    const root: CreateIssueInput = {
      requestId: REQUEST_ID,
      bodyMarkdown: "Check this",
      anchor: { levelId: "level-1", longitude: 12.5, latitude: -4.25, featureId: "unit/a" },
      assigneeId: 3,
      dueDate: "2026-08-01",
    };

    await createIssue(PUBLIC_ID, root);
    await createReply("issue/1", { requestId: REQUEST_ID, bodyMarkdown: "Reply" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/review/versions/${PUBLIC_ID}/issues`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(root),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/issues/issue%2F1/replies", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: REQUEST_ID, bodyMarkdown: "Reply" }),
    });
  });

  it("sends typed patches and delete expected versions without altering payloads", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () => Promise.resolve(json({ revision: 9, resourceId: "resource" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await patchIssue("issue 1", { type: "status", status: "closed", expectedVersion: 7 });
    await patchReply("reply 1", { type: "body", bodyMarkdown: "Edited", expectedVersion: 2 });
    await deleteIssue("issue 1", 7);
    await deleteReply("reply 1", 2);

    expect(fetchMock.mock.calls).toEqual([
      ["/api/issues/issue%201", expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
        body: JSON.stringify({ type: "status", status: "closed", expectedVersion: 7 }),
      })],
      ["/api/replies/reply%201", expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
        body: JSON.stringify({ type: "body", bodyMarkdown: "Edited", expectedVersion: 2 }),
      })],
      ["/api/issues/issue%201", expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
        body: JSON.stringify({ expectedVersion: 7 }),
      })],
      ["/api/replies/reply%201", expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
        body: JSON.stringify({ expectedVersion: 2 }),
      })],
    ]);
  });

  it("unwraps the reviewer directory and uses same-origin credentials", async () => {
    const reviewers = [{ id: 2, username: "member" }];
    const fetchMock = vi.fn().mockResolvedValue(json({ reviewers }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listReviewers()).resolves.toEqual(reviewers);
    expect(fetchMock).toHaveBeenCalledWith("/api/reviewers", { credentials: "same-origin" });
  });

  it("preserves the complete structured error without converting it to a venue error", async () => {
    const current = {
      kind: "reply" as const,
      value: {
        id: "reply-1",
        rowVersion: 3,
        bodyMarkdown: "Current",
        author: { id: 2, username: "member" },
        createdAt: "2026-07-19T10:00:00.000Z",
        updatedAt: "2026-07-19T10:01:00.000Z",
        deletedAt: null,
      },
    };
    const payload = {
      error: "stale_issue" as const,
      message: "The reply changed.",
      details: [{ field: "expectedVersion", reason: "does not match" }],
      current,
      revision: 12,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(payload, 409)));

    const caught = await patchReply("reply-1", {
      type: "body",
      bodyMarkdown: "Mine",
      expectedVersion: 2,
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(IssueApiError);
    expect(caught).toMatchObject({ status: 409, ...payload });
    expect((caught as IssueApiError).constructor.name).toBe("IssueApiError");
  });

  it("constructs the native EventSource URL for the exact pinned version", () => {
    expect(issueEventUrl(PUBLIC_ID)).toBe(
      `/api/review/versions/${PUBLIC_ID}/issues/events`,
    );
  });
});
