import { describe, expect, it } from "vitest";
import { ArchiveError } from "../errors/ArchiveError";
import type { LoadedVenue, ViewerFeature, ViewerLevel } from "../imdf/types";
import {
  initialViewerState,
  matchLevelId,
  pickInitialLevelId,
  viewerReducer,
  type ReadyVenueState,
  type ViewerState,
} from "./viewerReducer";

function level(id: string, ordinal: number): ViewerLevel {
  return { id, ordinal, label: { en: id }, shortName: {} };
}

function venueFeature(): ViewerFeature {
  return {
    id: "a1000001-0000-4000-8000-000000000001",
    featureType: "venue",
    levelId: null,
    geometry: null,
    center: [139.7, 35.6],
    labels: { en: "Test Venue", ja: "テスト会場" },
    altLabels: {},
    category: null,
    accessibility: [],
    restriction: null,
    sourceProperties: {},
  };
}

function makeVenue(levels: ViewerLevel[]): LoadedVenue {
  return {
    manifest: { version: "1.0.0", language: "ja-JP" },
    venue: venueFeature(),
    levels,
    featuresById: new Map(),
    renderFeaturesByLevel: new Map(),
    searchEntries: [],
    boundsByLevel: new Map(),
    warnings: [],
  };
}

const levels1F = [
  level("b1000003-0000-4000-8000-00000000002f", 1),
  level("b1000002-0000-4000-8000-00000000001f", 0),
  level("b1000001-0000-4000-8000-0000000000b1", -1),
];

function readyState(
  fileName = "venue.zip",
  levels: ViewerLevel[] = levels1F,
  overrides: Partial<ReadyVenueState> = {},
): ViewerState {
  const loadedVenue = makeVenue(levels);
  return {
    status: "ready",
    locale: "ja",
    fileName,
    loadedVenue,
    selectedLevelId: pickInitialLevelId(levels),
    selectedFeatureId: null,
    searchText: "",
    searchCategory: "all",
    ...overrides,
  };
}

describe("initialViewerState", () => {
  it("starts empty with ja locale", () => {
    expect(initialViewerState).toEqual({
      status: "empty",
      locale: "ja",
    });
  });
});

describe("pickInitialLevelId", () => {
  it("selects ordinal 0 when present", () => {
    expect(pickInitialLevelId(levels1F)).toBe("b1000002-0000-4000-8000-00000000001f");
  });

  it("selects closest-to-zero, higher ordinal on absolute-value tie", () => {
    // Input sorted descending ordinal (normalizeVenue contract).
    expect(pickInitialLevelId([level("pos1", 1), level("neg2", -2)])).toBe("pos1");
    expect(pickInitialLevelId([level("pos1", 1), level("neg1", -1)])).toBe("pos1");
    // [3, -3]: |3| == |-3| → higher ordinal 3 wins (first minimal |ordinal| when sorted desc).
    expect(pickInitialLevelId([level("pos3", 3), level("neg3", -3)])).toBe("pos3");
  });

  it("throws when there are no levels", () => {
    expect(() => pickInitialLevelId([])).toThrow(/no levels/i);
  });
});

describe("matchLevelId", () => {
  const shortNamed: ViewerLevel[] = [
    { id: "lvl-2f", ordinal: 1, label: { ja: "2階", en: "Level 2" }, shortName: { ja: "2F", en: "2F" } },
    { id: "lvl-1f", ordinal: 0, label: { ja: "1階", en: "Level 1" }, shortName: { ja: "1F", en: "1F" } },
    { id: "lvl-b1", ordinal: -1, label: { ja: "地下1階", en: "Basement 1" }, shortName: { en: "B1" } },
  ];

  it("matches a level id", () => {
    expect(matchLevelId(shortNamed, "lvl-1f")).toBe("lvl-1f");
  });

  it("matches short_name across locales case-insensitively", () => {
    expect(matchLevelId(shortNamed, "b1")).toBe("lvl-b1");
    expect(matchLevelId(shortNamed, "2f")).toBe("lvl-2f");
  });

  it("folds full-width characters via NFKC", () => {
    expect(matchLevelId(shortNamed, "\uFF11\uFF26")).toBe("lvl-1f");
  });

  it("falls back to name labels", () => {
    expect(matchLevelId(shortNamed, "basement 1")).toBe("lvl-b1");
    expect(matchLevelId(shortNamed, "地下1階")).toBe("lvl-b1");
  });

  it("returns null when nothing matches", () => {
    expect(matchLevelId(shortNamed, "5f")).toBeNull();
    expect(matchLevelId([], "1f")).toBeNull();
  });

  it("prefers an id match over a short_name collision", () => {
    const colliding: ViewerLevel[] = [
      { id: "b1", ordinal: 2, label: {}, shortName: {} },
      { id: "other", ordinal: -1, label: {}, shortName: { en: "B1" } },
    ];
    expect(matchLevelId(colliding, "B1")).toBe("b1");
  });

  it("never interprets a bare number as an ordinal", () => {
    // "1" is nobody's id/short_name/name here; ordinal 1 exists but must not match.
    expect(matchLevelId(shortNamed, "1")).toBeNull();
  });
});

describe("viewerReducer load lifecycle", () => {
  it("load_started from empty has no previous", () => {
    const next = viewerReducer(initialViewerState, {
      type: "load_started",
      fileName: "a.zip",
    });
    expect(next).toEqual({
      status: "loading",
      fileName: "a.zip",
      locale: "ja",
    });
    expect("previous" in next && next.previous !== undefined).toBe(false);
  });

  it("load_started from ready captures previous", () => {
    const ready = readyState("old.zip");
    const next = viewerReducer(ready, { type: "load_started", fileName: "new.zip" });
    expect(next.status).toBe("loading");
    if (next.status !== "loading") return;
    expect(next.fileName).toBe("new.zip");
    expect(next.previous).toBeDefined();
    expect(next.previous?.fileName).toBe("old.zip");
    expect(next.previous?.loadedVenue).toBe(
      ready.status === "ready" ? ready.loadedVenue : undefined,
    );
  });

  it("load_succeeded from loading selects initial level ordinal 0", () => {
    const loading = viewerReducer(initialViewerState, {
      type: "load_started",
      fileName: "a.zip",
    });
    const venue = makeVenue(levels1F);
    const next = viewerReducer(loading, {
      type: "load_succeeded",
      fileName: "a.zip",
      venue,
    });
    expect(next.status).toBe("ready");
    if (next.status !== "ready") return;
    expect(next.fileName).toBe("a.zip");
    expect(next.loadedVenue).toBe(venue);
    expect(next.selectedLevelId).toBe("b1000002-0000-4000-8000-00000000001f");
    expect(next.selectedFeatureId).toBeNull();
    expect(next.searchText).toBe("");
    expect(next.searchCategory).toBe("all");
  });

  it("load_succeeded picks closest-to-zero with higher-ordinal tiebreak", () => {
    const loading = viewerReducer(initialViewerState, {
      type: "load_started",
      fileName: "a.zip",
    });
    const venue = makeVenue([level("hi", 3), level("lo", -3)]);
    const next = viewerReducer(loading, {
      type: "load_succeeded",
      fileName: "a.zip",
      venue,
    });
    expect(next.status).toBe("ready");
    if (next.status !== "ready") return;
    expect(next.selectedLevelId).toBe("hi");
  });

  it("load_succeeded with a matching requestedLevel selects it", () => {
    const loading = viewerReducer(initialViewerState, {
      type: "load_started",
      fileName: "a.zip",
    });
    const venue = makeVenue(levels1F);
    const next = viewerReducer(loading, {
      type: "load_succeeded",
      fileName: "a.zip",
      venue,
      requestedLevel: "b1000001-0000-4000-8000-0000000000b1",
    });
    expect(next.status).toBe("ready");
    if (next.status !== "ready") return;
    expect(next.selectedLevelId).toBe("b1000001-0000-4000-8000-0000000000b1");
  });

  it("load_succeeded with an unknown requestedLevel falls back to the default level", () => {
    const loading = viewerReducer(initialViewerState, {
      type: "load_started",
      fileName: "a.zip",
    });
    const venue = makeVenue(levels1F);
    const next = viewerReducer(loading, {
      type: "load_succeeded",
      fileName: "a.zip",
      venue,
      requestedLevel: "nonexistent",
    });
    expect(next.status).toBe("ready");
    if (next.status !== "ready") return;
    expect(next.selectedLevelId).toBe(pickInitialLevelId(levels1F));
  });
});

describe("viewerReducer stale suppression", () => {
  it("ignores load_succeeded when fileName mismatches", () => {
    const loading = viewerReducer(initialViewerState, {
      type: "load_started",
      fileName: "current.zip",
    });
    const next = viewerReducer(loading, {
      type: "load_succeeded",
      fileName: "stale.zip",
      venue: makeVenue(levels1F),
    });
    expect(next).toBe(loading);
  });

  it("ignores load_succeeded when not in loading status", () => {
    const ready = readyState();
    const venue = makeVenue(levels1F);
    expect(
      viewerReducer(ready, { type: "load_succeeded", fileName: "venue.zip", venue }),
    ).toBe(ready);
    expect(
      viewerReducer(initialViewerState, {
        type: "load_succeeded",
        fileName: "x.zip",
        venue,
      }),
    ).toBe(initialViewerState);
    const failed: ViewerState = {
      status: "error",
      error: new ArchiveError("invalid_archive", "bad"),
      locale: "ja",
    };
    expect(
      viewerReducer(failed, { type: "load_succeeded", fileName: "x.zip", venue }),
    ).toBe(failed);
  });

  it("ignores load_failed when fileName mismatches or not loading", () => {
    const loading = viewerReducer(initialViewerState, {
      type: "load_started",
      fileName: "current.zip",
    });
    const error = new ArchiveError("invalid_archive", "bad");
    expect(
      viewerReducer(loading, { type: "load_failed", fileName: "stale.zip", error }),
    ).toBe(loading);
    expect(
      viewerReducer(readyState(), { type: "load_failed", fileName: "venue.zip", error }),
    ).toEqual(readyState());
  });
});

describe("viewerReducer replacement / valid-map preservation", () => {
  it("ready → load_started keeps previous → load_failed yields error with previous intact", () => {
    const ready = readyState("good.zip");
    const loading = viewerReducer(ready, { type: "load_started", fileName: "bad.zip" });
    expect(loading.status).toBe("loading");
    if (loading.status !== "loading") return;
    expect(loading.previous?.fileName).toBe("good.zip");

    const error = new ArchiveError("invalid_json", "broken");
    const failed = viewerReducer(loading, {
      type: "load_failed",
      fileName: "bad.zip",
      error,
    });
    expect(failed.status).toBe("error");
    if (failed.status !== "error") return;
    expect(failed.error).toBe(error);
    expect(failed.previous).toBeDefined();
    expect(failed.previous?.fileName).toBe("good.zip");
    expect(failed.previous?.loadedVenue).toBe(
      ready.status === "ready" ? ready.loadedVenue : undefined,
    );
  });

  it("subsequent load_started from error still carries previous", () => {
    const ready = readyState("good.zip");
    const loading = viewerReducer(ready, { type: "load_started", fileName: "bad.zip" });
    const failed = viewerReducer(loading, {
      type: "load_failed",
      fileName: "bad.zip",
      error: new ArchiveError("invalid_archive", "nope"),
    });
    const again = viewerReducer(failed, { type: "load_started", fileName: "retry.zip" });
    expect(again.status).toBe("loading");
    if (again.status !== "loading") return;
    expect(again.fileName).toBe("retry.zip");
    expect(again.previous?.fileName).toBe("good.zip");
  });

  it("load_failed from empty loading has no previous", () => {
    const loading = viewerReducer(initialViewerState, {
      type: "load_started",
      fileName: "a.zip",
    });
    const error = new ArchiveError("unsupported_file", "nope");
    const failed = viewerReducer(loading, {
      type: "load_failed",
      fileName: "a.zip",
      error,
    });
    expect(failed).toEqual({
      status: "error",
      error,
      locale: "ja",
    });
  });
});

describe("viewerReducer select_feature / select_level", () => {
  it("select_feature with valid levelId switches level and keeps feature", () => {
    const ready = readyState();
    const level2 = "b1000003-0000-4000-8000-00000000002f";
    const next = viewerReducer(ready, {
      type: "select_feature",
      featureId: "feat-1",
      levelId: level2,
    });
    expect(next.status).toBe("ready");
    if (next.status !== "ready") return;
    expect(next.selectedFeatureId).toBe("feat-1");
    expect(next.selectedLevelId).toBe(level2);
  });

  it("select_feature with omitted levelId retains current level", () => {
    const ready = readyState();
    if (ready.status !== "ready") return;
    const current = ready.selectedLevelId;
    const next = viewerReducer(ready, { type: "select_feature", featureId: "feat-2" });
    expect(next.status).toBe("ready");
    if (next.status !== "ready") return;
    expect(next.selectedFeatureId).toBe("feat-2");
    expect(next.selectedLevelId).toBe(current);
  });

  it("select_feature with unknown levelId retains current level", () => {
    const ready = readyState();
    if (ready.status !== "ready") return;
    const current = ready.selectedLevelId;
    const next = viewerReducer(ready, {
      type: "select_feature",
      featureId: "feat-3",
      levelId: "does-not-exist",
    });
    expect(next.status).toBe("ready");
    if (next.status !== "ready") return;
    expect(next.selectedFeatureId).toBe("feat-3");
    expect(next.selectedLevelId).toBe(current);
  });

  it("select_feature is a no-op outside ready", () => {
    expect(
      viewerReducer(initialViewerState, { type: "select_feature", featureId: "x" }),
    ).toBe(initialViewerState);
  });

  it("select_level clears selectedFeatureId", () => {
    const ready = readyState("venue.zip", levels1F, {
      selectedFeatureId: "feat-sel",
      selectedLevelId: "b1000002-0000-4000-8000-00000000001f",
    });
    const next = viewerReducer(ready, {
      type: "select_level",
      levelId: "b1000001-0000-4000-8000-0000000000b1",
    });
    expect(next.status).toBe("ready");
    if (next.status !== "ready") return;
    expect(next.selectedLevelId).toBe("b1000001-0000-4000-8000-0000000000b1");
    expect(next.selectedFeatureId).toBeNull();
  });

  it("select_level rejects unknown ids", () => {
    const ready = readyState("venue.zip", levels1F, {
      selectedFeatureId: "feat-sel",
    });
    const next = viewerReducer(ready, { type: "select_level", levelId: "unknown" });
    expect(next).toBe(ready);
  });
});

describe("viewerReducer set_locale", () => {
  it("works in every status", () => {
    const statuses: ViewerState[] = [
      initialViewerState,
      viewerReducer(initialViewerState, { type: "load_started", fileName: "a.zip" }),
      readyState(),
      {
        status: "error",
        error: new ArchiveError("worker_failed", "x"),
        locale: "ja",
      },
    ];

    for (const state of statuses) {
      const localized = viewerReducer(state, { type: "set_locale", locale: "en" });
      expect(localized.locale).toBe("en");
      expect(localized.status).toBe(state.status);
    }
  });
});

describe("viewerReducer search fields", () => {
  it("set_search_text and set_search_category only apply in ready", () => {
    const ready = readyState();
    const withText = viewerReducer(ready, { type: "set_search_text", text: "cafe" });
    expect(withText.status).toBe("ready");
    if (withText.status !== "ready") return;
    expect(withText.searchText).toBe("cafe");

    const withCat = viewerReducer(withText, {
      type: "set_search_category",
      category: "shops",
    });
    expect(withCat.status).toBe("ready");
    if (withCat.status !== "ready") return;
    expect(withCat.searchCategory).toBe("shops");

    expect(
      viewerReducer(initialViewerState, { type: "set_search_text", text: "x" }),
    ).toBe(initialViewerState);
    expect(
      viewerReducer(initialViewerState, {
        type: "set_search_category",
        category: "gates",
      }),
    ).toBe(initialViewerState);
  });
});
