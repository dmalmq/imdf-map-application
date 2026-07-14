import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndoorMapProps } from "../map/IndoorMap";
import type * as FetchImdfArchiveModule from "../imdf/fetchImdfArchive";
import type {
  LoadedVenue,
  SearchEntry,
  ViewerFeature,
  ViewerLevel,
  ViewerWarning,
} from "../imdf/types";
import { ArchiveError, archiveErrorCopy } from "../errors/ArchiveError";
import { themes } from "../theme/presets";

const LEVEL_2F: ViewerLevel = {
  id: "b1000003-0000-4000-8000-00000000002f",
  sourceLevelIds: ["b1000003-0000-4000-8000-00000000002f"],
  ordinal: 1,
  label: { ja: "2F", en: "2F" },
  shortName: { ja: "2F", en: "2F" },
};

const LEVEL_1F: ViewerLevel = {
  id: "b1000002-0000-4000-8000-00000000001f",
  sourceLevelIds: ["b1000002-0000-4000-8000-00000000001f"],
  ordinal: 0,
  label: { ja: "1F", en: "1F" },
  shortName: { ja: "1F", en: "1F" },
};

const LEVELS: ViewerLevel[] = [LEVEL_2F, LEVEL_1F];

const VENUE_FEATURE: ViewerFeature = {
  id: "a1000001-0000-4000-8000-000000000001",
  featureType: "venue",
  levelId: null,
  geometry: null,
  center: [139.767, 35.681],
  labels: { ja: "テスト駅", en: "Test Station" },
  altLabels: {},
  category: null,
  accessibility: [],
  restriction: null,
  sourceProperties: {},
};

const SHOP_FEATURE: ViewerFeature = {
  id: "a1000008-0000-4000-8000-0000000000c1",
  featureType: "occupant",
  levelId: LEVEL_1F.id,
  geometry: { type: "Point", coordinates: [139.7671, 35.6811] },
  center: [139.7671, 35.6811],
  labels: { ja: "駅ナカショップ", en: "Station Shop" },
  altLabels: { ja: "テストストア", en: "Test Store" },
  category: "shopping",
  accessibility: [],
  restriction: null,
  sourceProperties: { hours: "Mo-Fr 10:00-20:00" },
};

const NULL_LEVEL_AMENITY: ViewerFeature = {
  id: "e1000001-0000-4000-8000-0000000000a1",
  featureType: "amenity",
  levelId: null,
  geometry: { type: "Point", coordinates: [139.7672, 35.6812] },
  center: [139.7672, 35.6812],
  labels: { ja: "トイレ", en: "Restroom" },
  altLabels: {},
  category: "restroom",
  accessibility: ["wheelchair"],
  restriction: null,
  sourceProperties: {},
};

const NULL_CENTER_FEATURE: ViewerFeature = {
  id: "a1000009-0000-4000-8000-0000000000c2",
  featureType: "occupant",
  levelId: null,
  geometry: null,
  center: null,
  labels: { en: "Dangling Shop" },
  altLabels: {},
  category: "shopping",
  accessibility: [],
  restriction: null,
  sourceProperties: {},
};

function entryFor(feature: ViewerFeature): SearchEntry {
  const labels = Object.values(feature.labels);
  const altLabels = Object.values(feature.altLabels);
  return {
    featureId: feature.id,
    featureType: feature.featureType,
    levelId: feature.levelId,
    category: feature.category,
    labels: feature.labels,
    altLabels: feature.altLabels,
    normalizedLabels: labels.map((value) => value.normalize("NFKC").toLowerCase().trim()),
    normalizedAltLabels: altLabels.map((value) => value.normalize("NFKC").toLowerCase().trim()),
    normalizedCategory: (feature.category ?? "").normalize("NFKC").toLowerCase().trim(),
  };
}

const WARNINGS: ViewerWarning[] = [
  {
    code: "missing_locale",
    message: "Feature lacks English label",
    featureId: "c1000002-0000-4000-8000-0000000000b2",
  },
];

function buildMinimalVenue(overrides?: Partial<LoadedVenue>): LoadedVenue {
  const featuresById = new Map<string, ViewerFeature>([
    [VENUE_FEATURE.id, VENUE_FEATURE],
    [SHOP_FEATURE.id, SHOP_FEATURE],
    [NULL_LEVEL_AMENITY.id, NULL_LEVEL_AMENITY],
    [NULL_CENTER_FEATURE.id, NULL_CENTER_FEATURE],
  ]);
  const emptyCollection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  return {
    manifest: { version: "1.0.0", language: "ja-JP" },
    venue: VENUE_FEATURE,
    levels: LEVELS,
    featuresById,
    renderFeaturesByLevel: new Map([
      [LEVEL_1F.id, emptyCollection],
      [LEVEL_2F.id, emptyCollection],
    ]),
    searchEntries: [entryFor(SHOP_FEATURE), entryFor(NULL_LEVEL_AMENITY), entryFor(NULL_CENTER_FEATURE)],
    boundsByLevel: new Map([
      [LEVEL_1F.id, [139.766, 35.68, 139.768, 35.682]],
      [LEVEL_2F.id, [139.766, 35.68, 139.768, 35.682]],
    ]),
    enrichmentByFeatureId: new Map(),
    warnings: WARNINGS,
    ...overrides,
  };
}

const loadImdfArchiveMock = vi.fn();

vi.mock("../imdf/loadImdfArchive", () => ({
  loadImdfArchive: (...args: unknown[]) => loadImdfArchiveMock(...args),
}));

const fetchImdfFileMock = vi.fn();

vi.mock("../imdf/fetchImdfArchive", async (importOriginal) => {
  const actual = await importOriginal<typeof FetchImdfArchiveModule>();
  return {
    fileNameFromSrc: actual.fileNameFromSrc,
    fetchImdfFile: (...args: unknown[]) => fetchImdfFileMock(...args),
  };
});

vi.mock("../map/IndoorMap", () => ({
  IndoorMap: function IndoorMapStub(props: IndoorMapProps) {
    const identityRef = useRef({ n: 1 });
    return (
      <div
        data-testid="indoor-map-stub"
        data-level-id={props.levelId}
        data-selected-feature-id={props.selectedFeatureId ?? ""}
        data-locale={props.locale}
        data-theme-id={props.theme.id}
        data-search-category={props.searchCategory}
        data-compact={String(props.compact)}
        data-bottom-padding={String(props.bottomPadding)}
        data-identity={identityRef.current.n}
      >
        <button
          type="button"
          onClick={() => {
            props.onSelectFeature(SHOP_FEATURE.id);
          }}
        >
          Select shop from map
        </button>
        <button
          type="button"
          onClick={() => {
            props.onSelectFeature(null);
          }}
        >
          Clear map selection
        </button>
      </div>
    );
  },
}));

// Import after mocks so App sees the stubs.
import { App } from "./App";

function zipFile(name = "venue.zip"): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, {
    type: "application/zip",
  });
}

async function uploadViaHiddenInput(file: File): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).toBeTruthy();
  await userEvent.upload(input!, file);
}

describe("App", () => {
  beforeEach(() => {
    loadImdfArchiveMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reaches the Open IMDF ZIP control by Tab and triggers the hidden file input click", async () => {
    const user = userEvent.setup();
    render(<App />);

    const openButtons = screen.getAllByRole("button", { name: "IMDF ZIP を開く" });
    const openBtn = openButtons[0]!;
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const clickSpy = vi.spyOn(fileInput!, "click");

    openBtn.focus();
    expect(document.activeElement).toBe(openBtn);

    await user.keyboard("{Enter}");
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("announces loading then ready via aria-live and shows the venue", async () => {
    const venue = buildMinimalVenue();
    const user = userEvent.setup();
    let resolveLoad: ((value: LoadedVenue) => void) | undefined;
    loadImdfArchiveMock.mockImplementation(
      () =>
        new Promise<LoadedVenue>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    render(<App />);
    const live = document.querySelector("[aria-live='polite']");
    expect(live).toBeTruthy();
    expect(live?.textContent).toContain("会場が未読み込みです");

    await uploadViaHiddenInput(zipFile("demo.zip"));

    await waitFor(() => {
      expect(live?.textContent).toContain("読み込み中");
      expect(live?.textContent).toContain("demo.zip");
    });

    resolveLoad?.(venue);

    await waitFor(() => {
      expect(live?.textContent).toContain("会場を読み込みました");
      expect(live?.textContent).toContain("demo.zip");
    });
    expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    expect(document.querySelector(".top-bar")).toBeNull();
    expect(document.querySelector(".explorer-sidebar")).toBeNull();
    expect(screen.getByRole("combobox", { name: "検索" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "メニュー" })).toBeTruthy();
    expect(screen.queryByText("警告")).toBeNull();
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    expect(screen.getByText("テスト駅")).toBeTruthy();
  });

  it("shows archiveErrorCopy in role=alert and keeps the previous venue when replacement fails", async () => {
    const venue = buildMinimalVenue();
    const user = userEvent.setup();
    loadImdfArchiveMock.mockResolvedValueOnce(venue);

    render(<App />);
    await uploadViaHiddenInput(zipFile("good.zip"));
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });
    const mapBefore = screen.getByTestId("indoor-map-stub");

    const failure = new ArchiveError("invalid_archive", "bad zip");
    loadImdfArchiveMock.mockRejectedValueOnce(failure);

    await uploadViaHiddenInput(zipFile("bad.zip"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(archiveErrorCopy.invalid_archive);
    // Previous venue remains available in the menu.
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    expect(screen.getByText("テスト駅")).toBeTruthy();
    // Map still present (previous venue retained).
    expect(screen.getByTestId("indoor-map-stub")).toBe(mapBefore);
  });

  it("filters search results and retains level for null-level selections", async () => {
    const venue = buildMinimalVenue();
    loadImdfArchiveMock.mockResolvedValue(venue);
    const user = userEvent.setup();

    render(<App />);
    await uploadViaHiddenInput(zipFile());
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });

    // Initial level is ordinal 0 (1F).
    expect(screen.getByTestId("indoor-map-stub").getAttribute("data-level-id")).toBe(LEVEL_1F.id);

    // Switch to 2F first so we can assert null-level selection retains it.
    await user.click(screen.getByRole("button", { name: "2F" }));
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub").getAttribute("data-level-id")).toBe(LEVEL_2F.id);
    });

    // Switch to English via the menu so search labels match English queries.
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    await user.click(screen.getByRole("button", { name: "English" }));
    await user.keyboard("{Escape}");

    const search = screen.getByRole("combobox", { name: "Search" });
    await user.clear(search);
    await user.type(search, "Restroom");

    const floatingResults = document.querySelector<HTMLElement>(".floating-search__dropdown");
    expect(floatingResults).not.toBeNull();
    const restroomOption = within(floatingResults!).getByRole("option", { name: /Restroom/i });
    await user.click(restroomOption);

    // Null levelId retains current level (2F).
    expect(screen.getByTestId("indoor-map-stub").getAttribute("data-level-id")).toBe(LEVEL_2F.id);
    expect(screen.getByTestId("indoor-map-stub").getAttribute("data-selected-feature-id")).toBe(
      NULL_LEVEL_AMENITY.id,
    );

    // Popup/sheet visitor content is introduced in Task 7.
    // Null-center search selection remains valid without crashing.
    await user.clear(search);
    await user.type(search, "Dangling");
    const nextFloatingResults = document.querySelector<HTMLElement>(".floating-search__dropdown");
    expect(nextFloatingResults).not.toBeNull();
    const dangling = within(nextFloatingResults!).getByRole("option", { name: /Dangling Shop/i });
    await user.click(dangling);

    expect(screen.getByTestId("indoor-map-stub").getAttribute("data-selected-feature-id")).toBe(
      NULL_CENTER_FEATURE.id,
    );
    // Popup/sheet visitor content is introduced in Task 7.
    // Level still retained (null levelId).
    expect(screen.getByTestId("indoor-map-stub").getAttribute("data-level-id")).toBe(LEVEL_2F.id);
  });

  it("switches theme CSS custom properties without unmounting the map stub", async () => {
    const venue = buildMinimalVenue();
    loadImdfArchiveMock.mockResolvedValue(venue);
    const user = userEvent.setup();

    const { container } = render(<App />);
    await uploadViaHiddenInput(zipFile());
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });

    const appRoot = container.querySelector(".app");
    expect(appRoot).toBeTruthy();
    expect((appRoot as HTMLElement).style.getPropertyValue("--color-accent")).toBe(
      themes["tokyo-green"].colors.accent,
    );

    const mapEl = screen.getByTestId("indoor-map-stub");
    const identityBefore = mapEl.getAttribute("data-identity");

    await user.click(screen.getByRole("button", { name: "メニュー" }));
    await user.click(screen.getByRole("button", { name: "Customer Blue" }));

    expect((appRoot as HTMLElement).style.getPropertyValue("--color-accent")).toBe(
      themes["customer-blue"].colors.accent,
    );
    // Same stub element identity (not remounted).
    const mapAfter = screen.getByTestId("indoor-map-stub");
    expect(mapAfter).toBe(mapEl);
    expect(mapAfter.getAttribute("data-identity")).toBe(identityBefore);
    expect(mapAfter.getAttribute("data-theme-id")).toBe("customer-blue");
  });

  it("switches locale pressed state and updates live labels", async () => {
    const venue = buildMinimalVenue();
    loadImdfArchiveMock.mockResolvedValue(venue);
    const user = userEvent.setup();

    render(<App />);
    await uploadViaHiddenInput(zipFile());
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    expect(screen.getByText("テスト駅")).toBeTruthy();

    const jaBtn = screen.getByRole("button", { name: "日本語" });
    const enBtn = screen.getByRole("button", { name: "English" });
    expect(jaBtn.getAttribute("aria-pressed")).toBe("true");
    expect(enBtn.getAttribute("aria-pressed")).toBe("false");

    await user.click(enBtn);
    expect(enBtn.getAttribute("aria-pressed")).toBe("true");
    expect(jaBtn.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Test Station")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open IMDF ZIP" })).toBeTruthy();
  });

  it("renders the map-first ready shell without visitor warnings", async () => {
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await uploadViaHiddenInput(zipFile());
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });

    expect(document.querySelector(".top-bar")).toBeNull();
    expect(document.querySelector(".explorer-sidebar")).toBeNull();
    expect(screen.getByRole("combobox", { name: "検索" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "メニュー" })).toBeTruthy();
    expect(screen.queryByText("警告")).toBeNull();
  });

  it("keeps search and menu mutually exclusive without clearing search", async () => {
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    const user = userEvent.setup();
    render(<App />);
    await uploadViaHiddenInput(zipFile());
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });

    const search = screen.getByRole("combobox", { name: "検索" });
    await user.type(search, "Shop");
    expect(document.querySelector(".floating-search__dropdown")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "メニュー" }));
    expect(screen.getByRole("dialog", { name: "ビューアーメニュー" })).toBeTruthy();
    expect(document.querySelector(".floating-search__dropdown")).toBeNull();
    const reopenedSearch = screen.getByRole("combobox", { name: "検索" });
    expect((reopenedSearch as HTMLInputElement).value).toBe("Shop");

    reopenedSearch.focus();
    await waitFor(() => {
      expect(document.querySelector(".floating-search__dropdown")).not.toBeNull();
    });
    expect(screen.queryByRole("dialog", { name: "ビューアーメニュー" })).toBeNull();
    expect((reopenedSearch as HTMLInputElement).value).toBe("Shop");
  });

  it("selects a feature from the mocked map without restoring legacy details", async () => {
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    const user = userEvent.setup();

    render(<App />);
    await uploadViaHiddenInput(zipFile());
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Select shop from map" }));
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub").getAttribute("data-selected-feature-id")).toBe(
        SHOP_FEATURE.id,
      );
    });
    expect(document.querySelector(".feature-details")).toBeNull();
  });

  it("renders the compact sheet for narrow roots and clears selection on close", async () => {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
          callbacks.push(callback);
        }
        observe(target: Element) {
          this.callback(
            [{ target, contentRect: { width: 500, height: 120 } } as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
      const user = userEvent.setup();
      render(<App />);
      await uploadViaHiddenInput(zipFile());
      await waitFor(() => {
        expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
      });
      expect(screen.getByTestId("indoor-map-stub").getAttribute("data-compact")).toBe("true");
      expect(document.querySelector(".selected-feature-sheet")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Select shop from map" }));
      const sheet = await waitFor(() => {
        const found = document.querySelector(".selected-feature-sheet");
        expect(found).not.toBeNull();
        return found!;
      });
      expect(within(sheet as HTMLElement).getByText("駅ナカショップ")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "詳細を閉じる" }));
      expect(document.querySelector(".selected-feature-sheet")).toBeNull();
      expect(screen.getByTestId("indoor-map-stub").getAttribute("data-selected-feature-id")).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("App deep links", () => {
  beforeEach(() => {
    loadImdfArchiveMock.mockReset();
    fetchImdfFileMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("embed deep link hides chrome, auto-loads src, and selects the requested level", async () => {
    const venue = buildMinimalVenue();
    fetchImdfFileMock.mockResolvedValue(zipFile("minimal.zip"));
    loadImdfArchiveMock.mockResolvedValue(venue);
    window.history.replaceState(null, "", "/?src=/venues/minimal.zip&level=2f&embed=1");

    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });

    expect(fetchImdfFileMock).toHaveBeenCalledWith("/venues/minimal.zip", expect.any(AbortSignal));
    // Deep-linked level 2f (short_name 2F) instead of the default ordinal-0 1F.
    expect(screen.getByTestId("indoor-map-stub").getAttribute("data-level-id")).toBe(LEVEL_2F.id);
    expect(screen.getByRole("button", { name: "2F" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.setup().click(screen.getByRole("button", { name: "メニュー" }));
    expect(container.querySelector(".top-bar")).toBeNull();
    expect(container.querySelector(".explorer-sidebar")).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "IMDF ZIP を開く" })).toBeNull();
  });

  it("allows embedded file controls only with allowOpen=1", async () => {
    fetchImdfFileMock.mockResolvedValue(zipFile("minimal.zip"));
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    window.history.replaceState(
      null,
      "",
      "/?src=/venues/minimal.zip&embed=1&allowOpen=1",
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "メニュー" }));
    expect(screen.getByRole("button", { name: "IMDF ZIP を開く" })).toBeTruthy();
  });

  it("lang and theme params initialize locale and theme", async () => {
    const venue = buildMinimalVenue();
    fetchImdfFileMock.mockResolvedValue(zipFile("minimal.zip"));
    loadImdfArchiveMock.mockResolvedValue(venue);
    window.history.replaceState(
      null,
      "",
      "/?src=/venues/minimal.zip&lang=en&theme=customer-blue",
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });

    const stub = screen.getByTestId("indoor-map-stub");
    expect(stub.getAttribute("data-locale")).toBe("en");
    expect(stub.getAttribute("data-theme-id")).toBe("customer-blue");
  });

  it("fetch failure shows fetch_failed copy and retry re-fetches", async () => {
    const user = userEvent.setup();
    fetchImdfFileMock.mockRejectedValueOnce(new ArchiveError("fetch_failed", "download failed"));
    window.history.replaceState(null, "", "/?src=/venues/minimal.zip&embed=1");

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(archiveErrorCopy.fetch_failed);
    expect(fetchImdfFileMock).toHaveBeenCalledTimes(1);

    const venue = buildMinimalVenue();
    fetchImdfFileMock.mockResolvedValueOnce(zipFile("minimal.zip"));
    loadImdfArchiveMock.mockResolvedValue(venue);

    await user.click(screen.getByRole("button", { name: "再試行" }));

    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });
    expect(fetchImdfFileMock).toHaveBeenCalledTimes(2);
  });
});
