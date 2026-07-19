import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  IssueApiError,
  issueApi,
  type IssueApiClient,
} from "./api";
import { initialIssueState, issueReducer } from "./issueReducer";
import type {
  CreateIssueInput,
  CreateReplyInput,
  IssueAnchor,
  IssueDraftPatch,
  IssueFilter,
  IssueMutationResponse,
  IssuePatch,
  IssueState,
  IssueSyncFailure,
  ReplyBodyPatch,
} from "./types";

export interface IssueActor {
  id: number;
  username: string;
  role: "viewer" | "member" | "admin";
}

export interface IssueCommands {
  createIssue(input: CreateIssueInput): Promise<void>;
  createReply(issueId: string, input: CreateReplyInput): Promise<void>;
  patchIssue(issueId: string, patch: IssuePatch): Promise<void>;
  patchReply(replyId: string, patch: ReplyBodyPatch): Promise<void>;
  deleteIssue(issueId: string, expectedVersion: number): Promise<void>;
  deleteReply(replyId: string, expectedVersion: number): Promise<void>;
}

export interface IssueUiActions {
  setFilter(filter: IssueFilter): void;
  selectIssue(issueId: string | null): void;
  startDraft(anchor: IssueAnchor): void;
  updateDraft(patch: IssueDraftPatch): void;
  cancelDraft(): void;
  setPlacement(active: boolean): void;
}

export interface IssueController {
  state: IssueState;
  commands: IssueCommands;
  ui: IssueUiActions;
  retryCollection(): void;
  resetNotice(): void;
}

export interface IssueEventSource {
  addEventListener(type: string, listener: EventListener): void;
  close(): void;
}

export interface IssueSyncOptions {
  api?: IssueApiClient;
  createEventSource?: (url: string) => IssueEventSource;
  randomUUID?: () => string;
}

interface ActiveFetch {
  generation: number;
  publicVersionId: string;
  controller: AbortController;
}

const createNativeEventSource = (url: string): IssueEventSource => new EventSource(url);
const createUuid = (): string => crypto.randomUUID();

function syncFailure(error: unknown): IssueSyncFailure {
  if (error instanceof IssueApiError) {
    return {
      kind: "api",
      status: error.status,
      error: error.error,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error.current === undefined ? {} : { current: error.current }),
      ...(error.revision === undefined ? {} : { revision: error.revision }),
    };
  }
  return {
    kind: "network",
    message: error instanceof Error ? error.message : "The issue request failed.",
  };
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export function useIssueSync(
  publicVersionId: string | null,
  options: IssueSyncOptions = {},
): IssueController {
  const client = options.api ?? issueApi;
  const createEventSource = options.createEventSource ?? createNativeEventSource;
  const randomUUID = options.randomUUID ?? createUuid;
  const [state, dispatch] = useReducer(issueReducer, publicVersionId, initialIssueState);

  // Render-phase identity gate: an A→B or A→null transition must never expose
  // the previous version's collection, selection, draft, or revisions to a
  // consumer render. React reprocesses this dispatch before children render;
  // effects below still own network cleanup/setup for the new identity.
  if (state.publicVersionId !== publicVersionId) {
    dispatch({ type: "version_reset", publicVersionId });
  }
  const stateRef = useRef(state);
  const publicIdRef = useRef(publicVersionId);
  const generationRef = useRef(0);
  const activeFetchRef = useRef<ActiveFetch | null>(null);
  const draftRequestIdRef = useRef<string | null>(null);
  const clientRef = useRef(client);
  const createEventSourceRef = useRef(createEventSource);
  const randomUUIDRef = useRef(randomUUID);

  stateRef.current = state;
  publicIdRef.current = publicVersionId;
  clientRef.current = client;
  createEventSourceRef.current = createEventSource;
  randomUUIDRef.current = randomUUID;
  if (state.draft === null && state.draftAdmissionResourceId === null) {
    draftRequestIdRef.current = null;
  } else if (state.draft !== null) {
    draftRequestIdRef.current = state.draft.requestId;
  }

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    draftRequestIdRef.current = null;
    dispatch({ type: "version_reset", publicVersionId });

    if (publicVersionId === null) {
      return () => {
        if (generationRef.current === generation) {
          generationRef.current += 1;
        }
      };
    }

    const source = createEventSourceRef.current(
      clientRef.current.issueEventUrl(publicVersionId),
    );
    const isCurrent = () => generationRef.current === generation
      && publicIdRef.current === publicVersionId;
    const onOpen: EventListener = () => {
      if (isCurrent()) {
        dispatch({ type: "stream_opened" });
      }
    };
    const onError: EventListener = () => {
      if (isCurrent()) {
        dispatch({ type: "stream_failed" });
      }
    };
    const onRevision: EventListener = (event) => {
      if (!isCurrent()) {
        return;
      }
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as { revision?: unknown };
        if (Number.isInteger(data.revision) && (data.revision as number) >= 0) {
          dispatch({ type: "revision_observed", revision: data.revision as number });
        }
      } catch {
        // A malformed invalidation cannot alter canonical state. A later valid
        // event or reconnect snapshot still repairs the collection.
      }
    };
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    source.addEventListener("revision", onRevision);

    return () => {
      if (generationRef.current === generation) {
        generationRef.current += 1;
      }
      source.close();
      const active = activeFetchRef.current;
      if (active?.generation === generation && active.publicVersionId === publicVersionId) {
        active.controller.abort();
        activeFetchRef.current = null;
      }
    };
  }, [publicVersionId]);

  useEffect(() => {
    if (
      publicVersionId === null
      || state.publicVersionId !== publicVersionId
      || !state.refetchRequested
      || state.refetchInFlight
      || activeFetchRef.current !== null
    ) {
      return;
    }

    const generation = generationRef.current;
    const controller = new AbortController();
    const active: ActiveFetch = { generation, publicVersionId, controller };
    activeFetchRef.current = active;
    dispatch({ type: "collection_fetch_started" });

    void clientRef.current.getIssues(publicVersionId, controller.signal).then(
      (collection) => {
        if (activeFetchRef.current === active) {
          activeFetchRef.current = null;
        }
        if (
          generationRef.current === generation
          && publicIdRef.current === publicVersionId
        ) {
          dispatch({ type: "collection_fetch_succeeded", collection });
        }
      },
      (error: unknown) => {
        if (activeFetchRef.current === active) {
          activeFetchRef.current = null;
        }
        if (
          !isAbort(error, controller.signal)
          && generationRef.current === generation
          && publicIdRef.current === publicVersionId
        ) {
          dispatch({ type: "collection_fetch_failed", failure: syncFailure(error) });
        }
      },
    );
  }, [publicVersionId, state.publicVersionId, state.refetchInFlight, state.refetchRequested]);

  const runMutation = useCallback(async (
    operation: () => Promise<IssueMutationResponse>,
    draftRequestId?: string,
  ): Promise<void> => {
    const publicId = publicIdRef.current;
    if (publicId === null) {
      return;
    }
    const generation = generationRef.current;
    dispatch({ type: "mutation_started" });
    try {
      const response = await operation();
      if (generationRef.current === generation && publicIdRef.current === publicId) {
        dispatch({
          type: "mutation_succeeded",
          response,
          ...(draftRequestId === undefined ? {} : { draftRequestId }),
        });
      }
    } catch (error: unknown) {
      if (generationRef.current === generation && publicIdRef.current === publicId) {
        dispatch({
          type: "mutation_failed",
          failure: syncFailure(error),
          ...(draftRequestId === undefined ? {} : { draftRequestId }),
        });
      }
    }
  }, []);

  const createIssue = useCallback(async (input: CreateIssueInput): Promise<void> => {
    const publicId = publicIdRef.current;
    if (publicId === null) {
      return;
    }
    const draftRequestId = stateRef.current.draft?.requestId;
    const requestId = draftRequestId ?? input.requestId;
    await runMutation(
      () => clientRef.current.createIssue(publicId, { ...input, requestId }),
      draftRequestId,
    );
  }, [runMutation]);

  const createReply = useCallback(async (
    issueId: string,
    input: CreateReplyInput,
  ): Promise<void> => {
    await runMutation(() => clientRef.current.createReply(issueId, input));
  }, [runMutation]);

  const patchIssue = useCallback(async (issueId: string, patch: IssuePatch): Promise<void> => {
    await runMutation(() => clientRef.current.patchIssue(issueId, patch));
  }, [runMutation]);

  const patchReply = useCallback(async (replyId: string, patch: ReplyBodyPatch): Promise<void> => {
    await runMutation(() => clientRef.current.patchReply(replyId, patch));
  }, [runMutation]);

  const deleteIssue = useCallback(async (
    issueId: string,
    expectedVersion: number,
  ): Promise<void> => {
    await runMutation(() => clientRef.current.deleteIssue(issueId, expectedVersion));
  }, [runMutation]);

  const deleteReply = useCallback(async (
    replyId: string,
    expectedVersion: number,
  ): Promise<void> => {
    await runMutation(() => clientRef.current.deleteReply(replyId, expectedVersion));
  }, [runMutation]);

  const setFilter = useCallback((filter: IssueFilter): void => {
    if (publicIdRef.current !== null) {
      dispatch({ type: "filter_set", filter });
    }
  }, []);
  const selectIssue = useCallback((issueId: string | null): void => {
    if (publicIdRef.current !== null) {
      dispatch({ type: "issue_selected", issueId });
    }
  }, []);
  const startDraft = useCallback((anchor: IssueAnchor): void => {
    if (publicIdRef.current === null || draftRequestIdRef.current !== null) {
      return;
    }
    const requestId = randomUUIDRef.current();
    draftRequestIdRef.current = requestId;
    dispatch({ type: "draft_started", anchor, requestId });
  }, []);
  const updateDraft = useCallback((patch: IssueDraftPatch): void => {
    if (publicIdRef.current !== null) {
      dispatch({ type: "draft_updated", patch });
    }
  }, []);
  const cancelDraft = useCallback((): void => {
    if (publicIdRef.current !== null) {
      draftRequestIdRef.current = null;
      dispatch({ type: "draft_cancelled" });
    }
  }, []);
  const setPlacement = useCallback((active: boolean): void => {
    if (publicIdRef.current !== null) {
      dispatch({ type: "placement_set", active });
    }
  }, []);
  const retryCollection = useCallback((): void => {
    dispatch({ type: "collection_retry_requested" });
  }, []);
  const resetNotice = useCallback((): void => {
    dispatch({ type: "notice_reset" });
  }, []);

  const commands = useMemo<IssueCommands>(() => ({
    createIssue,
    createReply,
    patchIssue,
    patchReply,
    deleteIssue,
    deleteReply,
  }), [createIssue, createReply, deleteIssue, deleteReply, patchIssue, patchReply]);
  const ui = useMemo<IssueUiActions>(() => ({
    setFilter,
    selectIssue,
    startDraft,
    updateDraft,
    cancelDraft,
    setPlacement,
  }), [cancelDraft, selectIssue, setFilter, setPlacement, startDraft, updateDraft]);

  return useMemo(() => ({ state, commands, ui, retryCollection, resetNotice }), [
    commands,
    resetNotice,
    retryCollection,
    state,
    ui,
  ]);
}
