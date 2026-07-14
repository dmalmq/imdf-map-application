import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import type { LoadedVenue, ViewerFeature } from "../imdf/types";
import { useSelectedFeaturePopup } from "./useSelectedFeaturePopup";

const popupMocks = vi.hoisted(() => {
  const instances: Array<{
    options: unknown;
    lngLat?: [number, number];
    node?: HTMLElement;
    map?: unknown;
    removed: boolean;
    close?: () => void;
  }> = [];
  return { instances };
});

vi.mock("maplibre-gl", () => ({
  Popup: class PopupMock {
    state: (typeof popupMocks.instances)[number];
    constructor(options: unknown) {
      this.state = { options, removed: false };
      popupMocks.instances.push(this.state);
    }
    setLngLat(value: [number, number]) {
      this.state.lngLat = value;
      return this;
    }
    setDOMContent(node: HTMLElement) {
      this.state.node = node;
      return this;
    }
    addTo(map: unknown) {
      this.state.map = map;
      if (this.state.node) document.body.append(this.state.node);
      return this;
    }
    on(event: string, callback: () => void) {
      if (event === "close") this.state.close = callback;
      return this;
    }
    remove() {
      this.state.removed = true;
      this.state.node?.remove();
      this.state.close?.();
      return this;
    }
  },
}));

function feature(id: string, center: [number, number] | null = [139.7, 35.6]): ViewerFeature {
  return {
    id,
    featureType: "occupant",
    levelId: "level-1",
    geometry: null,
    center,
    labels: { en: id },
    altLabels: {},
    category: "shop",
    accessibility: [],
    restriction: null,
    sourceProperties: {},
  };
}

function venue(features: ViewerFeature[]): LoadedVenue {
  const venueFeature = feature("venue", null);
  return {
    manifest: { version: "1.0.0", language: "en" },
    venue: venueFeature,
    levels: [],
    featuresById: new Map([[venueFeature.id, venueFeature], ...features.map((entry) => [entry.id, entry] as const)]),
    renderFeaturesByLevel: new Map(),
    searchEntries: [],
    boundsByLevel: new Map(),
    enrichmentByFeatureId: new Map(),
    warnings: [],
  };
}

function Harness({
  loaded,
  selectedFeatureId,
  compact = false,
  locale = "en",
  onClose = () => {},
}: {
  loaded: LoadedVenue;
  selectedFeatureId: string | null;
  compact?: boolean;
  locale?: "ja" | "en";
  onClose?: () => void;
}) {
  useSelectedFeaturePopup({
    map: {} as MapLibreMap,
    venue: loaded,
    selectedFeatureId,
    locale,
    compact,
    onClose,
  });
  return null;
}

describe("useSelectedFeaturePopup", () => {
  it("does not create popups for ineligible selections", () => {
    popupMocks.instances.length = 0;
    const loaded = venue([feature("centerless", null)]);
    const { rerender } = render(<Harness loaded={loaded} selectedFeatureId={null} />);
    rerender(<Harness loaded={loaded} selectedFeatureId="missing" />);
    rerender(<Harness loaded={loaded} selectedFeatureId="centerless" />);
    rerender(<Harness loaded={loaded} selectedFeatureId="centerless" compact />);
    expect(popupMocks.instances).toHaveLength(0);
  });

  it("anchors desktop content and replaces it on locale or selection changes", async () => {
    popupMocks.instances.length = 0;
    const loaded = venue([feature("one"), feature("two", [140, 36])]);
    const map = {} as MapLibreMap;
    function Direct({ id, locale }: { id: string; locale: "ja" | "en" }) {
      useSelectedFeaturePopup({ map, venue: loaded, selectedFeatureId: id, locale, compact: false, onClose: () => {} });
      return null;
    }
    const { rerender } = render(<Direct id="one" locale="en" />);
    await waitFor(() => expect(popupMocks.instances).toHaveLength(1));
    expect(popupMocks.instances[0]?.lngLat).toEqual([139.7, 35.6]);
    expect(popupMocks.instances[0]?.map).toBe(map);
    expect(popupMocks.instances[0]?.options).toMatchObject({ closeButton: false, focusAfterOpen: false, maxWidth: "360px", offset: 14 });

    rerender(<Direct id="one" locale="ja" />);
    await waitFor(() => expect(popupMocks.instances).toHaveLength(2));
    expect(popupMocks.instances[0]?.removed).toBe(true);
    rerender(<Direct id="two" locale="ja" />);
    await waitFor(() => expect(popupMocks.instances).toHaveLength(3));
    expect(popupMocks.instances[1]?.removed).toBe(true);
    expect(popupMocks.instances[2]?.lngLat).toEqual([140, 36]);
  });

  it("dispatches close once and cleans up the popup", async () => {
    popupMocks.instances.length = 0;
    const onClose = vi.fn();
    const { unmount } = render(<Harness loaded={venue([feature("one")])} selectedFeatureId="one" onClose={onClose} />);
    await screen.findByRole("button", { name: "Close details" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(popupMocks.instances[0]?.removed).toBe(true);
    unmount();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
