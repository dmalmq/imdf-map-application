import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ViewerLevel } from "../imdf/types";
import { SelectedFeatureContent } from "./SelectedFeatureContent";
import { ImdfDropzone } from "./ImdfDropzone";
import { LevelSwitcher } from "./LevelSwitcher";
import { ThemeSwitcher } from "./ThemeSwitcher";

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

const LEVEL_B1: ViewerLevel = {
  id: "b1000001-0000-4000-8000-0000000000b1",
  sourceLevelIds: ["b1000001-0000-4000-8000-0000000000b1"],
  ordinal: -1,
  label: { ja: "B1", en: "B1" },
  shortName: { ja: "B1", en: "B1" },
};

/** Descending ordinal order as normalizeVenue produces. */
const LEVELS_DESC: ViewerLevel[] = [LEVEL_2F, LEVEL_1F, LEVEL_B1];

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

describe("SelectedFeatureContent", () => {
  const content = {
    name: "Station Shop",
    description: "A convenient station shop.",
    category: "shopping",
    floor: "1F",
    hours: "Daily 09:00-21:00",
    accessibility: ["wheelchair"],
    phone: "+81 3 1234 5678",
    website: "https://example.com",
    image: { src: "/station-shop.jpg", alt: "Station Shop storefront" },
  };

  it("renders visitor content and secure contact actions without diagnostics", () => {
    render(<SelectedFeatureContent content={content} locale="en" onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "Station Shop" })).toBeTruthy();
    expect(screen.getByText("A convenient station shop.")).toBeTruthy();
    expect(screen.getByText("shopping")).toBeTruthy();
    expect(screen.getByText("1F")).toBeTruthy();
    expect(screen.getByText("Daily 09:00-21:00")).toBeTruthy();
    expect(screen.getByText("wheelchair")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Station Shop storefront" })).toBeTruthy();

    const phone = screen.getByRole("link", { name: "+81 3 1234 5678" });
    expect(phone.getAttribute("href")).toBe("tel:+81 3 1234 5678");
    const website = screen.getByRole("link", { name: "Website" });
    expect(website.getAttribute("href")).toBe("https://example.com");
    expect(website.getAttribute("target")).toBe("_blank");
    expect(website.getAttribute("rel")).toBe("noreferrer");

    expect(screen.queryByText("Type")).toBeNull();
    expect(screen.queryByText("ID")).toBeNull();
    expect(screen.queryByText("Restriction")).toBeNull();
  });

  it("omits missing rows and removes failed media without a placeholder", () => {
    const { rerender } = render(
      <SelectedFeatureContent
        content={{
          ...content,
          description: null,
          category: null,
          floor: null,
          hours: null,
          accessibility: [],
          phone: null,
          website: null,
        }}
        locale="en"
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText("Description")).toBeNull();
    expect(screen.queryByText("Category")).toBeNull();
    expect(screen.queryByText("Floor")).toBeNull();
    expect(screen.queryByText("Hours")).toBeNull();
    expect(screen.queryByText("Accessibility")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();

    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();

    rerender(
      <SelectedFeatureContent
        content={{ ...content, image: { src: "/another.jpg", alt: "Another place" } }}
        locale="en"
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("img", { name: "Another place" })).toBeTruthy();
  });

  it("calls onClose from the localized close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <SelectedFeatureContent content={{ ...content, image: null }} locale="en" onClose={onClose} />,
    );
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <SelectedFeatureContent content={{ ...content, image: null }} locale="ja" onClose={onClose} />,
    );
    expect(screen.getByRole("button", { name: "詳細を閉じる" })).toBeTruthy();
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
