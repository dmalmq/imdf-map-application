import { act, render } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { createElement } from "react";
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedVenue, ViewerFeature } from "../imdf/types";
import { themes } from "../theme/presets";
import { IndoorMap, registerIconsThenLoad, revealOffset, selectionRevealOffset } from "./IndoorMap";

interface FakeMapHandle {
  setData: Mock;
  easeTo: Mock;
  fire(event: string, payload?: unknown): void;
}

const iconGate = vi.hoisted(() => ({
  state: { resolve: null as null | (() => void), calls: 0 },
}));
const mapHolder = vi.hoisted(() => ({ instance: null as unknown as FakeMapHandle }));

vi.mock("./gdbMarkerIcons", () => ({
  GDB_MARKER_ICON_FILES: [],
  gdbMarkerIconId: () => null,
  registerGdbMarkerIcons: () => {
    iconGate.state.calls++;
    // ES2022 lib lacks Promise.withResolvers; executor captures the resolver.
    return new Promise<void>((resolve) => {
      iconGate.state.resolve = resolve;
    });
  },
}));

vi.mock("./useFeatureMarkers", () => ({ useFeatureMarkers: () => {} }));
vi.mock("./useSelectedFeaturePopup", () => ({ useSelectedFeaturePopup: () => {} }));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    setData = vi.fn();
    #handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    #styleLoaded = false;
    touchZoomRotate = { disableRotation: () => {} };
    constructor() {
      mapHolder.instance = this as unknown as FakeMapHandle;
    }
    addControl() {
      return this;
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      const list = this.#handlers.get(event) ?? [];
      list.push(handler);
      this.#handlers.set(event, list);
      return this;
    }
    off() {
      return this;
    }
    fire(event: string, payload?: unknown) {
      if (event === "load") this.#styleLoaded = true;
      for (const handler of this.#handlers.get(event) ?? []) handler(payload);
    }
    isStyleLoaded() {
      return this.#styleLoaded;
    }
    getSource() {
      return { type: "geojson", setData: this.setData };
    }
    setFeatureState() {}
    removeFeatureState() {}
    queryRenderedFeatures() {
      return [];
    }
    getCanvas() {
      return { style: {} };
    }
    getCanvasContainer() {
      return document.createElement("div");
    }
    fitBounds() {}
    setPadding() {}
    easeTo = vi.fn();
    project() {
      return { x: 0, y: 0 };
    }
    getLayer() {
      return {};
    }
    setPaintProperty() {}
    remove() {}
  }
  return {
    default: {
      Map: FakeMap,
      AttributionControl: class {},
      NavigationControl: class {},
    },
  };
});

const viewport = { width: 500, height: 400 };
const padding = { top: 10, right: 20, bottom: 30, left: 40 };

describe("selection camera reveal", () => {
  it("does not move an already-visible selected point", () => {
    expect(revealOffset({ x: 250, y: 200 }, viewport, padding, 16)).toBeNull();
  });

  it("returns only the signed overflow needed to reveal an off-screen point", () => {
    expect(revealOffset({ x: 20, y: 390 }, viewport, padding, 16)).toEqual([-36, 36]);
    expect(revealOffset({ x: 490, y: 5 }, viewport, padding, 16)).toEqual([26, -21]);
  });

  it("skips desktop selection adjustment in compact mode", () => {
    expect(selectionRevealOffset(true, { x: 20, y: 390 }, viewport, padding, 16)).toBeNull();
    expect(selectionRevealOffset(false, { x: 20, y: 390 }, viewport, padding, 16)).toEqual([
      -36,
      36,
    ]);
  });
});

describe("registerIconsThenLoad", () => {
  const asMap = (value: object): MapLibreMap => value as unknown as MapLibreMap;

  it("commits source data only after icon registration resolves", async () => {
    const order: string[] = [];
    const map = asMap({});
    const register = vi.fn(async (received: MapLibreMap) => {
      expect(received).toBe(map);
      order.push("register");
    });
    const commit = vi.fn(() => {
      order.push("commit");
    });

    await registerIconsThenLoad(map, register, new AbortController().signal, commit);

    expect(order).toEqual(["register", "commit"]);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("passes the abort signal to the registrar", async () => {
    const controller = new AbortController();
    const register = vi.fn(async () => {});
    await registerIconsThenLoad(asMap({}), register, controller.signal, () => {});
    expect(register).toHaveBeenCalledWith(expect.anything(), controller.signal);
  });

  it("never touches the removed map when aborted during registration", async () => {
    const controller = new AbortController();
    const commit = vi.fn();
    const register = vi.fn(async () => {
      controller.abort();
    });

    await registerIconsThenLoad(asMap({}), register, controller.signal, commit);

    expect(commit).not.toHaveBeenCalled();
  });
});

function makeVenue(level: string, needsIcon: boolean): LoadedVenue {
  const venueFeature: ViewerFeature = {
    id: "venue",
    featureType: "venue",
    levelId: null,
    geometry: { type: "Point", coordinates: [0, 0] },
    center: [0, 0],
    labels: {},
    altLabels: {},
    category: null,
    accessibility: [],
    restriction: null,
    buildingId: null,
    sourceProperties: {},
  };
  const properties: Record<string, unknown> = { __feature_id: `feat-${level}` };
  if (needsIcon) {
    properties["__marker_icon"] = "gdb-icon:locker.png";
  }
  return {
    manifest: { version: "1.0.0", language: "ja" },
    venue: venueFeature,
    levels: [],
    buildings: [],
    featuresById: new Map([["venue", venueFeature]]),
    renderFeaturesByLevel: new Map([
      [
        level,
        {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: `feat-${level}`,
              geometry: { type: "Point", coordinates: [0, 0] },
              properties,
            },
          ],
        },
      ],
    ]),
    searchEntries: [],
    boundsByLevel: new Map([[level, [0, 0, 1, 1]]]),
    enrichmentByFeatureId: new Map(),
    warnings: [],
  };
}

describe("lazy marker-icon registration", () => {
  const props = (venue: LoadedVenue, levelId: string) => ({
    venue,
    levelId,
    selectedFeatureId: null,
    locale: "ja" as const,
    theme: themes["tokyo-green"],
    searchCategory: "all" as const,
    compact: false,
    bottomPadding: 0,
    onSelectFeature: () => {},
  });

  beforeEach(() => {
    iconGate.state.resolve = null;
    iconGate.state.calls = 0;
  });

  it("commits an IMDF-only venue immediately with zero icon registrations", async () => {
    const { unmount } = render(createElement(IndoorMap, props(makeVenue("L0", false), "L0")));
    await act(async () => {});
    const map = mapHolder.instance;
    await act(async () => {
      map.fire("load");
    });
    expect(iconGate.state.calls).toBe(0);
    expect(map.setData).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("registers icons then commits for an icon-backed venue", async () => {
    const { unmount } = render(createElement(IndoorMap, props(makeVenue("L0", true), "L0")));
    await act(async () => {});
    const map = mapHolder.instance;
    await act(async () => {
      map.fire("load");
    });
    // Registration pending: not committed yet.
    expect(iconGate.state.calls).toBe(1);
    expect(map.setData).not.toHaveBeenCalled();
    await act(async () => {
      iconGate.state.resolve?.();
    });
    expect(map.setData).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("commits only the latest venue when swapped during a pending registration", async () => {
    const venueA = makeVenue("L0", true);
    const { rerender, unmount } = render(createElement(IndoorMap, props(venueA, "L0")));
    await act(async () => {});
    const map = mapHolder.instance;
    await act(async () => {
      map.fire("load");
    });
    expect(iconGate.state.calls).toBe(1);
    expect(map.setData).not.toHaveBeenCalled();

    // Swap to a newer icon venue while registration is pending.
    rerender(createElement(IndoorMap, props(makeVenue("L1", true), "L1")));
    await act(async () => {});
    expect(iconGate.state.calls).toBe(1); // no second registration
    expect(map.setData).not.toHaveBeenCalled();

    await act(async () => {
      iconGate.state.resolve?.();
    });
    expect(map.setData).toHaveBeenCalledTimes(1);
    const committed = map.setData.mock.calls[0]![0] as GeoJSON.FeatureCollection;
    const ids = committed.features.map((feature) => feature.id);
    expect(ids).toContain("feat-L1");
    expect(ids).not.toContain("feat-L0");
    unmount();
  });

  it("aborts a pending registration on unmount without committing", async () => {
    const { unmount } = render(createElement(IndoorMap, props(makeVenue("L0", true), "L0")));
    await act(async () => {});
    const map = mapHolder.instance;
    await act(async () => {
      map.fire("load");
    });
    expect(map.setData).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      iconGate.state.resolve?.();
    });
    expect(map.setData).not.toHaveBeenCalled();
  });

  it("registers lazily when a GDB venue replaces an IMDF venue via the change effect", async () => {
    const { rerender, unmount } = render(createElement(IndoorMap, props(makeVenue("L0", false), "L0")));
    await act(async () => {});
    const map = mapHolder.instance;
    await act(async () => {
      map.fire("load");
    });
    // IMDF committed immediately, no registration.
    expect(iconGate.state.calls).toBe(0);
    expect(map.setData).toHaveBeenCalledTimes(1);

    // A GDB venue arrives: the change effect registers icons before committing.
    rerender(createElement(IndoorMap, props(makeVenue("Lgdb", true), "Lgdb")));
    await act(async () => {});
    expect(iconGate.state.calls).toBe(1);
    expect(map.setData).toHaveBeenCalledTimes(1); // not committed until icons ready

    await act(async () => {
      iconGate.state.resolve?.();
    });
    expect(map.setData).toHaveBeenCalledTimes(2);
    const committed = map.setData.mock.calls[1]![0] as GeoJSON.FeatureCollection;
    expect(committed.features.map((feature) => feature.id)).toContain("feat-Lgdb");
    unmount();
  });
});

describe("map interaction hooks", () => {
  const baseProps = (
    venue: LoadedVenue,
    levelId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    venue,
    levelId,
    selectedFeatureId: null,
    locale: "ja" as const,
    theme: themes["tokyo-green"],
    searchCategory: "all" as const,
    compact: false,
    bottomPadding: 0,
    onSelectFeature: () => {},
    ...overrides,
  });

  it("reports the clicked coordinate and suppresses selection when onMapClick is set", async () => {
    const onMapClick = vi.fn();
    const onSelectFeature = vi.fn();
    const { unmount } = render(
      createElement(
        IndoorMap,
        baseProps(makeVenue("L0", false), "L0", { onMapClick, onSelectFeature }),
      ),
    );
    await act(async () => {});
    const map = mapHolder.instance;
    await act(async () => {
      map.fire("load");
    });
    await act(async () => {
      map.fire("click", {
        point: { x: 10, y: 20 },
        lngLat: { lng: 139.76, lat: 35.68 },
      });
    });
    expect(onMapClick).toHaveBeenCalledTimes(1);
    expect(onMapClick).toHaveBeenCalledWith([139.76, 35.68]);
    expect(onSelectFeature).not.toHaveBeenCalled();
    unmount();
  });

  it("selects features normally when onMapClick is absent", async () => {
    const onSelectFeature = vi.fn();
    const { unmount } = render(
      createElement(IndoorMap, baseProps(makeVenue("L0", false), "L0", { onSelectFeature })),
    );
    await act(async () => {});
    const map = mapHolder.instance;
    await act(async () => {
      map.fire("load");
    });
    await act(async () => {
      map.fire("click", {
        point: { x: 10, y: 20 },
        lngLat: { lng: 139.76, lat: 35.68 },
      });
    });
    expect(onSelectFeature).toHaveBeenCalledTimes(1);
    expect(onSelectFeature).toHaveBeenCalledWith(null);
    unmount();
  });

  it("eases the camera once per new flyTo token and not for a repeated token", async () => {
    const venue = makeVenue("L0", false);
    const { rerender, unmount } = render(
      createElement(
        IndoorMap,
        baseProps(venue, "L0", { flyTo: { lngLat: [139.7, 35.6], token: 1 } }),
      ),
    );
    await act(async () => {});
    const map = mapHolder.instance;
    await act(async () => {
      map.fire("load");
    });
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    expect(map.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [139.7, 35.6] }),
    );

    // Same token, new object identity: no additional fly.
    rerender(
      createElement(
        IndoorMap,
        baseProps(venue, "L0", { flyTo: { lngLat: [139.7, 35.6], token: 1 } }),
      ),
    );
    await act(async () => {});
    expect(map.easeTo).toHaveBeenCalledTimes(1);

    // New token: fly again.
    rerender(
      createElement(
        IndoorMap,
        baseProps(venue, "L0", { flyTo: { lngLat: [140.1, 36.2], token: 2 } }),
      ),
    );
    await act(async () => {});
    expect(map.easeTo).toHaveBeenCalledTimes(2);
    expect(map.easeTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [140.1, 36.2] }),
    );
    unmount();
  });

  it("does not ease when flyTo is null", async () => {
    const venue = makeVenue("L0", false);
    const { unmount } = render(
      createElement(IndoorMap, baseProps(venue, "L0", { flyTo: null })),
    );
    await act(async () => {});
    const map = mapHolder.instance;
    await act(async () => {
      map.fire("load");
    });
    expect(map.easeTo).not.toHaveBeenCalled();
    unmount();
  });
});

describe("IndoorMap visibility filtering", () => {
  const baseProps = (
    venue: LoadedVenue,
    levelId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    venue,
    levelId,
    selectedFeatureId: null,
    locale: "ja" as const,
    theme: themes["tokyo-green"],
    searchCategory: "all" as const,
    compact: false,
    bottomPadding: 0,
    onSelectFeature: () => {},
    ...overrides,
  });

  it("filters the source data by visibility selection", async () => {
    const venue = makeVenue("L0", false);
    const collection = venue.renderFeaturesByLevel.get("L0")!;
    collection.features.push({
      type: "Feature",
      id: "unit-1",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      properties: {
        __feature_id: "unit-1",
        __feature_type: "unit",
        __level_id: "L0",
        __category: "room",
        __restricted: false,
        __building_id: "b1",
      },
    });

    const { unmount } = render(
      createElement(
        IndoorMap,
        baseProps(venue, "L0", {
          visibility: { hiddenTypes: new Set(["unit"]), hiddenBuildings: new Set() },
        }),
      ),
    );
    await act(async () => {});
    const map = mapHolder.instance;
    await act(async () => {
      map.fire("load");
    });

    expect(map.setData).toHaveBeenCalled();
    const last = map.setData.mock.calls[map.setData.mock.calls.length - 1]![0] as GeoJSON.FeatureCollection;
    const types = last.features.map((feature) => feature.properties?.["__feature_type"]);
    expect(types).not.toContain("unit");
    expect(types).toContain("venue");
    unmount();
  });
});
