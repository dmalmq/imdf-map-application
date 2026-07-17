import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { IndoorMapProps } from "../map/IndoorMap";
import type * as FetchImdfArchiveModule from "../imdf/fetchImdfArchive";
import type * as GdbImportDialogModule from "../components/GdbImportDialog";
import type { GdbInspection, GdbMappingPlan } from "../gdb/types";
import type * as GdbMappingModule from "../gdb/gdbMapping";
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
  buildingId: null,
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
  buildingId: null,
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
  buildingId: null,
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
  buildingId: null,
  sourceProperties: {},
};

function entryFor(feature: ViewerFeature): SearchEntry {
  const labels = Object.values(feature.labels);
  const altLabels = Object.values(feature.altLabels);
  return {
    featureId: feature.id,
    featureType: feature.featureType,
    levelId: feature.levelId,
    buildingId: feature.buildingId,
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
    buildings: [],
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
        <canvas className="maplibregl-canvas" tabIndex={0} data-testid="map-canvas" />
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
        {props.onMapClick !== undefined ? (
          <button
            type="button"
            data-testid="map-click-proxy"
            onClick={() => {
              props.onMapClick?.([139.76, 35.68]);
            }}
          >
            map click
          </button>
        ) : null}
      </div>
    );
  },
}));

const inspectionFixture = {
  sourceName: "Venue.gdb",
  databases: [{ id: "gdb-1", name: "gdb-1.gdb" }],
  layers: [],
  warnings: [],
};
const planFixture: GdbMappingPlan = { venueName: "Venue", buildings: [], layers: [] };

const focusLayerKey = { databaseId: "gdb-1", layerName: "Venue_1_Floor" };
const focusInspectionFixture: GdbInspection = {
  sourceName: "Venue.gdb",
  databases: [{ id: "gdb-1", name: "Venue.gdb" }],
  layers: [
    {
      key: focusLayerKey,
      databaseName: "Venue.gdb",
      featureCount: 1,
      geometryFamily: "polygon",
      fields: [{ name: "id", type: "String" }],
    },
  ],
  warnings: [],
};
const focusPlanFixture: GdbMappingPlan = {
  venueName: "Venue",
  buildings: [{ id: "building-1", name: "Venue" }],
  layers: [
    {
      key: focusLayerKey,
      included: true,
      targetType: "level",
      buildingId: "building-1",
      levelRule: { kind: "layer-name" },
      idField: "id",
      ordinalField: null,
      shortNameField: null,
      nameField: null,
      categoryField: null,
    },
  ],
};

const createGdbImportSessionMock = vi.fn();
const gdbSelectionNameMock = vi.fn((files: readonly File[]) => files[0]?.name ?? "selection.gdb");

vi.mock("../gdb/loadGdb", () => ({
  createGdbImportSession: (...args: unknown[]) => createGdbImportSessionMock(...args),
  gdbSelectionName: (...args: unknown[]) => gdbSelectionNameMock(...(args as [readonly File[]])),
}));

const suggestGdbMappingMock = vi.fn(() => planFixture);
const buildGdbVenueMock = vi.fn();

vi.mock("../gdb/gdbMapping", async (importOriginal) => {
  const actual = await importOriginal<typeof GdbMappingModule>();
  return {
    ...actual,
    suggestGdbMapping: () => suggestGdbMappingMock(),
    buildGdbVenue: (...args: unknown[]) => buildGdbVenueMock(...args),
  };
});

const gdbDialogMode = vi.hoisted(() => ({ real: false }));

vi.mock("../components/GdbImportDialog", async (importOriginal) => {
  const actual = await importOriginal<typeof GdbImportDialogModule>();
  return {
    GdbImportDialog: function GdbDialogMock(
      props: Parameters<typeof actual.GdbImportDialog>[0],
    ) {
      const [edited, setEdited] = useState(false);
      if (gdbDialogMode.real) {
        return <actual.GdbImportDialog {...props} />;
      }
      return (
        <div
          data-testid="gdb-dialog"
          data-busy={String(props.busy)}
          data-error={props.error?.code ?? ""}
          data-edited={String(edited)}
        >
          <span>{props.inspection.sourceName}</span>
          <button type="button" onClick={() => setEdited(true)}>
            Edit plan
          </button>
          <button type="button" onClick={() => props.onImport(props.initialPlan)}>
            Import GDB
          </button>
          <button type="button" onClick={() => props.onCancel()}>
            Cancel GDB
          </button>
        </div>
      );
    },
  };
});

import type * as CatalogClientModule from "../platform/catalogClient";
import type { AccountInfo, CatalogEntry } from "../platform/types";

const probeCatalogMock = vi.fn(async (): Promise<CatalogEntry[] | null> => null);
const fetchCatalogMock = vi.fn(async (): Promise<CatalogEntry[]> => []);
const fetchMeMock = vi.fn(async (): Promise<AccountInfo | null> => null);
const publishDatasetMock = vi.fn();
const fetchCommentsMock = vi.fn(async (_datasetId: string) => []);
const postCommentMock = vi.fn();
const deleteCommentMock = vi.fn();
const clientLoginMock = vi.fn();
const clientLogoutMock = vi.fn(async () => undefined);
const readVenueSnapshotMock = vi.fn();

vi.mock("../platform/catalogClient", async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogClientModule>();
  return {
    ...actual, // PlatformError, slugifyDatasetId, datasetBlobUrl, datasetViewUrl stay real
    probeCatalog: (...args: unknown[]) => probeCatalogMock(...(args as [])),
    fetchCatalog: (...args: unknown[]) => fetchCatalogMock(...(args as [])),
    fetchMe: () => fetchMeMock(),
    publishDataset: (...args: unknown[]) => publishDatasetMock(...args),
    fetchComments: (...args: unknown[]) => fetchCommentsMock(...(args as [string])),
    postComment: (...args: unknown[]) => postCommentMock(...args),
    deleteComment: (...args: unknown[]) => deleteCommentMock(...args),
    login: (...args: unknown[]) => clientLoginMock(...args),
    logout: () => clientLogoutMock(),
  };
});

vi.mock("../imdf/venueSnapshot", () => ({
  SNAPSHOT_SCHEMA_VERSION: 1,
  readVenueSnapshot: (...args: unknown[]) => readVenueSnapshotMock(...args),
  writeVenueSnapshot: vi.fn(async () => new Blob(["snapshot"])),
}));

const CATALOG_SNAPSHOT_ENTRY: CatalogEntry = {
  id: "tokyo",
  name: "東京駅",
  kind: "venue-snapshot",
  levelCount: 2,
  featureCount: 10,
  sourceName: "JRTokyoSta.gdb",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

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

interface FakeSession {
  inspect: Mock;
  convert: Mock;
  dispose: Mock;
}

function makeSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    inspect: vi.fn().mockResolvedValue(inspectionFixture),
    convert: vi.fn().mockResolvedValue({ layers: [], warnings: [] }),
    dispose: vi.fn(),
    ...overrides,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

// The configured ES2022 lib does not declare Promise.withResolvers, so the
// executor form is required to capture resolve/reject for a deferred fixture.
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function gdbArchiveInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[accept=".zip,.gdb.zip,application/zip"]');
  expect(input).toBeTruthy();
  return input!;
}

function gdbFolderInput(): HTMLInputElement {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  const folder = inputs.find((el) => !el.hasAttribute("accept"));
  expect(folder).toBeTruthy();
  return folder!;
}

// jsdom lacks webkitdirectory; adding it to the prototype makes App treat folder
// picking as supported so the folder input renders and can be exercised.
function enableWebkitDirectory(): () => void {
  Object.defineProperty(window.HTMLInputElement.prototype, "webkitdirectory", {
    configurable: true,
    writable: true,
    value: false,
  });
  return () => {
    Reflect.deleteProperty(window.HTMLInputElement.prototype, "webkitdirectory");
  };
}

describe("App", () => {
  beforeEach(() => {
    gdbDialogMode.real = false;
    loadImdfArchiveMock.mockReset();
    createGdbImportSessionMock.mockReset();
    gdbSelectionNameMock.mockClear();
    suggestGdbMappingMock.mockClear();
    buildGdbVenueMock.mockReset();
    buildGdbVenueMock.mockImplementation(() => buildMinimalVenue());
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

  it("does not show empty-floor notice when the filtered floor only has icon-backed POIs", async () => {
    const iconAmenity: ViewerFeature = {
      id: "icon-locker-1",
      featureType: "amenity",
      levelId: LEVEL_1F.id,
      geometry: { type: "Point", coordinates: [139.7671, 35.6811] },
      center: [139.7671, 35.6811],
      labels: { ja: "ロッカー", en: "Locker" },
      altLabels: {},
      category: "information",
      accessibility: [],
      restriction: null,
      buildingId: null,
      sourceProperties: { image: "/marker/locker.png" },
    };
    const venue = buildMinimalVenue({
      featuresById: new Map([
        [VENUE_FEATURE.id, VENUE_FEATURE],
        [iconAmenity.id, iconAmenity],
      ]),
      searchEntries: [entryFor(iconAmenity)],
    });
    loadImdfArchiveMock.mockResolvedValue(venue);
    const user = userEvent.setup();

    render(<App />);
    await uploadViaHiddenInput(zipFile());
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "絞り込み" }));
    await user.click(screen.getByRole("button", { name: "設備" }));

    expect(screen.getByTestId("indoor-map-stub").getAttribute("data-search-category")).toBe(
      "facilities",
    );
    expect(document.querySelector(".floating-search__no-floor-match")).toBeNull();
  });
});

describe("App GDB import lifecycle", () => {
  beforeEach(() => {
    gdbDialogMode.real = false;
    loadImdfArchiveMock.mockReset();
    createGdbImportSessionMock.mockReset();
    gdbSelectionNameMock.mockClear();
    suggestGdbMappingMock.mockClear();
    buildGdbVenueMock.mockReset();
    buildGdbVenueMock.mockImplementation(() => buildMinimalVenue());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function fireDrop(target: Element, files: File[]): void {
    fireEvent.drop(target, { dataTransfer: { files, types: ["Files"] } });
  }

  it("archive control routes to a directory/archive GDB session, opens review, and announces it", async () => {
    const session = makeSession();
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    const live = document.querySelector("[aria-live='polite']");
    await userEvent.upload(gdbArchiveInput(), zipFile("venue.zip"));

    await screen.findByTestId("gdb-dialog");
    expect(createGdbImportSessionMock).toHaveBeenCalledWith("archive", [
      expect.objectContaining({ name: "venue.zip" }),
    ]);
    expect(session.inspect).toHaveBeenCalledTimes(1);
    // Reviewing: no loading spinner, live-region announces the review.
    expect(document.querySelector(".imdf-dropzone__spinner")).toBeNull();
    expect(document.querySelector(".map-stage__loading")).toBeNull();
    expect(live?.textContent).toContain("GDB レイヤーマッピングを確認");
    expect(live?.textContent).toContain("venue.zip");
  });

  it("import converts the reviewed plan, renders the venue, and disposes the session", async () => {
    const session = makeSession();
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("venue.zip"));
    await screen.findByTestId("gdb-dialog");

    await userEvent.click(screen.getByRole("button", { name: "Import GDB" }));
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });
    expect(session.convert).toHaveBeenCalledWith(planFixture);
    expect(buildGdbVenueMock).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("gdb-dialog")).toBeNull();
  });

  it("focuses the map canvas after a successful GDB conversion closes review", async () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    try {
      gdbDialogMode.real = true;
      const session = makeSession({
        inspect: vi.fn().mockResolvedValue(focusInspectionFixture),
      });
      createGdbImportSessionMock.mockReturnValue(session);
      suggestGdbMappingMock.mockReturnValueOnce(focusPlanFixture);

      render(<App />);
      await userEvent.upload(gdbArchiveInput(), zipFile("venue.zip"));
      await screen.findByRole("dialog", { name: "GDB レイヤーの割り当てを確認" });

      await userEvent.click(screen.getByRole("button", { name: "取り込む" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
      });

      const canvas = screen.getByTestId("map-canvas");
      const mapHost = canvas.parentElement!;
      canvas.remove();
      gdbArchiveInput().focus();
      expect(document.activeElement).not.toBe(canvas);
      expect(frames.length).toBeGreaterThan(0);
      const initialFrames = [...frames];
      for (const frame of initialFrames) {
        frame(performance.now());
      }
      expect(frames.length).toBeGreaterThan(initialFrames.length);
      mapHost.prepend(canvas);
      for (const frame of frames.slice(initialFrames.length)) {
        frame(performance.now());
      }

      await waitFor(() => {
        expect(document.activeElement).toBe(canvas);
      });
    } finally {
      requestFrame.mockRestore();
    }
  });

  it("cancelling review restores the previous venue and disposes the session", async () => {
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    const session = makeSession();
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    await uploadViaHiddenInput(zipFile("first.zip"));
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });
    const mapBefore = screen.getByTestId("indoor-map-stub");

    await userEvent.upload(gdbArchiveInput(), zipFile("replace.zip"));
    await screen.findByTestId("gdb-dialog");
    // Previous venue still visible behind the modal.
    expect(screen.getByTestId("indoor-map-stub")).toBe(mapBefore);

    await userEvent.click(screen.getByRole("button", { name: "Cancel GDB" }));
    expect(screen.queryByTestId("gdb-dialog")).toBeNull();
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("indoor-map-stub")).toBe(mapBefore);
  });

  it("cancelling review without a previous venue returns to the empty dropzone", async () => {
    const session = makeSession();
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("venue.zip"));
    await screen.findByTestId("gdb-dialog");

    await userEvent.click(screen.getByRole("button", { name: "Cancel GDB" }));
    expect(screen.queryByTestId("gdb-dialog")).toBeNull();
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "IMDF ZIP を開く" }).length).toBeGreaterThan(0);
  });

  it("folder control routes to a directory-mode GDB session", async () => {
    const restore = enableWebkitDirectory();
    try {
      const session = makeSession();
      createGdbImportSessionMock.mockReturnValue(session);

      render(<App />);
      await userEvent.upload(gdbFolderInput(), zipFile("JRTokyoSta.gdb"));
      await screen.findByTestId("gdb-dialog");
      expect(createGdbImportSessionMock).toHaveBeenCalledWith("directory", [
        expect.objectContaining({ name: "JRTokyoSta.gdb" }),
      ]);
    } finally {
      restore();
    }
  });

  it("returns focus to the remounted Open GDB folder control after cancel", async () => {
    // The empty dropzone unmounts before the dialog mounts, so dialog cannot
    // snapshot the invoking button. App must remember folder intent and refocus
    // the newly mounted control after cancel.
    const restore = enableWebkitDirectory();
    try {
      gdbDialogMode.real = true;
      const session = makeSession({
        inspect: vi.fn().mockResolvedValue(focusInspectionFixture),
      });
      createGdbImportSessionMock.mockReturnValue(session);
      suggestGdbMappingMock.mockReturnValueOnce(focusPlanFixture);

      render(<App />);
      const folderBtn = screen.getByRole("button", { name: "GDB フォルダを開く" });
      folderBtn.focus();
      expect(document.activeElement).toBe(folderBtn);

      await userEvent.click(folderBtn);
      await userEvent.upload(gdbFolderInput(), zipFile("JRTokyoSta.gdb"));
      await screen.findByRole("dialog", { name: "GDB レイヤーの割り当てを確認" });
      // Invoking control is gone while reviewing (empty dropzone unmounted).
      expect(screen.queryByRole("button", { name: "GDB フォルダを開く" })).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
      expect(screen.queryByRole("dialog")).toBeNull();

      const restored = await screen.findByRole("button", { name: "GDB フォルダを開く" });
      await waitFor(() => {
        expect(document.activeElement).toBe(restored);
      });
    } finally {
      restore();
    }
  });

  it("the archive input imports a generic .zip as GDB, never as IMDF", async () => {
    const session = makeSession();
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("plain.zip"));
    await screen.findByTestId("gdb-dialog");
    expect(createGdbImportSessionMock).toHaveBeenCalledWith("archive", expect.anything());
    expect(loadImdfArchiveMock).not.toHaveBeenCalled();
  });

  it("the IMDF input still loads only through loadImdfArchive", async () => {
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await uploadViaHiddenInput(zipFile("imdf.zip"));
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });
    expect(loadImdfArchiveMock).toHaveBeenCalledTimes(1);
    expect(createGdbImportSessionMock).not.toHaveBeenCalled();
  });

  it("a single .zip drop routes to IMDF", async () => {
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    fireDrop(document.querySelector(".imdf-dropzone")!, [zipFile("single.zip")]);
    await waitFor(() => {
      expect(loadImdfArchiveMock).toHaveBeenCalledTimes(1);
    });
    expect(createGdbImportSessionMock).not.toHaveBeenCalled();
  });

  it("an all-.gdb.zip drop routes to a GDB archive import", async () => {
    const session = makeSession();
    createGdbImportSessionMock.mockReturnValue(session);
    render(<App />);
    fireDrop(document.querySelector(".imdf-dropzone")!, [zipFile("a.gdb.zip"), zipFile("b.gdb.zip")]);
    await screen.findByTestId("gdb-dialog");
    expect(createGdbImportSessionMock).toHaveBeenCalledWith(
      "archive",
      expect.arrayContaining([expect.objectContaining({ name: "a.gdb.zip" })]),
    );
    expect(loadImdfArchiveMock).not.toHaveBeenCalled();
  });

  it("a recoverable conversion error keeps the dialog and edits, then a retry succeeds", async () => {
    const session = makeSession({
      convert: vi
        .fn()
        .mockRejectedValueOnce(new ArchiveError("gdb_conversion_failed", "bad layers"))
        .mockResolvedValueOnce({ layers: [], warnings: [] }),
    });
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("venue.zip"));
    const dialog = await screen.findByTestId("gdb-dialog");

    await userEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    expect(dialog.getAttribute("data-edited")).toBe("true");

    await userEvent.click(screen.getByRole("button", { name: "Import GDB" }));
    await waitFor(() => {
      expect(screen.getByTestId("gdb-dialog").getAttribute("data-error")).toBe("gdb_conversion_failed");
    });
    // Dialog persists with manual edits intact; not disposed, no venue rendered.
    expect(screen.getByTestId("gdb-dialog").getAttribute("data-edited")).toBe("true");
    expect(screen.getByTestId("gdb-dialog").getAttribute("data-busy")).toBe("false");
    expect(session.dispose).not.toHaveBeenCalled();
    expect(screen.queryByTestId("indoor-map-stub")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Import GDB" }));
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it("a fatal worker fault fails the import and disposes the session", async () => {
    const session = makeSession({
      convert: vi.fn().mockRejectedValue(new ArchiveError("worker_failed", "crash")),
    });
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("venue.zip"));
    await screen.findByTestId("gdb-dialog");
    await userEvent.click(screen.getByRole("button", { name: "Import GDB" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(archiveErrorCopy.worker_failed);
    expect(screen.queryByTestId("gdb-dialog")).toBeNull();
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale inspection when a newer import starts, disposing the old session", async () => {
    const first = makeSession({ inspect: vi.fn() });
    const firstInspect = deferred<typeof inspectionFixture>();
    first.inspect.mockReturnValue(firstInspect.promise);
    const second = makeSession({
      inspect: vi.fn().mockResolvedValue({ ...inspectionFixture, sourceName: "Second.gdb" }),
    });
    createGdbImportSessionMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("one.gdb.zip"));
    await userEvent.upload(gdbArchiveInput(), zipFile("two.gdb.zip"));
    await screen.findByText("Second.gdb");
    expect(first.dispose).toHaveBeenCalled();

    // A late first inspection must not replace the newer review.
    firstInspect.resolve({ ...inspectionFixture, sourceName: "First.gdb" });
    await Promise.resolve();
    expect(screen.queryByText("First.gdb")).toBeNull();
    expect(screen.getByText("Second.gdb")).toBeTruthy();
  });

  it("ignores a convert that resolves after the review was cancelled", async () => {
    const convertDeferred = deferred<{ layers: []; warnings: [] }>();
    const session = makeSession({ convert: vi.fn().mockReturnValue(convertDeferred.promise) });
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("venue.zip"));
    await screen.findByTestId("gdb-dialog");
    await userEvent.click(screen.getByRole("button", { name: "Import GDB" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel GDB" }));
    expect(screen.queryByTestId("gdb-dialog")).toBeNull();

    convertDeferred.resolve({ layers: [], warnings: [] });
    await Promise.resolve();
    expect(buildGdbVenueMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("indoor-map-stub")).toBeNull();
  });

  it("starting an IMDF load disposes an active GDB session", async () => {
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    const inspectDeferred = deferred<typeof inspectionFixture>();
    const session = makeSession({ inspect: vi.fn().mockReturnValue(inspectDeferred.promise) });
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("venue.gdb.zip"));
    await uploadViaHiddenInput(zipFile("imdf.zip"));
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });
    expect(session.dispose).toHaveBeenCalled();
  });

  it("disposes an active GDB session on unmount", async () => {
    const inspectDeferred = deferred<typeof inspectionFixture>();
    const session = makeSession({ inspect: vi.fn().mockReturnValue(inspectDeferred.promise) });
    createGdbImportSessionMock.mockReturnValue(session);

    const { unmount } = render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("venue.gdb.zip"));
    unmount();
    expect(session.dispose).toHaveBeenCalled();
  });

  it("dispatches load_started before session construction and fails on a synchronous factory throw", async () => {
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    createGdbImportSessionMock.mockImplementation(() => {
      throw new Error("Worker construction failed");
    });

    render(<App />);
    // Load an IMDF venue first so we can prove it survives the failed GDB import.
    await uploadViaHiddenInput(zipFile("first.zip"));
    await waitFor(() => {
      expect(screen.getByTestId("indoor-map-stub")).toBeTruthy();
    });
    const mapBefore = screen.getByTestId("indoor-map-stub");

    await userEvent.upload(gdbArchiveInput(), zipFile("broken.gdb.zip"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(archiveErrorCopy.worker_failed);
    // Previous venue retained behind the error banner.
    expect(screen.getByTestId("indoor-map-stub")).toBe(mapBefore);
  });

  it("retry after a fatal GDB archive inspection reopens the archive picker, not IMDF", async () => {
    const session = makeSession({
      inspect: vi.fn().mockRejectedValue(new ArchiveError("invalid_geodatabase", "nope")),
    });
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("bad.gdb.zip"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(archiveErrorCopy.invalid_geodatabase);

    const archiveClick = vi.spyOn(gdbArchiveInput(), "click");
    const imdfInput = document.querySelector<HTMLInputElement>('input[accept=".zip,application/zip"]')!;
    const imdfClick = vi.spyOn(imdfInput, "click");
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(archiveClick).toHaveBeenCalledTimes(1);
    expect(imdfClick).not.toHaveBeenCalled();
  });

  it("retry after a fatal GDB convert reopens the archive picker, not IMDF", async () => {
    const session = makeSession({
      convert: vi.fn().mockRejectedValue(new ArchiveError("worker_failed", "crash")),
    });
    createGdbImportSessionMock.mockReturnValue(session);

    render(<App />);
    await userEvent.upload(gdbArchiveInput(), zipFile("venue.gdb.zip"));
    await screen.findByTestId("gdb-dialog");
    await userEvent.click(screen.getByRole("button", { name: "Import GDB" }));
    await screen.findByRole("alert");

    const archiveClick = vi.spyOn(gdbArchiveInput(), "click");
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(archiveClick).toHaveBeenCalledTimes(1);
  });

  it("retry after a fatal GDB folder inspection reopens the folder picker", async () => {
    const restore = enableWebkitDirectory();
    try {
      const session = makeSession({
        inspect: vi.fn().mockRejectedValue(new ArchiveError("invalid_geodatabase", "nope")),
      });
      createGdbImportSessionMock.mockReturnValue(session);

      render(<App />);
      await userEvent.upload(gdbFolderInput(), zipFile("station.gdb"));
      const alert = await screen.findByRole("alert");
      const retry = alert.querySelector<HTMLButtonElement>(".viewer-notice__retry")!;
      await waitFor(() => expect(document.activeElement).toBe(retry));

      const folderClick = vi.spyOn(gdbFolderInput(), "click");
      await userEvent.click(retry);
      expect(folderClick).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("retry after an IMDF failure reopens the IMDF picker", async () => {
    loadImdfArchiveMock.mockRejectedValue(new ArchiveError("invalid_archive", "bad zip"));
    render(<App />);
    await uploadViaHiddenInput(zipFile("bad.zip"));
    await screen.findByRole("alert");

    const imdfInput = document.querySelector<HTMLInputElement>('input[accept=".zip,application/zip"]')!;
    const imdfClick = vi.spyOn(imdfInput, "click");
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(imdfClick).toHaveBeenCalledTimes(1);
  });

  it("hidden file inputs are not Tab stops, carry action-specific labels, and omit folder when unsupported", () => {
    render(<App />);
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    // jsdom lacks webkitdirectory → only the IMDF and GDB archive inputs render.
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input.getAttribute("tabindex")).toBe("-1");
    }
    expect(
      document.querySelector('input[accept=".zip,application/zip"]')?.getAttribute("aria-label"),
    ).toBe("IMDF ZIP を開く");
    expect(gdbArchiveInput().getAttribute("aria-label")).toBe("GDB アーカイブを開く");
    // No accept-less directory input can route ordinary files as directory mode.
    expect(inputs.some((el) => !el.hasAttribute("accept"))).toBe(false);
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

describe("App dataset loading", () => {
  beforeEach(() => {
    loadImdfArchiveMock.mockReset();
    fetchImdfFileMock.mockReset();
    readVenueSnapshotMock.mockReset();
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("loads a snapshot dataset from ?dataset= without the IMDF worker", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    expect(await screen.findByTestId("indoor-map-stub")).toBeTruthy();
    expect(fetchImdfFileMock).toHaveBeenCalledWith("/datasets/tokyo.zip", expect.anything());
    expect(readVenueSnapshotMock).toHaveBeenCalledTimes(1);
    expect(loadImdfArchiveMock).not.toHaveBeenCalled();
  });

  it("routes kind=imdf datasets through the strict IMDF loader", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    fetchCatalogMock.mockResolvedValue([{ ...CATALOG_SNAPSHOT_ENTRY, kind: "imdf" }]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    expect(await screen.findByTestId("indoor-map-stub")).toBeTruthy();
    expect(loadImdfArchiveMock).toHaveBeenCalledTimes(1);
    expect(readVenueSnapshotMock).not.toHaveBeenCalled();
  });

  it("prefers ?dataset over ?src", async () => {
    window.history.replaceState(null, "", "/?src=/venues/other.zip&dataset=tokyo");
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
    expect(fetchImdfFileMock).toHaveBeenCalledTimes(1);
    expect(fetchImdfFileMock).toHaveBeenCalledWith("/datasets/tokyo.zip", expect.anything());
  });

  it("unknown dataset id surfaces the error banner and Retry re-fetches", async () => {
    window.history.replaceState(null, "", "/?dataset=missing");
    fetchCatalogMock.mockResolvedValueOnce([]);
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(archiveErrorCopy.fetch_failed);
    fetchCatalogMock.mockResolvedValueOnce([{ ...CATALOG_SNAPSHOT_ENTRY, id: "missing" }]);
    fetchImdfFileMock.mockResolvedValue(zipFile("missing.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    const retry = alert.querySelector<HTMLButtonElement>(".viewer-notice__retry");
    expect(retry).toBeTruthy();
    await userEvent.click(retry!);
    expect(await screen.findByTestId("indoor-map-stub")).toBeTruthy();
  });

  it("classifies catalog transport failures as fetch failures", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    fetchCatalogMock.mockRejectedValueOnce(new TypeError("network down"));
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(archiveErrorCopy.fetch_failed);
    expect(alert.textContent).not.toContain(archiveErrorCopy.worker_failed);
  });
});

describe("App platform landing", () => {
  beforeEach(() => {
    loadImdfArchiveMock.mockReset();
    fetchImdfFileMock.mockReset();
    readVenueSnapshotMock.mockReset();
    fetchCatalogMock.mockReset();
    probeCatalogMock.mockReset();
    fetchMeMock.mockReset();
    clientLogoutMock.mockClear();
    createGdbImportSessionMock.mockReset();
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("shows the gallery when the server probe succeeds and opens a dataset in place", async () => {
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    const card = await screen.findByRole("button", { name: /東京駅/ });
    // The publisher's local-open controls stay available beside the gallery.
    expect(screen.getByRole("button", { name: "IMDF ZIP を開く" })).toBeTruthy();
    await userEvent.click(card);
    expect(await screen.findByTestId("indoor-map-stub")).toBeTruthy();
    expect(window.location.search).toContain("dataset=tokyo");
    expect(screen.queryByText("データセット")).toBeNull();
  });

  it("falls back to the plain dropzone landing when the probe fails", async () => {
    probeCatalogMock.mockResolvedValueOnce(null);
    render(<App />);
    expect(await screen.findByRole("button", { name: "IMDF ZIP を開く" })).toBeTruthy();
    expect(screen.queryByText("データセット")).toBeNull();
  });

  it("shows the account row in the viewer menu and reflects /api/me state", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchMeMock.mockResolvedValueOnce({ username: "admin", role: "admin" });
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    expect(await screen.findByText(/admin \(admin\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "サインアウト" })).toBeTruthy();
  });

  it("signs out from the menu and reopens the sign-in dialog", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchMeMock.mockResolvedValueOnce({ username: "admin", role: "admin" });
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    await userEvent.click(await screen.findByRole("button", { name: "サインアウト" }));
    expect(clientLogoutMock).toHaveBeenCalledTimes(1);
    const signIn = await screen.findByRole("button", { name: "サインイン" });
    expect(screen.queryByText(/admin \(admin\)/)).toBeNull();
    await userEvent.click(signIn);
    expect(
      await screen.findByRole("heading", { name: "アカウントにサインイン" }),
    ).toBeTruthy();
  });

  it("suppresses the gallery and account chrome in embed mode", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo&embed=1");
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
    expect(probeCatalogMock).not.toHaveBeenCalled();
    expect(fetchMeMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    expect(screen.queryByRole("button", { name: "サインイン" })).toBeNull();
    expect(screen.queryByText("データセット")).toBeNull();
  });

  it("records the opened dataset as the active identity before it finishes loading", async () => {
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    const download = deferred<File>();
    fetchImdfFileMock.mockReturnValue(download.promise);
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /東京駅/ }));
    // The clicked id becomes the active dataset immediately: the gallery leaves
    // the landing while the download is still pending.
    expect(screen.queryByText("データセット")).toBeNull();
    expect(window.location.search).toContain("dataset=tokyo");
    download.resolve(zipFile("tokyo.zip"));
    expect(await screen.findByTestId("indoor-map-stub")).toBeTruthy();
  });

  it("clears the active dataset for local IMDF imports so the gallery returns", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchCatalogMock.mockRejectedValueOnce(new TypeError("offline"));
    render(<App />);
    // The failed deep-linked dataset keeps its id active: no gallery on the banner.
    await screen.findByRole("alert");
    expect(screen.queryByText("データセット")).toBeNull();
    const load = deferred<LoadedVenue>();
    loadImdfArchiveMock.mockReturnValue(load.promise);
    await uploadViaHiddenInput(zipFile("local.zip"));
    // A local import clears the active dataset, so the landing gallery returns.
    expect(await screen.findByText("データセット")).toBeTruthy();
    load.resolve(buildMinimalVenue());
    expect(await screen.findByTestId("indoor-map-stub")).toBeTruthy();
  });

  it("clears the active dataset for GDB imports", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchCatalogMock.mockRejectedValueOnce(new TypeError("offline"));
    render(<App />);
    await screen.findByRole("alert");
    expect(screen.queryByText("データセット")).toBeNull();
    const inspection = deferred<GdbInspection>();
    createGdbImportSessionMock.mockReturnValue(
      makeSession({ inspect: vi.fn(() => inspection.promise) }),
    );
    await userEvent.upload(gdbArchiveInput(), zipFile("venue.gdb.zip"));
    // The pending GDB attempt cleared the active dataset: the gallery returns.
    expect(await screen.findByText("データセット")).toBeTruthy();
  });
});

describe("App publish flow", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  async function loadLocalImdf(): Promise<void> {
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await uploadViaHiddenInput(zipFile("minimal.zip"));
    await screen.findByTestId("indoor-map-stub");
  }

  it("shows Publish only for admins with a locally loaded venue", async () => {
    probeCatalogMock.mockResolvedValueOnce([]);
    fetchMeMock.mockResolvedValueOnce({ username: "admin", role: "admin" });
    await loadLocalImdf();
    expect(await screen.findByRole("button", { name: "公開" })).toBeTruthy();
  });

  it("hides Publish for signed-out viewers with a local venue", async () => {
    probeCatalogMock.mockResolvedValueOnce([]);
    await loadLocalImdf();
    expect(screen.queryByRole("button", { name: "公開" })).toBeNull();
  });

  it("hides Publish for dataset-loaded venues even as admin", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchMeMock.mockResolvedValueOnce({ username: "admin", role: "admin" });
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
    expect(screen.queryByRole("button", { name: "公開" })).toBeNull();
  });
});

describe("App comments", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  async function openDataset(): Promise<void> {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchMeMock.mockResolvedValueOnce({ username: "alice", role: "user" });
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
  }

  it("opens the panel, arms a pin, captures a map click, and posts", async () => {
    fetchCommentsMock.mockResolvedValue([]);
    postCommentMock.mockResolvedValue({
      id: "c1",
      author: "alice",
      text: "x",
      createdAt: "2026-07-16T00:00:00.000Z",
    });
    await openDataset();
    await userEvent.click(screen.getByRole("button", { name: "コメント" }));
    await userEvent.click(await screen.findByRole("button", { name: "地図にピンを打つ" }));
    await userEvent.click(await screen.findByTestId("map-click-proxy"));
    await userEvent.type(screen.getByRole("textbox", { name: "コメント" }), "ここが狭い");
    await userEvent.click(screen.getByRole("button", { name: "投稿" }));
    await waitFor(() => {
      expect(postCommentMock).toHaveBeenCalledWith(
        "tokyo",
        expect.objectContaining({
          text: "ここが狭い",
          levelId: LEVEL_1F.id,
          lngLat: [139.76, 35.68],
        }),
      );
    });
  });

  it("hides the comments toggle for local files and in embed mode", async () => {
    probeCatalogMock.mockResolvedValueOnce([]);
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    const local = render(<App />);
    await uploadViaHiddenInput(zipFile("local.zip"));
    await screen.findByTestId("indoor-map-stub");
    expect(screen.queryByRole("button", { name: "コメント" })).toBeNull();
    local.unmount();

    window.history.replaceState(null, "", "/?dataset=tokyo&embed=1");
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
    expect(screen.queryByRole("button", { name: "コメント" })).toBeNull();
  });

  it("keeps dataset identity when opening a gallery card so comments are available", async () => {
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /東京駅/ }));
    await screen.findByTestId("indoor-map-stub");
    expect(screen.getByRole("button", { name: "コメント" })).toBeTruthy();
  });

  it("opens sign-in from a signed-out comments panel", async () => {
    fetchMeMock.mockResolvedValueOnce(null);
    await openDataset();
    await userEvent.click(screen.getByRole("button", { name: "コメント" }));
    await userEvent.click(await screen.findByRole("button", { name: "サインインしてコメント" }));
    expect(screen.getByLabelText("アカウントにサインイン")).toBeTruthy();
  });
});
