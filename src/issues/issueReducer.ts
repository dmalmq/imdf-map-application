import type {
  IssueAnchor,
  IssueCollection,
  IssueDraftPatch,
  IssueFilter,
  IssueMutationResponse,
  IssueState,
  IssueSyncFailure,
} from "./types";

export type IssueAction =
  | { type: "version_reset"; publicVersionId: string | null }
  | { type: "revision_observed"; revision: number }
  | { type: "collection_fetch_started" }
  | { type: "collection_fetch_succeeded"; collection: IssueCollection }
  | { type: "collection_fetch_failed"; failure: IssueSyncFailure }
  | { type: "collection_retry_requested" }
  | { type: "stream_opened" }
  | { type: "stream_failed" }
  | { type: "filter_set"; filter: IssueFilter }
  | { type: "issue_selected"; issueId: string | null }
  | { type: "draft_started"; anchor: IssueAnchor; requestId: string }
  | { type: "draft_updated"; patch: IssueDraftPatch }
  | { type: "draft_cancelled" }
  | { type: "placement_set"; active: boolean }
  | { type: "mutation_started" }
  | {
      type: "mutation_succeeded";
      response: IssueMutationResponse;
      draftRequestId?: string;
    }
  | { type: "mutation_failed"; failure: IssueSyncFailure; draftRequestId?: string }
  | { type: "notice_reset" };

export function initialIssueState(publicVersionId: string | null): IssueState {
  return {
    publicVersionId,
    collection: null,
    appliedRevision: 0,
    highestObservedRevision: 0,
    refetchInFlight: false,
    refetchRequested: publicVersionId !== null,
    filter: "active",
    selectedIssueId: null,
    draft: null,
    draftAdmissionResourceId: null,
    placementActive: false,
    pendingMutations: 0,
    conflict: null,
    error: null,
    errorScope: null,
    reconnecting: false,
    stale: false,
    authRequired: false,
    notice: null,
  };
}

function withObservedRevision(state: IssueState, revision: number): IssueState {
  const highestObservedRevision = Math.max(state.highestObservedRevision, revision);
  return {
    ...state,
    highestObservedRevision,
    refetchRequested:
      state.refetchRequested || highestObservedRevision > state.appliedRevision,
    stale: state.stale || (
      state.collection !== null && highestObservedRevision > state.appliedRevision
    ),
  };
}

function mutationFailure(
  state: IssueState,
  failure: IssueSyncFailure,
  draftRequestId?: string,
): IssueState {
  let next: IssueState = {
    ...state,
    pendingMutations: Math.max(0, state.pendingMutations - 1),
    error: failure,
    errorScope: "mutation",
  };

  if (failure.kind === "network") {
    return next;
  }

  if (failure.status === 401) {
    return { ...next, authRequired: true };
  }

  if (failure.status === 409) {
    next = {
      ...next,
      conflict: failure,
      refetchRequested: true,
    };
    if (failure.revision !== undefined) {
      next = withObservedRevision(next, failure.revision);
    }
    return next;
  }

  if (failure.status === 403) {
    next = { ...next, refetchRequested: true };
  }

  const rejectedFeature = failure.error === "invalid_anchor"
    && failure.details?.some(({ field }) => field === "anchor.featureId") === true;
  if (
    !rejectedFeature
    || next.draft === null
    || next.draft.requestId !== draftRequestId
    || next.draft.anchor.featureId === undefined
  ) {
    return next;
  }

  const { featureId: _featureId, ...anchor } = next.draft.anchor;
  return {
    ...next,
    draft: { ...next.draft, anchor },
    notice: "feature_attachment_removed",
  };
}

export function issueReducer(state: IssueState, action: IssueAction): IssueState {
  switch (action.type) {
    case "version_reset":
      return action.publicVersionId === state.publicVersionId
        ? state
        : initialIssueState(action.publicVersionId);
    case "revision_observed":
      return withObservedRevision(state, action.revision);
    case "collection_fetch_started":
      if (state.publicVersionId === null || state.refetchInFlight) {
        return state;
      }
      return {
        ...state,
        refetchInFlight: true,
        refetchRequested: false,
        error: state.errorScope === "collection" ? null : state.error,
        errorScope: state.errorScope === "collection" ? null : state.errorScope,
      };
    case "collection_fetch_succeeded": {
      const accepted = action.collection.revision >= state.appliedRevision;
      const collection = accepted ? action.collection : state.collection;
      const appliedRevision = accepted
        ? action.collection.revision
        : state.appliedRevision;
      const highestObservedRevision = Math.max(
        state.highestObservedRevision,
        action.collection.revision,
      );
      const stillBehind = highestObservedRevision > appliedRevision;
      let selectedIssueId = state.selectedIssueId;
      let notice = state.notice;
      if (accepted && selectedIssueId !== null) {
        const selected = action.collection.issues.find(({ id }) => id === selectedIssueId);
        if (selected === undefined || selected.deletedAt !== null) {
          selectedIssueId = null;
          notice = "selected_issue_deleted";
        }
      }
      const admitted = accepted
        && state.draftAdmissionResourceId !== null
        && action.collection.issues.some(({ id }) => id === state.draftAdmissionResourceId);
      return {
        ...state,
        collection,
        appliedRevision,
        highestObservedRevision,
        refetchInFlight: false,
        refetchRequested: stillBehind,
        selectedIssueId,
        draft: admitted ? null : state.draft,
        draftAdmissionResourceId: admitted ? null : state.draftAdmissionResourceId,
        error: state.errorScope === "collection" ? null : state.error,
        errorScope: state.errorScope === "collection" ? null : state.errorScope,
        stale: stillBehind,
        notice,
      };
    }
    case "collection_fetch_failed":
      return {
        ...state,
        refetchInFlight: false,
        refetchRequested: false,
        error: state.errorScope === "mutation" ? state.error : action.failure,
        errorScope: state.errorScope === "mutation" ? "mutation" : "collection",
        stale: state.collection !== null,
      };
    case "collection_retry_requested":
      return state.publicVersionId === null
        ? state
        : {
            ...state,
            refetchRequested: true,
            error: state.errorScope === "collection" ? null : state.error,
            errorScope: state.errorScope === "collection" ? null : state.errorScope,
          };
    case "stream_opened":
      return {
        ...state,
        reconnecting: false,
        stale: state.highestObservedRevision > state.appliedRevision,
      };
    case "stream_failed":
      return {
        ...state,
        reconnecting: true,
        stale: state.collection !== null,
      };
    case "filter_set":
      return { ...state, filter: action.filter };
    case "issue_selected":
      return { ...state, selectedIssueId: action.issueId };
    case "draft_started":
      if (state.draft !== null) {
        return state;
      }
      return {
        ...state,
        draft: {
          requestId: action.requestId,
          anchor: action.anchor,
          bodyMarkdown: "",
          assigneeId: null,
          dueDate: null,
        },
        draftAdmissionResourceId: null,
        notice: null,
      };
    case "draft_updated":
      return state.draft === null
        ? state
        : { ...state, draft: { ...state.draft, ...action.patch } };
    case "draft_cancelled":
      return {
        ...state,
        draft: null,
        draftAdmissionResourceId: null,
        placementActive: false,
        notice: null,
      };
    case "placement_set":
      return { ...state, placementActive: action.active };
    case "mutation_started":
      return {
        ...state,
        pendingMutations: state.pendingMutations + 1,
        error: state.errorScope === "mutation" ? null : state.error,
        errorScope: state.errorScope === "mutation" ? null : state.errorScope,
        conflict: null,
        authRequired: false,
      };
    case "mutation_succeeded": {
      const observed = withObservedRevision({
        ...state,
        pendingMutations: Math.max(0, state.pendingMutations - 1),
        error: state.error,
        errorScope: state.errorScope,
        conflict: state.conflict,
        authRequired: state.authRequired,
      }, action.response.revision);
      const admitsDraft = action.draftRequestId !== undefined
        && state.draft?.requestId === action.draftRequestId;
      const alreadyCanonical = admitsDraft
        && state.collection?.issues.some(({ id }) => id === action.response.resourceId) === true;
      return {
        ...observed,
        draft: alreadyCanonical ? null : state.draft,
        draftAdmissionResourceId: alreadyCanonical
          ? null
          : admitsDraft
            ? action.response.resourceId
            : state.draftAdmissionResourceId,
      };
    }
    case "mutation_failed":
      return mutationFailure(state, action.failure, action.draftRequestId);
    case "notice_reset":
      return { ...state, notice: null };
  }
}
