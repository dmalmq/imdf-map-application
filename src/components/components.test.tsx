import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ViewerFeature, ViewerLevel, ViewerWarning } from "../imdf/types";
import { CategoryChips } from "./CategoryChips";
import { FeatureDetails } from "./FeatureDetails";
import { ImdfDropzone } from "./ImdfDropzone";
import { LevelSwitcher } from "./LevelSwitcher";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { ViewerWarnings } from "./ViewerNotice";

const LEVEL_2F: ViewerLevel = {
  id: "b1000003-0000-4000-8000-00000000002f",
  ordinal: 1,
  label: { ja: "2F", en: "2F" },
};

const LEVEL_1F: ViewerLevel = {
  id: "b1000002-0000-4000-8000-00000000001f",
  ordinal: 0,
  label: { ja: "1F", en: "1F" },
};

const LEVEL_B1: ViewerLevel = {
  id: "b1000001-0000-4000-8000-0000000000b1",
  ordinal: -1,
  label: { ja: "B1", en: "B1" },
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

describe("LevelSwitcher", () => {
  it("renders levels in the given descending order with aria-pressed on the selected pill", () => {
    render(
      <LevelSwitcher
        levels={LEVELS_DESC}
        selectedLevelId={LEVEL_1F.id}
        locale="en"
        manifestLanguage="ja-JP"
        onSelect={() => {}}
      />,
    );

    const group = screen.getByRole("group", { name: "Levels" });
    const pills = within(group).getAllByRole("button");
    expect(pills.map((pill) => pill.textContent)).toEqual(["2F", "1F", "B1"]);
    expect(pills[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(pills[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(pills[2]?.getAttribute("aria-pressed")).toBe("false");
  });

  it("changes selection on click and Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <LevelSwitcher
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

describe("CategoryChips", () => {
  it("marks the active category with aria-pressed and toggles on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <CategoryChips category="all" locale="en" onChange={onChange} />,
    );

    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Gates" }).getAttribute("aria-pressed")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Shops" }));
    expect(onChange).toHaveBeenCalledWith("shops");

    rerender(<CategoryChips category="shops" locale="en" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Shops" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("localizes chip labels for ja and en", () => {
    const { rerender } = render(
      <CategoryChips category="all" locale="en" onChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gates" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shops" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Facilities" })).toBeTruthy();

    rerender(<CategoryChips category="all" locale="ja" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "すべて" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "改札・出入口" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "店舗" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "設備" })).toBeTruthy();
  });
});

describe("ThemeSwitcher", () => {
  it("updates aria-pressed when the selected theme changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <ThemeSwitcher themeId="tokyo-green" locale="en" onChange={onChange} />,
    );

    const green = screen.getByRole("button", { name: "Tokyo Green" });
    const blue = screen.getByRole("button", { name: "Customer Blue" });
    expect(green.getAttribute("aria-pressed")).toBe("true");
    expect(blue.getAttribute("aria-pressed")).toBe("false");

    await user.click(blue);
    expect(onChange).toHaveBeenCalledWith("customer-blue");

    rerender(<ThemeSwitcher themeId="customer-blue" locale="en" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Customer Blue" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Tokyo Green" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});

describe("FeatureDetails", () => {
  it("omits category, hours, and restriction rows when absent", () => {
    const feature = makeFeature({
      id: "c1000012-0000-4000-8000-00000000012f",
      labels: { en: "Open Room", ja: "オープンスペース" },
      category: null,
      restriction: null,
      sourceProperties: {},
    });

    render(
      <FeatureDetails
        feature={feature}
        levels={LEVELS_DESC}
        locale="en"
        manifestLanguage="ja-JP"
      />,
    );

    expect(screen.getByText("Open Room")).toBeTruthy();
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
      <FeatureDetails
        feature={feature}
        levels={LEVELS_DESC}
        locale="en"
        manifestLanguage="ja-JP"
      />,
    );

    expect(screen.getByText("Hours")).toBeTruthy();
    expect(screen.getByText("Mo-Fr 10:00-20:00")).toBeTruthy();
    expect(screen.getByText("shopping")).toBeTruthy();
  });

  it("falls back to the feature id when locale labels are missing", () => {
    const featureId = "c1000002-0000-4000-8000-0000000000b2";
    const feature = makeFeature({
      id: featureId,
      labels: {},
      altLabels: {},
    });

    render(
      <FeatureDetails
        feature={feature}
        levels={LEVELS_DESC}
        locale="en"
        manifestLanguage="ja-JP"
      />,
    );
    // Name uses the id fallback; ID row also shows the id.
    const name = document.querySelector(".feature-details__name");
    expect(name?.textContent).toBe(featureId);
    expect(document.querySelector(".feature-details__id")?.textContent).toBe(featureId);
  });
});

describe("ViewerWarnings", () => {
  it("shows the warning count and messages in a disclosure", async () => {
    const user = userEvent.setup();
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

    render(<ViewerWarnings warnings={warnings} locale="en" />);

    const summary = screen.getByText("Warnings");
    expect(screen.getByLabelText("2").textContent).toBe("2");

    // Expand disclosure so list items are visible to users.
    await user.click(summary);
    expect(screen.getByText("missing_locale")).toBeTruthy();
    expect(screen.getByText("Feature lacks English label")).toBeTruthy();
    expect(screen.getByText("unresolved_reference")).toBeTruthy();
    expect(screen.getByText("Anchor not found")).toBeTruthy();
  });

  it("renders nothing when there are no warnings", () => {
    const { container } = render(<ViewerWarnings warnings={[]} locale="en" />);
    expect(container.firstChild).toBeNull();
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
