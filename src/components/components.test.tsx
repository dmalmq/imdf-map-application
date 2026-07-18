import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ViewerFeature, ViewerLevel, ViewerWarning } from "../imdf/types";
import { defaultLayerVisibility } from "../map/layerGroups";
import { FloorStack } from "./FloorStack";
import { IconRail } from "./IconRail";
import { ImdfDropzone } from "./ImdfDropzone";
import { InspectorPanel } from "./InspectorPanel";
import { LayersPanel } from "./LayersPanel";
import { SearchPanel } from "./SearchPanel";
import { WarningsPanel } from "./WarningsPanel";
import { ViewerErrorNotice } from "./ViewerNotice";
import { VenueLoadError, venueLoadErrorCopy } from "../errors/VenueLoadError";

const LEVEL_2F: ViewerLevel = {
  id: "b1000003-0000-4000-8000-00000000002f",
  ordinal: 1,
  label: { ja: "2F", en: "2F" },
  shortName: { ja: "2F", en: "2F" },
};

const LEVEL_1F: ViewerLevel = {
  id: "b1000002-0000-4000-8000-00000000001f",
  ordinal: 0,
  label: { ja: "1F", en: "1F" },
  shortName: { ja: "1F", en: "1F" },
};

const LEVEL_B1: ViewerLevel = {
  id: "b1000001-0000-4000-8000-0000000000b1",
  ordinal: -1,
  label: { ja: "B1", en: "B1" },
  shortName: { ja: "B1", en: "B1" },
};

/** Descending ordinal order as normalizeVenue produces. */
const LEVELS_DESC: ViewerLevel[] = [LEVEL_2F, LEVEL_1F, LEVEL_B1];

function makeFeature(overrides: Partial<ViewerFeature> & Pick<ViewerFeature, "id">): ViewerFeature {
  return {
    featureType: "unit",
    levelId: LEVEL_1F.id,
    geometry: null,
    center: null,
    labels: {},
    altLabels: {},
    category: null,
    accessibility: [],
    restriction: null,
    sourceProperties: {},
    ...overrides,
  };
}

describe("FloorStack", () => {
  it("renders levels in the given descending order with aria-pressed on the selected floor", () => {
    render(
      <FloorStack
        levels={LEVELS_DESC}
        selectedLevelId={LEVEL_1F.id}
        locale="en"
        manifestLanguage="ja-JP"
        onSelect={() => {}}
      />,
    );

    const group = screen.getByRole("group", { name: "Levels" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["2F", "1F", "B1"]);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[2]?.getAttribute("aria-pressed")).toBe("false");
  });

  it("changes selection on click and Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FloorStack
        levels={LEVELS_DESC}
        selectedLevelId={LEVEL_1F.id}
        locale="en"
        manifestLanguage="ja-JP"
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: "2F" }));
    expect(onSelect).toHaveBeenCalledWith(LEVEL_2F.id);

    onSelect.mockClear();
    const b1 = screen.getByRole("button", { name: "B1" });
    b1.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(LEVEL_B1.id);
  });
});

function renderSearchPanel(
  overrides: Partial<Parameters<typeof SearchPanel>[0]> = {},
): ReturnType<typeof render> {
  const props: Parameters<typeof SearchPanel>[0] = {
    locale: "en",
    searchText: "",
    searchCategory: "all",
    results: [],
    selectedFeatureId: null,
    onSearchText: () => {},
    onSearchCategory: () => {},
    onSelectResult: () => {},
    ...overrides,
  };
  return render(<SearchPanel {...props} />);
}

describe("SearchPanel category chips", () => {
  it("marks the active category with aria-pressed and toggles on click", async () => {
    const user = userEvent.setup();
    const onSearchCategory = vi.fn();
    renderSearchPanel({ onSearchCategory });

    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Gates" }).getAttribute("aria-pressed")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Shops" }));
    expect(onSearchCategory).toHaveBeenCalledWith("shops");
  });

  it("localizes chip labels for ja and en", () => {
    renderSearchPanel();
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gates" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shops" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Facilities" })).toBeTruthy();
  });

  it("localizes chip labels for ja", () => {
    renderSearchPanel({ locale: "ja" });
    expect(screen.getByRole("button", { name: "すべて" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "改札・出入口" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "店舗" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "設備" })).toBeTruthy();
  });
});

describe("IconRail", () => {
  it("toggles panels and marks the active one", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <IconRail locale="en" activePanel="search" warningCount={0} onToggle={onToggle} />,
    );

    const search = screen.getByRole("button", { name: "Search" });
    expect(search.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Layers" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    // No warnings → no warnings toggle.
    expect(screen.queryByRole("button", { name: "Warnings" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Layers" }));
    expect(onToggle).toHaveBeenCalledWith("layers");
  });

  it("shows the warnings toggle with a count badge when warnings exist", () => {
    render(
      <IconRail locale="en" activePanel={null} warningCount={5} onToggle={() => {}} />,
    );
    const warnings = screen.getByRole("button", { name: "Warnings" });
    expect(warnings.textContent).toContain("5");
  });
  it("shows caller-controlled Issues with an all-floor count capped at 99+", () => {
    const { rerender } = render(
      <IconRail
        locale="en"
        activePanel="issues"
        warningCount={0}
        issuesVisible
        issueCount={125}
        onToggle={() => {}}
      />,
    );

    const issues = screen.getByRole("button", { name: "Issues" });
    expect(issues.getAttribute("aria-pressed")).toBe("true");
    expect(issues.textContent).toContain("99+");

    rerender(
      <IconRail
        locale="en"
        activePanel={null}
        warningCount={0}
        issuesVisible={false}
        issueCount={125}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Issues" })).toBeNull();
  });
});

describe("LayersPanel", () => {
  it("reflects visibility with aria-pressed and reports toggles", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <LayersPanel
        locale="en"
        visibility={{ ...defaultLayerVisibility, openings: false }}
        onToggle={onToggle}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Units: shown" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Openings: hidden" }).getAttribute("aria-pressed"),
    ).toBe("false");

    await user.click(screen.getByRole("button", { name: "Openings: hidden" }));
    expect(onToggle).toHaveBeenCalledWith("openings");
  });
});

describe("InspectorPanel", () => {
  it("omits category, hours, and restriction rows when absent", () => {
    const feature = makeFeature({
      id: "c1000012-0000-4000-8000-00000000012f",
      labels: { en: "Open Room", ja: "オープンスペース" },
      category: null,
      restriction: null,
      sourceProperties: {},
    });

    render(
      <InspectorPanel
        feature={feature}
        levels={LEVELS_DESC}
        locale="en"
        manifestLanguage="ja-JP"
      />,
    );

    expect(screen.queryByText("Category")).toBeNull();
    expect(screen.queryByText("Hours")).toBeNull();
    expect(screen.queryByText("Restriction")).toBeNull();
    expect(screen.getByText("Type")).toBeTruthy();
    expect(screen.getByText("ID")).toBeTruthy();
  });

  it("renders hours when present in sourceProperties", () => {
    const feature = makeFeature({
      id: "a1000008-0000-4000-8000-0000000000c1",
      featureType: "occupant",
      labels: { ja: "駅ナカショップ", en: "Station Shop" },
      category: "shopping",
      sourceProperties: { hours: "Mo-Fr 10:00-20:00" },
    });

    render(
      <InspectorPanel
        feature={feature}
        levels={LEVELS_DESC}
        locale="en"
        manifestLanguage="ja-JP"
      />,
    );

    expect(screen.getByText("Hours")).toBeTruthy();
    expect(screen.getByText("Mo-Fr 10:00-20:00")).toBeTruthy();
    // Kind line and the Category row both show the category.
    expect(screen.getByText("occupant · shopping · 1F")).toBeTruthy();
  });

  it("shows the feature id in the ID row", () => {
    const featureId = "c1000002-0000-4000-8000-0000000000b2";
    const feature = makeFeature({
      id: featureId,
      labels: {},
      altLabels: {},
    });

    render(
      <InspectorPanel
        feature={feature}
        levels={LEVELS_DESC}
        locale="en"
        manifestLanguage="ja-JP"
      />,
    );
    expect(screen.getByText(featureId)).toBeTruthy();
  });

  it("shows copy-link feedback state from the caller", async () => {
    const user = userEvent.setup();
    const onCopyLink = vi.fn();
    const feature = makeFeature({ id: "c1000012-0000-4000-8000-00000000012f" });
    const { rerender } = render(
      <InspectorPanel
        feature={feature}
        levels={LEVELS_DESC}
        locale="en"
        manifestLanguage="ja-JP"
        onCopyLink={onCopyLink}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(onCopyLink).toHaveBeenCalledTimes(1);

    rerender(
      <InspectorPanel
        feature={feature}
        levels={LEVELS_DESC}
        locale="en"
        manifestLanguage="ja-JP"
        onCopyLink={onCopyLink}
        copied
      />,
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });
});

describe("WarningsPanel", () => {
  it("shows warning messages with their codes", () => {
    const warnings: ViewerWarning[] = [
      {
        code: "missing_locale",
        message: "Feature lacks English label",
        featureId: "c1000002-0000-4000-8000-0000000000b2",
      },
      {
        code: "unresolved_reference",
        message: "Anchor not found",
        featureId: "a1000009-0000-4000-8000-0000000000c2",
      },
    ];

    render(<WarningsPanel warnings={warnings} locale="en" />);

    expect(screen.getByText("Feature lacks English label")).toBeTruthy();
    expect(screen.getByText("Anchor not found")).toBeTruthy();
    expect(screen.getByText(/missing_locale/)).toBeTruthy();
    expect(screen.getByText(/unresolved_reference/)).toBeTruthy();
  });

  it("renders an empty message when there are no warnings", () => {
    render(<WarningsPanel warnings={[]} locale="en" />);
    expect(screen.getByText("No warnings")).toBeTruthy();
  });
});

describe("ImdfDropzone", () => {
  it("opens the file picker when the empty-state button is activated with click, Enter, and Space", async () => {
    const user = userEvent.setup();
    const onOpenPicker = vi.fn();
    render(
      <ImdfDropzone
        locale="en"
        status="empty"
        variant="empty"
        onFile={() => {}}
        onOpenPicker={onOpenPicker}
      />,
    );

    const openBtn = screen.getByRole("button", { name: "Open IMDF ZIP" });
    await user.click(openBtn);
    expect(onOpenPicker).toHaveBeenCalledTimes(1);

    onOpenPicker.mockClear();
    openBtn.focus();
    await user.keyboard("{Enter}");
    expect(onOpenPicker).toHaveBeenCalledTimes(1);

    onOpenPicker.mockClear();
    openBtn.focus();
    await user.keyboard(" ");
    expect(onOpenPicker).toHaveBeenCalledTimes(1);
  });
});

describe("ViewerErrorNotice", () => {
  it("shows bundle download copy for a bundle-provenance fetch_failed error", () => {
    const error = new VenueLoadError(
      "fetch_failed",
      "Could not download the Kiriko bundle.",
      { src: "/v/default/tokyo/bundle" },
      "bundle",
    );
    render(<ViewerErrorNotice error={error} locale="en" onRetry={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("bundle");
    expect(alert.textContent).not.toContain("archive");
    expect(alert.textContent).not.toContain("CORS");
  });

  it("shows bundle retry copy for a bundle-provenance worker_failed error", () => {
    const error = new VenueLoadError(
      "worker_failed",
      "wasm trap: unreachable executed",
      undefined,
      "bundle",
    );
    render(<ViewerErrorNotice error={error} locale="en" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("bundle");
    expect(alert.textContent).not.toContain("archive");
    expect(alert.textContent).not.toContain("wasm trap");
  });

  it("keeps ZIP archive copy for direct-archive fetch_failed and worker_failed errors", () => {
    const fetchError = new VenueLoadError("fetch_failed", "Could not download IMDF archive.");
    const { unmount } = render(<ViewerErrorNotice error={fetchError} locale="en" />);
    expect(screen.getByRole("alert").textContent).toContain(venueLoadErrorCopy.fetch_failed);
    expect(screen.getByRole("alert").textContent).toContain("Could not load archive");
    unmount();

    const workerError = new VenueLoadError("worker_failed", "boom");
    render(<ViewerErrorNotice error={workerError} locale="en" />);
    expect(screen.getByRole("alert").textContent).toContain(venueLoadErrorCopy.worker_failed);
    expect(screen.getByRole("alert").textContent).toContain("archive");
  });

  it("keeps the four stable bundle codes corrective and never leaks message or details", () => {
    const codes = [
      "invalid_bundle",
      "unsupported_bundle_version",
      "bundle_integrity_failed",
      "bundle_too_large",
    ] as const;
    for (const code of codes) {
      const error = new VenueLoadError(
        code,
        "kvb sha mismatch: deadbeef",
        { expected: "deadbeef" },
        "bundle",
      );
      const { unmount } = render(<ViewerErrorNotice error={error} locale="en" />);
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain(venueLoadErrorCopy[code]);
      expect(alert.textContent).not.toContain("deadbeef");
      unmount();
    }
  });
});
