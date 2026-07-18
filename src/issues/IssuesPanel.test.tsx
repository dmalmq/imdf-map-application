import type { ReactElement } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { LocaleCode } from "../imdf/types";
import { initialIssueState } from "./issueReducer";
import { countActiveIssues, issueSummary } from "./IssueQueue";
import { IssuesPanel, type IssuesPanelProps } from "./IssuesPanel";
import type {
  IssueCollection,
  IssueDraft,
  IssueReply,
  IssueState,
  IssueStatus,
  ReviewerSummary,
  ReviewIssue,
} from "./types";
import type { IssueActor, IssueCommands, IssueController, IssueUiActions } from "./useIssueSync";

const PUBLIC_ID = "a".repeat(64);

const VIEWER: IssueActor = { id: 1, username: "viewer1", role: "viewer" };
const MEMBER: IssueActor = { id: 2, username: "member1", role: "member" };
const ADMIN: IssueActor = { id: 3, username: "admin1", role: "admin" };
const REVIEWERS: ReviewerSummary[] = [
  { id: 1, username: "viewer1" },
  { id: 2, username: "member1" },
  { id: 3, username: "admin1" },
];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localDueString(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const YESTERDAY = localDueString(-1);
const IN_TWO_DAYS = localDueString(2);
const IN_FOUR_DAYS = localDueString(4);

interface IssueOptions {
  id: string;
  pinNumber: number;
  levelId?: string;
  status?: IssueStatus;
  authorId?: number;
  authorName?: string;
  assigneeId?: number | null;
  assigneeName?: string;
  dueDate?: string | null;
  body?: string;
  deletedAt?: string | null;
  replies?: IssueReply[];
  rowVersion?: number;
}

function makeIssue(options: IssueOptions): ReviewIssue {
  const deletedAt = options.deletedAt ?? null;
  const shared = {
    id: options.id,
    pinNumber: options.pinNumber,
    rowVersion: options.rowVersion ?? 1,
    anchor: {
      levelId: options.levelId ?? "level-1f",
      longitude: 139.7,
      latitude: 35.68,
    },
    status: options.status ?? ("open" as IssueStatus),
    author: { id: options.authorId ?? 2, username: options.authorName ?? "member1" },
    assignee:
      options.assigneeId != null
        ? { id: options.assigneeId, username: options.assigneeName ?? `user${options.assigneeId}` }
        : null,
    dueDate: options.dueDate ?? null,
    createdAt: "2026-07-18T09:00:00Z",
    updatedAt: "2026-07-18T10:00:00Z",
    replies: options.replies ?? [],
  };
  return deletedAt === null
    ? { ...shared, bodyMarkdown: options.body ?? "Body text", deletedAt: null }
    : { ...shared, bodyMarkdown: null, deletedAt };
}

interface ReplyOptions {
  id: string;
  authorId?: number;
  authorName?: string;
  body?: string;
  deletedAt?: string | null;
  rowVersion?: number;
}

function makeReply(options: ReplyOptions): IssueReply {
  const deletedAt = options.deletedAt ?? null;
  const shared = {
    id: options.id,
    rowVersion: options.rowVersion ?? 1,
    author: { id: options.authorId ?? 1, username: options.authorName ?? "viewer1" },
    createdAt: "2026-07-18T09:30:00Z",
    updatedAt: "2026-07-18T09:30:00Z",
  };
  return deletedAt === null
    ? { ...shared, bodyMarkdown: options.body ?? "Reply text", deletedAt: null }
    : { ...shared, bodyMarkdown: null, deletedAt };
}

function makeDraft(patch: Partial<IssueDraft> = {}): IssueDraft {
  return {
    requestId: "req-1",
    anchor: { levelId: "level-1f", longitude: 139.7, latitude: 35.68 },
    bodyMarkdown: "",
    assigneeId: null,
    dueDate: null,
    ...patch,
  };
}

function collection(revision: number, issues: ReviewIssue[]): IssueCollection {
  return { revision, issues };
}

interface PanelHarness {
  commands: { [K in keyof IssueCommands]: Mock };
  ui: { [K in keyof IssueUiActions]: Mock };
  retryCollection: Mock;
  resetNotice: Mock;
  callbacks: {
    onRetryAuth: Mock;
    onRequestSignIn: Mock;
    onBeginPlacement: Mock;
    onCancelPlacement: Mock;
  };
  update(patch: Partial<IssueState>): void;
}

function renderPanel(
  options: {
    state?: Partial<IssueState>;
    currentUser?: IssueActor | null;
    reviewers?: ReviewerSummary[];
    identityError?: boolean;
    authError?: boolean;
    locale?: LocaleCode;
  } = {},
): PanelHarness {
  let state: IssueState = { ...initialIssueState(PUBLIC_ID), ...options.state };
  const commands = {
    createIssue: vi.fn(),
    createReply: vi.fn(),
    patchIssue: vi.fn(),
    patchReply: vi.fn(),
    deleteIssue: vi.fn(),
    deleteReply: vi.fn(),
  };
  const ui = {
    setFilter: vi.fn(),
    selectIssue: vi.fn(),
    startDraft: vi.fn(),
    updateDraft: vi.fn(),
    cancelDraft: vi.fn(),
    setPlacement: vi.fn(),
  };
  const retryCollection = vi.fn();
  const resetNotice = vi.fn();
  const callbacks: PanelHarness["callbacks"] = {
    onRetryAuth: vi.fn(),
    onRequestSignIn: vi.fn(),
    onBeginPlacement: vi.fn(),
    onCancelPlacement: vi.fn(),
  };

  function controller(): IssueController {
    return { state, commands, ui, retryCollection, resetNotice };
  }
  function element(): ReactElement {
    const props: IssuesPanelProps = {
      locale: options.locale ?? "en",
      controller: controller(),
      currentUser: options.currentUser ?? null,
      reviewers: options.reviewers ?? REVIEWERS,
      identityError: options.identityError ?? false,
      authError: options.authError ?? false,
      onRetryAuth: callbacks.onRetryAuth,
      onRequestSignIn: callbacks.onRequestSignIn,
      onBeginPlacement: callbacks.onBeginPlacement,
      onCancelPlacement: callbacks.onCancelPlacement,
    };
    return <IssuesPanel {...props} />;
  }

  const view = render(element());
  return {
    commands,
    ui,
    retryCollection,
    resetNotice,
    callbacks,
    update(patch: Partial<IssueState>) {
      state = { ...state, ...patch };
      view.rerender(element());
    },
  };
}

function renderDetail(
  issue: ReviewIssue,
  actor: IssueActor | null,
  patch: Partial<IssueState> = {},
): PanelHarness {
  return renderPanel({
    currentUser: actor,
    state: {
      collection: collection(1, [issue]),
      appliedRevision: 1,
      highestObservedRevision: 1,
      selectedIssueId: issue.id,
      ...patch,
    },
  });
}

describe("IssueQueue filtering", () => {
  const issues = [
    makeIssue({ id: "i1", pinNumber: 1, levelId: "level-1f", body: "Gate is blocked" }),
    makeIssue({
      id: "i2",
      pinNumber: 2,
      levelId: "level-2f",
      status: "in_review",
      body: "Signage unclear",
      assigneeId: 1,
      assigneeName: "viewer1",
    }),
    makeIssue({ id: "i3", pinNumber: 3, levelId: "level-b1", status: "closed", body: "Fixed" }),
    makeIssue({ id: "i4", pinNumber: 4, levelId: "level-b1", deletedAt: "2026-07-18T11:00:00Z" }),
  ];

  it("shows active issues by default and reports filter changes", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: VIEWER,
      state: { collection: collection(1, issues), appliedRevision: 1 },
    });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain("Gate is blocked");
    expect(options[1]?.textContent).toContain("Signage unclear");
    expect(screen.getByRole("button", { name: "Active" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Closed" }));
    expect(harness.ui.setFilter).toHaveBeenCalledWith("closed");

    harness.update({ filter: "closed" });
    const closedOptions = screen.getAllByRole("option");
    expect(closedOptions).toHaveLength(2);
    expect(closedOptions[0]?.textContent).toContain("Fixed");
    expect(closedOptions[1]?.textContent).toContain("Comment deleted");
  });

  it("filters assigned-to-me and unassigned against the signed-in user", () => {
    const harness = renderPanel({
      currentUser: VIEWER,
      state: { collection: collection(1, issues), appliedRevision: 1, filter: "assigned_to_me" },
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").textContent).toContain("Signage unclear");

    harness.update({ filter: "unassigned" });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").textContent).toContain("Gate is blocked");
  });

  it("shows a filter-specific empty state", () => {
    renderPanel({
      currentUser: VIEWER,
      state: { collection: collection(1, []), appliedRevision: 1, filter: "unassigned" },
    });
    expect(screen.getByText("No unassigned issues")).toBeTruthy();
  });

  it("selecting a row reports the issue id", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: VIEWER,
      state: { collection: collection(1, issues), appliedRevision: 1 },
    });
    await user.click(screen.getAllByRole("option")[0] as HTMLElement);
    expect(harness.ui.selectIssue).toHaveBeenCalledWith("i1");
  });
});

describe("active issue badge derivation", () => {
  it("counts open and in_review issues across every floor", () => {
    const issues = [
      makeIssue({ id: "i1", pinNumber: 1, levelId: "level-1f" }),
      makeIssue({ id: "i2", pinNumber: 2, levelId: "level-2f", status: "in_review" }),
      makeIssue({ id: "i3", pinNumber: 3, levelId: "level-b1", status: "closed" }),
      makeIssue({ id: "i4", pinNumber: 4, levelId: "level-b1", deletedAt: "2026-07-18T11:00:00Z" }),
    ];
    expect(countActiveIssues(issues)).toBe(2);
  });

  it("shows the all-floor active count above the queue", () => {
    renderPanel({
      currentUser: VIEWER,
      state: {
        collection: collection(1, [
          makeIssue({ id: "i1", pinNumber: 1, levelId: "level-1f" }),
          makeIssue({ id: "i2", pinNumber: 2, levelId: "level-2f", status: "in_review" }),
        ]),
        appliedRevision: 1,
      },
    });
    expect(screen.getByText("2 active")).toBeTruthy();
  });
});

describe("issueSummary", () => {
  it("uses the first non-empty normalized source line", () => {
    expect(issueSummary("\n\n  First line\nsecond line", "en")).toBe("First line");
    expect(issueSummary("a\r\nb", "en")).toBe("a");
  });

  it("collapses whitespace runs", () => {
    expect(issueSummary("  many\t spaces   here  ", "en")).toBe("many spaces here");
  });

  it("keeps 80 Unicode scalar values without an ellipsis", () => {
    expect(issueSummary("x".repeat(80), "en")).toBe("x".repeat(80));
    expect(issueSummary("🙂".repeat(80), "en")).toBe("🙂".repeat(80));
  });

  it("truncates 81 scalar values to 80 plus an ellipsis", () => {
    expect(issueSummary("x".repeat(81), "en")).toBe(`${"x".repeat(80)}…`);
    expect(issueSummary("🙂".repeat(81), "en")).toBe(`${"🙂".repeat(80)}…`);
    expect(issueSummary(`${"x".repeat(81)} trailing`, "en")).toBe(`${"x".repeat(80)}…`);
  });

  it("localizes the deleted-root tombstone", () => {
    expect(issueSummary(null, "en")).toBe("Comment deleted");
    expect(issueSummary(null, "ja")).toBe("コメントは削除されました");
  });
});

describe("queue row content", () => {
  it("shows pin number, status, assignee, reply count, and due classification text", () => {
    const issues = [
      makeIssue({
        id: "i1",
        pinNumber: 7,
        body: "Escalator stopped",
        assigneeId: 2,
        assigneeName: "member1",
        dueDate: YESTERDAY,
        replies: [makeReply({ id: "r1" }), makeReply({ id: "r2" })],
      }),
      makeIssue({ id: "i2", pinNumber: 8, body: "Loose tile", dueDate: IN_TWO_DAYS }),
      makeIssue({ id: "i3", pinNumber: 9, body: "Future work", dueDate: IN_FOUR_DAYS }),
    ];
    renderPanel({
      currentUser: MEMBER,
      state: { collection: collection(1, issues), appliedRevision: 1 },
    });

    const options = screen.getAllByRole("option");
    expect(options[0]?.textContent).toContain("#7");
    expect(options[0]?.textContent).toContain("Open");
    expect(options[0]?.textContent).toContain("member1");
    expect(options[0]?.textContent).toContain("2 replies");
    expect(options[0]?.textContent).toContain("Overdue");
    expect(options[1]?.textContent).toContain("Due soon");
    expect(options[2]?.textContent).not.toContain("Due soon");
    expect(options[2]?.textContent).not.toContain("Overdue");
  });
});

describe("IssueDetail role matrix", () => {
  const authoredByMember = makeIssue({
    id: "i1",
    pinNumber: 1,
    body: "Root markdown body",
    authorId: 2,
    authorName: "member1",
  });

  it("anonymous users read but get no mutation controls", () => {
    renderDetail(authoredByMember, null);
    expect(screen.queryByRole("button", { name: "Edit issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete issue" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Assignee" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
    expect(screen.queryByText("Root markdown body")).toBeTruthy();
  });

  it("a viewer who is not the author can only self-assign or reply", () => {
    renderDetail(authoredByMember, VIEWER);
    expect(screen.queryByRole("button", { name: "Edit issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete issue" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
    expect(screen.queryByLabelText("Due date")).toBeNull();
    expect(screen.getByRole("button", { name: "Assign to me" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Reply" })).toBeTruthy();
  });

  it("the member author edits and moderates their own issue", () => {
    renderDetail(authoredByMember, MEMBER);
    expect(screen.getByRole("button", { name: "Edit issue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete issue" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Assignee" })).toBeTruthy();
    expect(screen.getByLabelText("Due date")).toBeTruthy();
  });

  it("an admin can delete any issue but never edits another author's text", () => {
    renderDetail(authoredByMember, ADMIN);
    expect(screen.queryByRole("button", { name: "Edit issue" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete issue" })).toBeTruthy();
  });

  it("a viewer author edits and deletes their own issue", () => {
    renderDetail(makeIssue({ id: "i9", pinNumber: 9, authorId: 1, authorName: "viewer1" }), VIEWER);
    expect(screen.getByRole("button", { name: "Edit issue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete issue" })).toBeTruthy();
  });
});

describe("self-assignment transitions", () => {
  it("a viewer assigns themselves on an unassigned issue", async () => {
    const user = userEvent.setup();
    const issue = makeIssue({ id: "i1", pinNumber: 1, rowVersion: 5 });
    const harness = renderDetail(issue, VIEWER);
    await user.click(screen.getByRole("button", { name: "Assign to me" }));
    expect(harness.commands.patchIssue).toHaveBeenCalledWith("i1", {
      type: "assignment",
      assigneeId: 1,
      expectedVersion: 5,
    });
  });

  it("a viewer clears only their own assignment", async () => {
    const user = userEvent.setup();
    const issue = makeIssue({
      id: "i1",
      pinNumber: 1,
      rowVersion: 6,
      assigneeId: 1,
      assigneeName: "viewer1",
    });
    const harness = renderDetail(issue, VIEWER);
    await user.click(screen.getByRole("button", { name: "Unassign me" }));
    expect(harness.commands.patchIssue).toHaveBeenCalledWith("i1", {
      type: "assignment",
      assigneeId: null,
      expectedVersion: 6,
    });
  });

  it("a viewer cannot replace another account's assignment", () => {
    const issue = makeIssue({ id: "i1", pinNumber: 1, assigneeId: 3, assigneeName: "admin1" });
    renderDetail(issue, VIEWER);
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unassign me" })).toBeNull();
    expect(screen.getByText("admin1")).toBeTruthy();
  });
});

describe("member assignment, due date, and status", () => {
  it("assigns and clears any account through the select", () => {
    const issue = makeIssue({ id: "i1", pinNumber: 1, rowVersion: 3 });
    const harness = renderDetail(issue, MEMBER);
    const select = screen.getByRole("combobox", { name: "Assignee" });
    fireEvent.change(select, { target: { value: "3" } });
    expect(harness.commands.patchIssue).toHaveBeenCalledWith("i1", {
      type: "assignment",
      assigneeId: 3,
      expectedVersion: 3,
    });
    fireEvent.change(select, { target: { value: "" } });
    expect(harness.commands.patchIssue).toHaveBeenCalledWith("i1", {
      type: "assignment",
      assigneeId: null,
      expectedVersion: 3,
    });
  });

  it("sets and clears the due date", () => {
    const issue = makeIssue({ id: "i1", pinNumber: 1, rowVersion: 4, dueDate: "2026-08-01" });
    const harness = renderDetail(issue, MEMBER);
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-09-15" } });
    expect(harness.commands.patchIssue).toHaveBeenCalledWith("i1", {
      type: "due_date",
      dueDate: "2026-09-15",
      expectedVersion: 4,
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear due date" }));
    expect(harness.commands.patchIssue).toHaveBeenCalledWith("i1", {
      type: "due_date",
      dueDate: null,
      expectedVersion: 4,
    });
  });

  it("changes the status of an open issue", () => {
    const open = makeIssue({ id: "i1", pinNumber: 1, rowVersion: 2 });
    const harness = renderDetail(open, MEMBER);
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "in_review" },
    });
    expect(harness.commands.patchIssue).toHaveBeenCalledWith("i1", {
      type: "status",
      status: "in_review",
      expectedVersion: 2,
    });
  });

  it("reopens a closed issue", () => {
    const closed = makeIssue({ id: "i2", pinNumber: 2, rowVersion: 7, status: "closed" });
    const harness = renderDetail(closed, MEMBER);
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "open" },
    });
    expect(harness.commands.patchIssue).toHaveBeenCalledWith("i2", {
      type: "status",
      status: "open",
      expectedVersion: 7,
    });
  });
});

describe("tombstones and reply controls", () => {
  it("renders a deleted root as a tombstone and hides status and reply creation", () => {
    const deleted = makeIssue({
      id: "i1",
      pinNumber: 1,
      status: "closed",
      deletedAt: "2026-07-18T11:00:00Z",
      replies: [makeReply({ id: "r1", body: "Still visible" })],
    });
    renderDetail(deleted, MEMBER);
    expect(screen.getByText("Comment deleted")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Assignee" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Reply" })).toBeNull();
    expect(screen.getByText("Still visible")).toBeTruthy();
  });

  it("keeps reply edit/delete controls under the normal authorship rules", () => {
    const deleted = makeIssue({
      id: "i1",
      pinNumber: 1,
      status: "closed",
      deletedAt: "2026-07-18T11:00:00Z",
      replies: [
        makeReply({ id: "r1", authorId: 1, authorName: "viewer1", body: "Mine" }),
        makeReply({ id: "r2", authorId: 2, authorName: "member1", body: "Theirs" }),
        makeReply({ id: "r3", authorId: 2, deletedAt: "2026-07-18T12:00:00Z" }),
      ],
    });
    renderDetail(deleted, VIEWER);
    expect(screen.getByRole("button", { name: "Edit reply" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete reply" })).toBeTruthy();
    expect(screen.getAllByText("Comment deleted")).toHaveLength(2);
  });

  it("an admin deletes any reply but edits only their own", () => {
    const issue = makeIssue({
      id: "i1",
      pinNumber: 1,
      replies: [makeReply({ id: "r1", authorId: 1, authorName: "viewer1", body: "Mine" })],
    });
    renderDetail(issue, ADMIN);
    expect(screen.queryByRole("button", { name: "Edit reply" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete reply" })).toBeTruthy();
  });

  it("edits and deletes a reply with its row version", async () => {
    const user = userEvent.setup();
    const issue = makeIssue({
      id: "i1",
      pinNumber: 1,
      replies: [makeReply({ id: "r1", authorId: 1, body: "Original", rowVersion: 4 })],
    });
    const harness = renderDetail(issue, VIEWER);

    await user.click(screen.getByRole("button", { name: "Edit reply" }));
    const editor = screen.getByRole("textbox", { name: "Edit reply body" });
    fireEvent.change(editor, { target: { value: "Updated" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(harness.commands.patchReply).toHaveBeenCalledWith("r1", {
      type: "body",
      bodyMarkdown: "Updated",
      expectedVersion: 4,
    });

    await user.click(screen.getByRole("button", { name: "Delete reply" }));
    expect(harness.commands.deleteReply).toHaveBeenCalledWith("r1", 4);
  });

  it("edits the root body through the controller with normalized Markdown", async () => {
    const user = userEvent.setup();
    const issue = makeIssue({ id: "i1", pinNumber: 1, authorId: 1, rowVersion: 8, body: "Before" });
    const harness = renderDetail(issue, VIEWER);
    await user.click(screen.getByRole("button", { name: "Edit issue" }));
    const editor = screen.getByRole("textbox", { name: "Edit issue body" });
    fireEvent.change(editor, { target: { value: "After\r\nline" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(harness.commands.patchIssue).toHaveBeenCalledWith("i1", {
      type: "body",
      bodyMarkdown: "After\nline",
      expectedVersion: 8,
    });
  });
});

describe("replies on closed issues", () => {
  it("a signed-in user replies to a closed issue with normalized Markdown", async () => {
    const user = userEvent.setup();
    const issue = makeIssue({ id: "i1", pinNumber: 1, status: "closed", authorId: 2 });
    const harness = renderDetail(issue, VIEWER);

    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Sounds good\r\nShip it" },
    });
    await user.click(screen.getByRole("button", { name: "Reply" }));
    expect(harness.commands.createReply).toHaveBeenCalledTimes(1);
    const [issueId, input] = harness.commands.createReply.mock.calls[0] as [
      string,
      { requestId: string; bodyMarkdown: string },
    ];
    expect(issueId).toBe("i1");
    expect(input.bodyMarkdown).toBe("Sounds good\nShip it");
    expect(UUID_V4.test(input.requestId)).toBe(true);
  });

  it("an anonymous user is invited to sign in to reply", async () => {
    const user = userEvent.setup();
    const issue = makeIssue({ id: "i1", pinNumber: 1 });
    const harness = renderDetail(issue, null);
    await user.click(screen.getByRole("button", { name: "Sign in to reply" }));
    expect(harness.callbacks.onRequestSignIn).toHaveBeenCalled();
  });
});

describe("retry, error, conflict, and stream states", () => {
  it("offers a retry when the collection fails to load", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: VIEWER,
      state: {
        collection: null,
        error: { kind: "network", message: "offline" },
        errorScope: "collection",
        refetchInFlight: false,
        refetchRequested: false,
      },
    });
    expect(screen.getByText("Issues couldn't be loaded.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(harness.retryCollection).toHaveBeenCalled();
  });

  it("shows a mutation failure without blocking further input", () => {
    renderDetail(makeIssue({ id: "i1", pinNumber: 1, authorId: 1 }), VIEWER, {
      error: { kind: "network", message: "offline" },
      errorScope: "mutation",
    });
    expect(
      screen.getByText("The change couldn't be saved. Your input is safe — try again."),
    ).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Reply" })).toBeTruthy();
  });

  it("explains a conflict and preserves the draft", () => {
    renderDetail(makeIssue({ id: "i1", pinNumber: 1, authorId: 1 }), VIEWER, {
      conflict: {
        kind: "api",
        status: 409,
        error: "stale_issue",
        message: "stale",
      },
    });
    expect(
      screen.getByText(
        "This issue changed while you were working. Your input is safe — review it and try again.",
      ),
    ).toBeTruthy();
  });

  it("asks for sign-in when the session expired mid-mutation", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: null,
      state: {
        collection: collection(1, []),
        appliedRevision: 1,
        authRequired: true,
      },
    });
    expect(screen.getByText("Your session expired. Sign in to continue.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(harness.callbacks.onRequestSignIn).toHaveBeenCalled();
  });

  it("shows a reconnecting line while keeping loaded issues visible", () => {
    renderPanel({
      currentUser: VIEWER,
      state: {
        collection: collection(1, [makeIssue({ id: "i1", pinNumber: 1, body: "Still here" })]),
        appliedRevision: 1,
        reconnecting: true,
        stale: true,
      },
    });
    expect(screen.getByText("Connection lost. Reconnecting…")).toBeTruthy();
    expect(screen.getByText("Still here")).toBeTruthy();
  });

  it("announces a remotely deleted selection and dismisses the notice", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: VIEWER,
      state: {
        collection: collection(2, []),
        appliedRevision: 2,
        notice: "selected_issue_deleted",
      },
    });
    expect(screen.getByText("This issue was deleted.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(harness.resetNotice).toHaveBeenCalled();
  });
});

describe("identity and auth-lookup states", () => {
  it("explains when the bundle has no review identity", () => {
    renderPanel({ currentUser: VIEWER, identityError: true });
    expect(screen.getByText("Issues aren't available for this dataset.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Active" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New issue" })).toBeNull();
  });

  it("surfaces an auth lookup failure with a retry while keeping issues readable", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: null,
      authError: true,
      state: {
        collection: collection(1, [makeIssue({ id: "i1", pinNumber: 1, body: "Visible" })]),
        appliedRevision: 1,
      },
    });
    expect(screen.getByText("We couldn't verify your account.")).toBeTruthy();
    expect(screen.getByText("Visible")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(harness.callbacks.onRetryAuth).toHaveBeenCalled();
  });
});

describe("placement capture", () => {
  it("starts placement from the new issue button", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: MEMBER,
      state: { collection: collection(1, []), appliedRevision: 1 },
    });
    await user.click(screen.getByRole("button", { name: "New issue" }));
    expect(harness.callbacks.onBeginPlacement).toHaveBeenCalled();
  });

  it("shows the placement hint and cancels placement", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: MEMBER,
      state: { collection: collection(1, []), appliedRevision: 1, placementActive: true },
    });
    expect(screen.getByText("Click the map to place the pin")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New issue" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel placement" }));
    expect(harness.callbacks.onCancelPlacement).toHaveBeenCalled();
  });

  it("invites a signed-out user to sign in instead of placing", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: null,
      state: { collection: collection(1, []), appliedRevision: 1 },
    });
    expect(screen.queryByRole("button", { name: "New issue" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sign in to create issues" }));
    expect(harness.callbacks.onRequestSignIn).toHaveBeenCalled();
  });
});

describe("IssueComposer", () => {
  const composerState = (draft: IssueDraft, patch: Partial<IssueState> = {}): Partial<IssueState> => ({
    collection: collection(1, []),
    appliedRevision: 1,
    draft,
    ...patch,
  });

  it("routes field changes through updateDraft", () => {
    const harness = renderPanel({
      currentUser: MEMBER,
      state: composerState(makeDraft()),
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Issue body" }), {
      target: { value: "Hello" },
    });
    expect(harness.ui.updateDraft).toHaveBeenCalledWith({ bodyMarkdown: "Hello" });

    fireEvent.change(screen.getByRole("combobox", { name: "Assignee" }), {
      target: { value: "3" },
    });
    expect(harness.ui.updateDraft).toHaveBeenCalledWith({ assigneeId: 3 });

    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-08-01" } });
    expect(harness.ui.updateDraft).toHaveBeenCalledWith({ dueDate: "2026-08-01" });
  });

  it("limits a viewer to unassigned or self and hides the due date", () => {
    renderPanel({
      currentUser: VIEWER,
      state: composerState(makeDraft()),
    });
    const select = screen.getByRole("combobox", { name: "Assignee" });
    const labels = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels).toEqual(["Unassigned", "viewer1"]);
    expect(screen.queryByLabelText("Due date")).toBeNull();
  });

  it("posts the draft through the controller-owned request ID with normalized fields", async () => {
    const user = userEvent.setup();
    const draft = makeDraft({
      bodyMarkdown: "Needs work\r\nASAP",
      assigneeId: 3,
      dueDate: "2026-08-01",
      anchor: { levelId: "level-1f", longitude: 139.7, latitude: 35.68, featureId: "f1" },
    });
    const harness = renderPanel({
      currentUser: MEMBER,
      state: composerState(draft),
    });
    await user.click(screen.getByRole("button", { name: "Post issue" }));
    expect(harness.commands.createIssue).toHaveBeenCalledWith({
      requestId: "req-1",
      bodyMarkdown: "Needs work\nASAP",
      anchor: { levelId: "level-1f", longitude: 139.7, latitude: 35.68, featureId: "f1" },
      assigneeId: 3,
      dueDate: "2026-08-01",
    });
  });

  it("removes the captured feature manually", async () => {
    const user = userEvent.setup();
    const draft = makeDraft({
      bodyMarkdown: "Body",
      anchor: { levelId: "level-1f", longitude: 139.7, latitude: 35.68, featureId: "f1" },
    });
    const harness = renderPanel({
      currentUser: MEMBER,
      state: composerState(draft),
    });
    expect(screen.getByText("f1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove feature" }));
    expect(harness.ui.updateDraft).toHaveBeenCalledWith({
      anchor: { levelId: "level-1f", longitude: 139.7, latitude: 35.68 },
    });
  });

  it("announces a server-removed stale feature and resubmits with the same request ID", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: MEMBER,
      state: composerState(makeDraft({ bodyMarkdown: "Still valid" }), {
        notice: "feature_attachment_removed",
      }),
    });
    expect(
      screen.getByText(
        "That feature is no longer in this version. The pin keeps its location — review and post again.",
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Post issue" }));
    expect(harness.commands.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-1",
        anchor: { levelId: "level-1f", longitude: 139.7, latitude: 35.68, featureId: null },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(harness.resetNotice).toHaveBeenCalled();
  });

  it("shows the scalar character count and disables posting over the limit", () => {
    const harness = renderPanel({
      currentUser: MEMBER,
      state: composerState(makeDraft({ bodyMarkdown: "Hello" })),
    });
    expect(screen.getByText("5/4000")).toBeTruthy();

    harness.update({ draft: makeDraft({ bodyMarkdown: "🙂".repeat(4001) }) });
    expect(screen.getByText("4001/4000")).toBeTruthy();
    expect(screen.getByText("Keep it under 4,000 characters.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Post issue" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables posting for an empty or whitespace-only body", () => {
    const harness = renderPanel({
      currentUser: MEMBER,
      state: composerState(makeDraft()),
    });
    expect(
      (screen.getByRole("button", { name: "Post issue" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    harness.update({ draft: makeDraft({ bodyMarkdown: "  \n\t " }) });
    expect(
      (screen.getByRole("button", { name: "Post issue" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("never blocks creation on the optional assignee or due date", () => {
    renderPanel({
      currentUser: MEMBER,
      state: composerState(makeDraft({ bodyMarkdown: "Body only" })),
    });
    expect(
      (screen.getByRole("button", { name: "Post issue" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("disables posting while a mutation is pending", () => {
    renderPanel({
      currentUser: MEMBER,
      state: composerState(makeDraft({ bodyMarkdown: "Body" }), { pendingMutations: 1 }),
    });
    expect(
      (screen.getByRole("button", { name: "Post issue" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps a signed-out draft and offers sign-in instead of posting", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: null,
      state: composerState(makeDraft({ bodyMarkdown: "Preserved" })),
    });
    expect(screen.getByRole("textbox", { name: "Issue body" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Post issue" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sign in to post" }));
    expect(harness.callbacks.onRequestSignIn).toHaveBeenCalled();
  });

  it("cancels the draft through the controller", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: MEMBER,
      state: composerState(makeDraft({ bodyMarkdown: "Draft" })),
    });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(harness.ui.cancelDraft).toHaveBeenCalled();
  });
});

describe("focus behavior", () => {
  it("moves focus into the composer after placement and back to new issue on cancel", async () => {
    const user = userEvent.setup();
    const harness = renderPanel({
      currentUser: MEMBER,
      state: { collection: collection(1, []), appliedRevision: 1 },
    });

    const newIssue = screen.getByRole("button", { name: "New issue" });
    await user.click(newIssue);
    expect(harness.callbacks.onBeginPlacement).toHaveBeenCalled();

    // App marks placement active, then a successful capture starts the draft.
    harness.update({ placementActive: true });
    harness.update({ placementActive: false, draft: makeDraft() });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Issue body" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(harness.ui.cancelDraft).toHaveBeenCalled();
    harness.update({ draft: null });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New issue" }));
  });
});

describe("detail navigation", () => {
  it("returns to the queue from the detail view", async () => {
    const user = userEvent.setup();
    const issue = makeIssue({ id: "i1", pinNumber: 1 });
    const harness = renderDetail(issue, VIEWER);
    await user.click(screen.getByRole("button", { name: "Back to issues" }));
    expect(harness.ui.selectIssue).toHaveBeenCalledWith(null);
  });

  it("deletes the root issue with its row version", async () => {
    const user = userEvent.setup();
    const issue = makeIssue({ id: "i1", pinNumber: 1, authorId: 1, rowVersion: 9 });
    const harness = renderDetail(issue, VIEWER);
    await user.click(screen.getByRole("button", { name: "Delete issue" }));
    expect(harness.commands.deleteIssue).toHaveBeenCalledWith("i1", 9);
  });

  it("keeps Reply as the only primary action while a detail is open", () => {
    const issue = makeIssue({ id: "i1", pinNumber: 1 });
    renderDetail(issue, MEMBER);
    expect(screen.queryByRole("button", { name: "New issue" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reply" })).toBeTruthy();
  });
});

describe("localized copy", () => {
  it("renders the queue in Japanese", () => {
    renderPanel({
      locale: "ja",
      currentUser: VIEWER,
      state: {
        collection: collection(1, [
          makeIssue({ id: "i1", pinNumber: 1, body: "改札が塞がれている" }),
        ]),
        appliedRevision: 1,
      },
    });
    expect(screen.getByRole("button", { name: "進行中" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "自分に割り当て" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "未割り当て" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "クローズ" })).toBeTruthy();
    expect(screen.getByText("1 件の進行中")).toBeTruthy();
    expect(screen.getByText("改札が塞がれている")).toBeTruthy();
  });
});
