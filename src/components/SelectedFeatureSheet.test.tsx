import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedFeatureContent } from "./resolveSelectedFeatureContent";
import { SelectedFeatureSheet } from "./SelectedFeatureSheet";

let resizeCallback: ResizeObserverCallback | null = null;
class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const content: ResolvedFeatureContent = {
  name: "Station Shop",
  description: "Compact details",
  category: "shop",
  floor: "1F",
  hours: "Daily",
  accessibility: [],
  phone: null,
  website: null,
  image: null,
  sourceAttributes: null,
  provenance: null,
};

afterEach(() => {
  resizeCallback = null;
  vi.unstubAllGlobals();
});

describe("SelectedFeatureSheet", () => {
  it("renders shared content, reports height, and closes selection", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const onHeightChange = vi.fn();
    const onClose = vi.fn();
    const markerRoot = document.createElement("div");
    const marker = document.createElement("button");
    marker.dataset.featureId = "shop-1";
    markerRoot.append(marker);
    document.body.append(markerRoot);
    onClose.mockImplementation(() => {
      expect(document.activeElement).toBe(marker);
    });
    render(
      <SelectedFeatureSheet
        content={content}
        selectedFeatureId="shop-1"
        markerRoot={markerRoot}
        locale="en"
        onClose={onClose}
        onHeightChange={onHeightChange}
      />,
    );

    expect(screen.getByRole("heading", { name: "Station Shop" })).toBeTruthy();
    expect(screen.getByText("Compact details")).toBeTruthy();
    const sheet = document.querySelector<HTMLElement>(".selected-feature-sheet");
    expect(sheet).not.toBeNull();
    resizeCallback?.(
      [{ target: sheet!, contentRect: { height: 240 } } as unknown as ResizeObserverEntry],
      {} as ResizeObserver,
    );
    expect(onHeightChange).toHaveBeenCalledWith(240);

    await userEvent.setup().click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(marker);
    markerRoot.remove();
  });

  it("provides a bounded internal scroll region", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    render(
      <SelectedFeatureSheet
        content={content}
        selectedFeatureId="shop-1"
        locale="en"
        onClose={() => {}}
        onHeightChange={() => {}}
      />,
    );
    expect(document.querySelector(".selected-feature-sheet__scroll")).not.toBeNull();
  });

  it("closes on Escape only when no search dropdown or menu is open", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SelectedFeatureSheet
        content={content}
        selectedFeatureId="shop-1"
        locale="en"
        onClose={onClose}
        onHeightChange={() => {}}
      />,
    );

    const transient = document.createElement("div");
    transient.className = "floating-search__dropdown";
    document.body.append(transient);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    transient.remove();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
