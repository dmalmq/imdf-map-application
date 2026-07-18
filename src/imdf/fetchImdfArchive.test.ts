import { afterEach, describe, expect, it, vi } from "vitest";
import { VenueLoadError } from "../errors/VenueLoadError";
import { fetchImdfFile, fileNameFromSrc } from "./fetchImdfArchive";

const BASE = "https://viewer.test/";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fileNameFromSrc", () => {
  it("takes the last path segment and keeps an existing .zip suffix", () => {
    expect(fileNameFromSrc("https://cdn.example.com/venues/tokyo.zip", BASE)).toBe("tokyo.zip");
    expect(fileNameFromSrc("/venues/Tokyo.ZIP", BASE)).toBe("Tokyo.ZIP");
  });

  it("appends .zip when the name lacks it", () => {
    expect(fileNameFromSrc("https://cdn.example.com/venues/tokyo", BASE)).toBe("tokyo.zip");
  });

  it("ignores query strings", () => {
    expect(fileNameFromSrc("https://cdn.example.com/tokyo.zip?token=abc", BASE)).toBe("tokyo.zip");
  });

  it("uses the last non-empty segment for a trailing slash, venue.zip for root", () => {
    expect(fileNameFromSrc("https://cdn.example.com/venues/", BASE)).toBe("venues.zip");
    expect(fileNameFromSrc("https://cdn.example.com/", BASE)).toBe("venue.zip");
  });

  it("decodes percent-encoded segments", () => {
    expect(fileNameFromSrc("https://cdn.example.com/t%C5%8Dky%C5%8D%20eki.zip", BASE)).toBe(
      "tōkyō eki.zip",
    );
  });
});

describe("fetchImdfFile", () => {
  it("returns a File named from the URL on success", async () => {
    const blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]);
    const response = { ok: true, status: 200, blob: vi.fn().mockResolvedValue(blob) } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const file = await fetchImdfFile("https://cdn.example.com/venues/tokyo");
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("tokyo.zip");
    expect(file.type).toBe("application/zip");
    expect(file.size).toBe(4);
  });

  it("throws VenueLoadError fetch_failed on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const error = await fetchImdfFile("https://cdn.example.com/missing.zip").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VenueLoadError);
    expect((error as VenueLoadError).code).toBe("fetch_failed");
    expect((error as VenueLoadError).details).toMatchObject({ status: 404 });
  });

  it("throws VenueLoadError fetch_failed on network rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = await fetchImdfFile("https://cdn.example.com/venue.zip").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VenueLoadError);
    expect((error as VenueLoadError).code).toBe("fetch_failed");
  });

  it("throws VenueLoadError fetch_failed when reading the body fails", async () => {
    const response = {
      ok: true,
      status: 200,
      blob: vi.fn().mockRejectedValue(new TypeError("body stream error")),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const error = await fetchImdfFile("https://cdn.example.com/venue.zip").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VenueLoadError);
    expect((error as VenueLoadError).code).toBe("fetch_failed");
  });

  it("rethrows AbortError unchanged", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    const error = await fetchImdfFile("https://cdn.example.com/venue.zip").catch((e: unknown) => e);
    expect(error).toBe(abort);
  });
});
