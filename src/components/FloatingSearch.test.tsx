import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SearchCategory } from "../search/searchCategories";
import type { SearchResult } from "../imdf/types";
import { FloatingSearch } from "./FloatingSearch";

const results: SearchResult[] = Array.from({ length: 55 }, (_, index) => ({
  featureId: `feature-${index}`,
  featureType: "occupant",
  levelId: "level-1",
  label: `Place ${index}`,
  score: 100 - index,
}));

function Harness({
  initialValue = "",
  initialCategory = "all",
  currentFloorMatchCount = 3,
  onSelectResult = () => {},
  onCategoryChange,
}: {
  initialValue?: string;
  initialCategory?: SearchCategory;
  currentFloorMatchCount?: number;
  onSelectResult?: (result: SearchResult) => void;
  onCategoryChange?: (category: SearchCategory) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [category, setCategory] = useState<SearchCategory>(initialCategory);
  return (
    <FloatingSearch
      locale="en"
      value={value}
      category={category}
      results={results}
      selectedFeatureId={null}
      currentFloorMatchCount={currentFloorMatchCount}
      onValueChange={setValue}
      onCategoryChange={(next) => {
        setCategory(next);
        onCategoryChange?.(next);
      }}
      onSelectResult={onSelectResult}
      onOpenChange={() => {}}
    />
  );
}

describe("FloatingSearch", () => {
  it("implements combobox navigation and caps rendered options at 50", async () => {
    const user = userEvent.setup();
    const onSelectResult = vi.fn();
    render(<Harness onSelectResult={onSelectResult} />);

    const input = screen.getByRole("combobox", { name: "Search" });
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-controls")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("false");

    await user.type(input, "p");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox", { name: "Search results" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(50);

    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      within(listbox).getAllByRole("option")[0]?.id,
    );
    await user.keyboard("{Enter}");
    expect(onSelectResult).toHaveBeenCalledWith(results[0]);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape without clearing the controlled input", async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="station" />);
    const input = screen.getByRole("combobox", { name: "Search" });
    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect((input as HTMLInputElement).value).toBe("station");
  });

  it("shows a localized no-match state for a nonempty query without results", async () => {
    const user = userEvent.setup();
    const props = {
      value: "zzz",
      category: "all" as const,
      results: [],
      selectedFeatureId: null,
      currentFloorMatchCount: 0,
      onValueChange: () => {},
      onCategoryChange: () => {},
      onSelectResult: () => {},
      onOpenChange: () => {},
    };
    const { rerender } = render(<FloatingSearch locale="en" {...props} />);
    const input = screen.getByRole("combobox", { name: "Search" });
    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("No matching places")).toBeTruthy();

    rerender(<FloatingSearch locale="ja" {...props} />);
    expect(screen.getByText("一致する場所がありません")).toBeTruthy();
  });

  it("keeps input Escape from reaching document-level surface listeners", async () => {
    const user = userEvent.setup();
    const escapes: string[] = [];
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") escapes.push(event.key);
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    try {
      render(<Harness initialValue="station" />);
      const input = screen.getByRole("combobox", { name: "Search" });
      await user.click(input);
      await user.keyboard("{Escape}");
      expect(input.getAttribute("aria-expanded")).toBe("false");
      expect(escapes).toEqual([]);
    } finally {
      document.removeEventListener("keydown", onDocumentKeyDown);
    }
  });

  it("keeps empty All closed but opens empty focused-category results", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    const allInput = screen.getByRole("combobox", { name: "Search" });
    await user.click(allInput);
    expect(allInput.getAttribute("aria-expanded")).toBe("false");
    unmount();

    render(<Harness initialCategory="shops" />);
    const shopsInput = screen.getByRole("combobox", { name: "Search" });
    await user.click(shopsInput);
    expect(shopsInput.getAttribute("aria-expanded")).toBe("true");
  });

  it("coordinates category choices and the no-floor clear action", async () => {
    const user = userEvent.setup();
    const onCategoryChange = vi.fn();
    render(
      <Harness
        initialCategory="shops"
        currentFloorMatchCount={0}
        onCategoryChange={onCategoryChange}
      />,
    );

    expect(screen.getByText("No Shops on this floor")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onCategoryChange).toHaveBeenCalledWith("all");

    await user.click(screen.getByRole("button", { name: "Filter" }));
    const filters = screen.getByRole("group", { name: "Categories" });
    const facilities = within(filters).getByRole("button", { name: "Facilities" });
    expect(facilities.getAttribute("aria-pressed")).toBe("false");
    await user.click(facilities);
    expect(onCategoryChange).toHaveBeenLastCalledWith("facilities");
  });

  it("localizes search and filter control names", () => {
    const props = {
      value: "",
      category: "all" as const,
      results: [],
      selectedFeatureId: null,
      currentFloorMatchCount: 0,
      onValueChange: () => {},
      onCategoryChange: () => {},
      onSelectResult: () => {},
      onOpenChange: () => {},
    };
    const { rerender } = render(<FloatingSearch locale="en" {...props} />);
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();

    rerender(<FloatingSearch locale="ja" {...props} />);
    expect(screen.getByRole("button", { name: "検索" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "絞り込み" })).toBeTruthy();
  });
});
