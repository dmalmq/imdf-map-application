import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformError } from "../platform/catalogClient";
import type * as catalogClient from "../platform/catalogClient";
import type { CommentInput, CommentRecord } from "../platform/types";
import { CommentsPanel } from "./CommentsPanel";

const fetchCommentsMock = vi.fn<(id: string, signal?: AbortSignal) => Promise<CommentRecord[]>>(
  async () => [],
);
const postCommentMock = vi.fn<(id: string, input: CommentInput) => Promise<CommentRecord>>();
const deleteCommentMock = vi.fn<(id: string, commentId: string) => Promise<void>>(
  async () => undefined,
);

vi.mock("../platform/catalogClient", async (importOriginal) => {
  const actual = await importOriginal<typeof catalogClient>();
  return {
    ...actual,
    fetchComments: (id: string, signal?: AbortSignal) => fetchCommentsMock(id, signal),
    postComment: (id: string, input: CommentInput) => postCommentMock(id, input),
    deleteComment: (id: string, commentId: string) => deleteCommentMock(id, commentId),
  };
});

const OLD: CommentRecord = {
  id: "c1",
  author: "alice",
  text: "old comment",
  createdAt: "2026-07-01T00:00:00.000Z",
};
const NEW: CommentRecord = {
  id: "c2",
  author: "bob",
  text: "new pinned comment",
  createdAt: "2026-07-02T00:00:00.000Z",
  levelId: "ordinal:0",
  lngLat: [139.76, 35.68],
};

function props(overrides?: Partial<Parameters<typeof CommentsPanel>[0]>) {
  return {
    datasetId: "tokyo",
    account: { username: "alice", role: "user" as const },
    locale: "en" as const,
    selectedFeatureId: null,
    pinDraft: null,
    pinArmed: false,
    onArmPin: vi.fn(),
    onClearPin: vi.fn(),
    onFocusComment: vi.fn(),
    onRequestSignIn: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("CommentsPanel", () => {
  it("lists comments newest first and focuses a pinned comment on click", async () => {
    fetchCommentsMock.mockResolvedValueOnce([OLD, NEW]);
    const p = props();
    render(<CommentsPanel {...p} />);
    const items = await screen.findAllByRole("listitem");
    expect(items[0]?.textContent).toContain("new pinned comment");
    expect(items[1]?.textContent).toContain("old comment");
    // Pinned status is accessible text plus a CSS-ready modifier, never an emoji.
    expect(items[0]?.textContent).toContain("Pinned");
    expect(items[0]?.textContent).not.toContain("\u{1F4CD}");
    expect(items[0]?.className).toContain("comments-panel__item--pinned");
    expect(items[1]?.className).not.toContain("comments-panel__item--pinned");
    await userEvent.click(screen.getByRole("button", { name: /new pinned comment/ }));
    expect(p.onFocusComment).toHaveBeenCalledWith(NEW);
  });

  it("posts with the pin draft and clears it", async () => {
    fetchCommentsMock.mockResolvedValue([]);
    postCommentMock.mockResolvedValue({ ...NEW, id: "c9", text: "here" });
    const p = props({ pinDraft: { levelId: "ordinal:0", lngLat: [139.76, 35.68] } });
    render(<CommentsPanel {...p} />);
    await userEvent.type(await screen.findByLabelText("Comment"), "here");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => {
      expect(postCommentMock).toHaveBeenCalledWith("tokyo", {
        text: "here",
        levelId: "ordinal:0",
        lngLat: [139.76, 35.68],
      });
    });
    await waitFor(() => {
      expect(p.onClearPin).toHaveBeenCalled();
    });
    expect((screen.getByLabelText("Comment") as HTMLTextAreaElement).value).toBe("");
  });

  it("shows a sign-in prompt instead of the composer when signed out", async () => {
    fetchCommentsMock.mockResolvedValueOnce([OLD]);
    const p = props({ account: null });
    render(<CommentsPanel {...p} />);
    await screen.findAllByRole("listitem");
    expect(screen.queryByLabelText("Comment")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign in to comment" }));
    expect(p.onRequestSignIn).toHaveBeenCalled();
  });

  it("offers delete only to the owner or an admin", async () => {
    fetchCommentsMock.mockResolvedValueOnce([OLD, NEW]);
    render(<CommentsPanel {...props({ account: { username: "alice", role: "user" } })} />);
    const items = await screen.findAllByRole("listitem");
    // alice owns OLD (rendered second), not NEW.
    expect(items[1]?.querySelector("button[aria-label='Delete comment']")).toBeTruthy();
    expect(items[0]?.querySelector("button[aria-label='Delete comment']")).toBeNull();
  });

  it("offers delete on every comment to an admin", async () => {
    fetchCommentsMock.mockResolvedValueOnce([OLD, NEW]);
    render(<CommentsPanel {...props({ account: { username: "root", role: "admin" as const } })} />);
    const items = await screen.findAllByRole("listitem");
    expect(items[0]?.querySelector("button[aria-label='Delete comment']")).toBeTruthy();
    expect(items[1]?.querySelector("button[aria-label='Delete comment']")).toBeTruthy();
  });

  it("localizes the panel and arms the map pin with a linked feature", async () => {
    fetchCommentsMock.mockResolvedValue([]);
    postCommentMock.mockResolvedValue(OLD);
    const p = props({ locale: "ja" as const, selectedFeatureId: "f1" });
    render(<CommentsPanel {...p} />);
    await screen.findByText("コメントはまだありません。");
    await userEvent.click(screen.getByRole("button", { name: "地図にピンを打つ" }));
    expect(p.onArmPin).toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText("選択中の地物に紐付け"));
    await userEvent.type(screen.getByRole("textbox", { name: "コメント" }), "リンク済み");
    await userEvent.click(screen.getByRole("button", { name: "投稿" }));
    await waitFor(() => {
      expect(postCommentMock).toHaveBeenCalledWith("tokyo", {
        text: "リンク済み",
        featureId: "f1",
      });
    });
  });

  it("shows a retryable notice when loading fails and recovers on retry", async () => {
    fetchCommentsMock.mockRejectedValueOnce(new Error("network down"));
    fetchCommentsMock.mockResolvedValueOnce([OLD]);
    render(<CommentsPanel {...props()} />);
    expect(await screen.findByText("Comments could not be loaded.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    const items = await screen.findAllByRole("listitem");
    expect(items[0]?.textContent).toContain("old comment");
    expect(screen.queryByText("Comments could not be loaded.")).toBeNull();
  });

  it("requests sign-in when posting fails with 401 and keeps the draft", async () => {
    fetchCommentsMock.mockResolvedValue([]);
    postCommentMock.mockRejectedValue(new PlatformError(401, "unauthorized", "Sign in required."));
    const p = props();
    render(<CommentsPanel {...p} />);
    await userEvent.type(await screen.findByLabelText("Comment"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => {
      expect(p.onRequestSignIn).toHaveBeenCalled();
    });
    expect(await screen.findByText("Sign in required.")).toBeTruthy();
    expect((screen.getByLabelText("Comment") as HTMLTextAreaElement).value).toBe("hello");
  });

  it("surfaces a delete failure without wiping the list, then deletes on retry", async () => {
    fetchCommentsMock.mockResolvedValueOnce([OLD]);
    deleteCommentMock.mockRejectedValueOnce(new PlatformError(500, "internal_error", "boom"));
    render(<CommentsPanel {...props()} />);
    await screen.findAllByRole("listitem");
    await userEvent.click(screen.getByLabelText("Delete comment"));
    expect(await screen.findByText("The comment could not be deleted.")).toBeTruthy();
    expect(deleteCommentMock).toHaveBeenCalledWith("tokyo", "c1");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    deleteCommentMock.mockResolvedValueOnce(undefined);
    fetchCommentsMock.mockResolvedValueOnce([]);
    await userEvent.click(screen.getByLabelText("Delete comment"));
    await screen.findByText("No comments yet.");
    expect(screen.queryByText("The comment could not be deleted.")).toBeNull();
  });

  it("ignores a stale response after the dataset changes", async () => {
    let resolveFirst!: (rows: CommentRecord[]) => void;
    fetchCommentsMock.mockImplementationOnce(
      () =>
        new Promise<CommentRecord[]>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    fetchCommentsMock.mockResolvedValueOnce([NEW]);
    const p = props();
    const { rerender } = render(<CommentsPanel {...p} />);
    rerender(<CommentsPanel {...p} datasetId="osaka" />);
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("new pinned comment");
    // The superseded request was aborted and its late result must not land.
    expect(fetchCommentsMock.mock.calls[0]?.[1]?.aborted).toBe(true);
    resolveFirst([OLD]);
    await waitFor(() => {
      expect(screen.queryByText("old comment")).toBeNull();
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });


  it("resets a pending composer when the dataset changes", async () => {
    fetchCommentsMock.mockResolvedValue([]);
    let resolvePost!: (comment: CommentRecord) => void;
    postCommentMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );
    const p = props();
    const { rerender } = render(<CommentsPanel {...p} />);
    await userEvent.type(await screen.findByLabelText("Comment"), "old draft");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    rerender(<CommentsPanel {...p} datasetId="osaka" />);
    await screen.findByText("No comments yet.");
    expect((screen.getByLabelText("Comment") as HTMLTextAreaElement).value).toBe("");
    await userEvent.type(screen.getByLabelText("Comment"), "new draft");
    expect((screen.getByRole("button", { name: "Post" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    resolvePost(OLD);
    await Promise.resolve();
    expect(p.onClearPin).not.toHaveBeenCalled();
  });
  it("aborts the in-flight load on unmount", async () => {
    let resolveLoad!: (rows: CommentRecord[]) => void;
    fetchCommentsMock.mockImplementationOnce(
      () =>
        new Promise<CommentRecord[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const { unmount } = render(<CommentsPanel {...props()} />);
    const signal = fetchCommentsMock.mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    resolveLoad([OLD]);
    await Promise.resolve();
  });
});
