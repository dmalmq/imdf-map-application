import { describe, expect, it } from "vitest";
import { parseViewerEnrichment } from "./viewerEnrichment";

const FEATURE_ID = "a1000008-0000-4000-8000-0000000000c1";

describe("parseViewerEnrichment", () => {
  it("parses a valid version 1.0 entry with description, contact fields, and one image", () => {
    const result = parseViewerEnrichment({
      version: "1.0",
      features: {
        [FEATURE_ID]: {
          description: { en: "Concourse shop", ja: "コンコースショップ" },
          hours: "Mo-Fr 10:00-20:00",
          phone: "+81-3-1234-5678",
          website: "https://example.com/shop",
          images: [
            {
              src: "https://cdn.example.com/store.jpg",
              alt: { en: "Store interior", ja: "店舗内観" },
            },
          ],
        },
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.entries[FEATURE_ID]).toEqual({
      description: { en: "Concourse shop", ja: "コンコースショップ" },
      hours: "Mo-Fr 10:00-20:00",
      phone: "+81-3-1234-5678",
      website: "https://example.com/shop",
      images: [
        {
          src: "https://cdn.example.com/store.jpg",
          alt: { en: "Store interior", ja: "店舗内観" },
        },
      ],
    });
  });

  it("rejects enrichment when features exceed 5,000 entries", () => {
    const features: Record<string, { description: { en: string } }> = {};
    for (let index = 0; index < 5_001; index += 1) {
      features[`id-${index}`] = { description: { en: "x" } };
    }

    const result = parseViewerEnrichment({ version: "1.0", features });

    expect(result.entries).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("invalid_viewer_enrichment");
  });

  it("drops a feature key longer than 128 characters", () => {
    const longId = "a".repeat(129);
    const result = parseViewerEnrichment({
      version: "1.0",
      features: {
        [longId]: { description: { en: "too long key" } },
        [FEATURE_ID]: { description: { en: "kept" } },
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.entries[longId]).toBeUndefined();
    expect(result.entries[FEATURE_ID]?.description?.en).toBe("kept");
  });

  it("drops invalid optional fields and images while keeping a valid description", () => {
    const result = parseViewerEnrichment({
      version: "1.0",
      features: {
        [FEATURE_ID]: {
          description: { en: "Survives" },
          phone: "not a phone!",
          website: "http://insecure.example.com",
          images: [
            {
              src: "//cdn.example.com/protocol-relative.jpg",
              alt: { en: "ignored because of src" },
            },
          ],
        },
        "b1000008-0000-4000-8000-0000000000c2": {
          description: { en: "Also survives" },
          images: [{ src: "https://cdn.example.com/no-alt.jpg" }],
        },
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.entries[FEATURE_ID]).toEqual({
      description: { en: "Survives" },
    });
    expect(result.entries["b1000008-0000-4000-8000-0000000000c2"]).toEqual({
      description: { en: "Also survives" },
    });
  });

  it("ignores unknown top-level members", () => {
    const result = parseViewerEnrichment({
      version: "1.0",
      generatedAt: "2026-07-14T00:00:00Z",
      features: {
        [FEATURE_ID]: { hours: "Mo-Fr 09:00-18:00" },
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.entries[FEATURE_ID]).toEqual({ hours: "Mo-Fr 09:00-18:00" });
  });

  it("returns no entries and one diagnostic for an unsupported version", () => {
    const result = parseViewerEnrichment({
      version: "2.0",
      features: {
        [FEATURE_ID]: { description: { en: "ignored" } },
      },
    });

    expect(result.entries).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("invalid_viewer_enrichment");
  });

  it("accepts zero or one image and drops images when two are present", () => {
    const zero = parseViewerEnrichment({
      version: "1.0",
      features: {
        [FEATURE_ID]: {
          description: { en: "no images" },
          images: [],
        },
      },
    });
    expect(zero.warnings).toEqual([]);
    expect(zero.entries[FEATURE_ID]).toEqual({
      description: { en: "no images" },
      images: [],
    });

    const one = parseViewerEnrichment({
      version: "1.0",
      features: {
        [FEATURE_ID]: {
          description: { en: "one image" },
          images: [
            {
              src: "/media/store.jpg",
              alt: { en: "Store" },
            },
          ],
        },
      },
    });
    expect(one.warnings).toEqual([]);
    expect(one.entries[FEATURE_ID]?.images).toEqual([
      { src: "/media/store.jpg", alt: { en: "Store" } },
    ]);

    const two = parseViewerEnrichment({
      version: "1.0",
      features: {
        [FEATURE_ID]: {
          description: { en: "two images" },
          images: [
            {
              src: "https://cdn.example.com/a.jpg",
              alt: { en: "A" },
            },
            {
              src: "https://cdn.example.com/b.jpg",
              alt: { en: "B" },
            },
          ],
        },
      },
    });
    expect(two.warnings).toEqual([]);
    expect(two.entries[FEATURE_ID]).toEqual({
      description: { en: "two images" },
    });
    expect(two.entries[FEATURE_ID]?.images).toBeUndefined();
  });

  it("returns no entries and one diagnostic for a malformed top-level value", () => {
    const result = parseViewerEnrichment(null);
    expect(result.entries).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("invalid_viewer_enrichment");
  });
});
