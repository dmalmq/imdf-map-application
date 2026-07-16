import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GDB_MARKER_ICON_FILES,
  gdbMarkerIconId,
  registerGdbMarkerIcons,
} from "./gdbMarkerIcons";

describe("gdbMarkerIconId", () => {
  it("resolves allowlisted bare, relative, and absolute path forms to a local icon id", () => {
    expect(gdbMarkerIconId("locker.png")).toBe("gdb-icon:locker.png");
    expect(gdbMarkerIconId("marker/locker.png")).toBe("gdb-icon:locker.png");
    expect(gdbMarkerIconId("/marker/locker.png")).toBe("gdb-icon:locker.png");
    expect(gdbMarkerIconId("/icons/marker/locker.png")).toBe("gdb-icon:locker.png");
    expect(gdbMarkerIconId("bansen_01.png")).toBe("gdb-icon:bansen_01.png");
  });

  it("normalizes the final segment case and backslash separators", () => {
    expect(gdbMarkerIconId("LOCKER.PNG")).toBe("gdb-icon:locker.png");
    expect(gdbMarkerIconId("C:\\icons\\marker\\Ticket.png")).toBe("gdb-icon:ticket.png");
  });

  it("maps only the local basename, never fetching an external url", () => {
    // Basename is allowlisted -> safe local icon id; the external host is discarded.
    expect(gdbMarkerIconId("https://evil.example.com/locker.png")).toBe(
      "gdb-icon:locker.png",
    );
    // Basename is not allowlisted -> no icon, falls back to DOM/circle.
    expect(gdbMarkerIconId("https://evil.example.com/evil.png")).toBeNull();
  });

  it("rejects unknown names, empty values, and non-strings", () => {
    expect(gdbMarkerIconId("unknown.png")).toBeNull();
    expect(gdbMarkerIconId("")).toBeNull();
    expect(gdbMarkerIconId("   ")).toBeNull();
    expect(gdbMarkerIconId(null)).toBeNull();
    expect(gdbMarkerIconId(undefined)).toBeNull();
    expect(gdbMarkerIconId(42)).toBeNull();
    expect(gdbMarkerIconId({ image: "locker.png" })).toBeNull();
  });

  it("exposes exactly the 34-file allowlist", () => {
    expect(GDB_MARKER_ICON_FILES).toHaveLength(34);
    expect(new Set(GDB_MARKER_ICON_FILES).size).toBe(34);
    for (const filename of GDB_MARKER_ICON_FILES) {
      expect(gdbMarkerIconId(filename)).toBe(`gdb-icon:${filename}`);
    }
  });
});

interface FakeMap {
  added: Array<{ id: string; data: { width: number; height: number } }>;
  loadCalls: string[];
  loadImage(url: string): Promise<{ data: HTMLImageElement }>;
  hasImage(id: string): boolean;
  addImage(id: string, data: { width: number; height: number }): void;
}

function createFakeMap(preloaded: string[] = [], missing: Set<string> = new Set()): FakeMap {
  const images = new Set(preloaded);
  const added: FakeMap["added"] = [];
  const loadCalls: string[] = [];
  return {
    added,
    loadCalls,
    loadImage: async (url) => {
      loadCalls.push(url);
      if (missing.has(url)) {
        throw new Error(`missing ${url}`);
      }
      return { data: {} as HTMLImageElement };
    },
    hasImage: (id) => images.has(id),
    addImage: (id, data) => {
      images.add(id);
      added.push({ id, data });
    },
  };
}

const asMap = (map: FakeMap): MapLibreMap => map as unknown as MapLibreMap;

describe("registerGdbMarkerIcons", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        width: 32,
        height: 32,
        data: new Uint8ClampedArray(32 * 32 * 4),
      })),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rasterizes every allowlisted asset to 32x32 under its gdb-icon id", async () => {
    const map = createFakeMap();
    await registerGdbMarkerIcons(asMap(map));
    expect(map.added).toHaveLength(GDB_MARKER_ICON_FILES.length);
    for (const { id, data } of map.added) {
      expect(id.startsWith("gdb-icon:")).toBe(true);
      expect(data.width).toBe(32);
      expect(data.height).toBe(32);
    }
    expect(map.added.map((entry) => entry.id).sort()).toEqual(
      GDB_MARKER_ICON_FILES.map((f) => `gdb-icon:${f}`).sort(),
    );
  });

  it("skips an individually failing asset without failing the rest", async () => {
    const map = createFakeMap([], new Set(["/icons/marker/locker.png"]));
    await expect(registerGdbMarkerIcons(asMap(map))).resolves.toBeUndefined();
    expect(map.added).toHaveLength(GDB_MARKER_ICON_FILES.length - 1);
    expect(map.added.some((entry) => entry.id === "gdb-icon:locker.png")).toBe(false);
  });

  it("is idempotent for already-registered images", async () => {
    const map = createFakeMap(GDB_MARKER_ICON_FILES.map((f) => `gdb-icon:${f}`));
    await registerGdbMarkerIcons(asMap(map));
    expect(map.added).toHaveLength(0);
    // Preloaded ids short-circuit before any fetch/decode work.
    expect(map.loadCalls).toHaveLength(0);
  });

  it("adds nothing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const map = createFakeMap();
    await registerGdbMarkerIcons(asMap(map), controller.signal);
    expect(map.added).toHaveLength(0);
  });

  it("adds nothing when aborted before the async image loads resolve", async () => {
    const controller = new AbortController();
    const map = createFakeMap();
    const promise = registerGdbMarkerIcons(asMap(map), controller.signal);
    controller.abort();
    await promise;
    expect(map.added).toHaveLength(0);
  });
});
