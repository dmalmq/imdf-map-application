import { describe, expect, it } from "vitest";
import type { FeatureType, SearchEntry } from "../imdf/types";
import { normalizeSearchText } from "./normalizeSearchText";
import { searchVenue, type SearchQuery } from "./searchVenue";

function entry(partial: {
  featureId: string;
  featureType?: FeatureType;
  levelId?: string | null;
  category?: string | null;
  labels?: Record<string, string>;
  altLabels?: Record<string, string>;
  normalizedLabels?: string[];
  normalizedAltLabels?: string[];
  normalizedCategory?: string;
}): SearchEntry {
  const labels = partial.labels ?? { en: partial.featureId };
  const altLabels = partial.altLabels ?? {};
  const category = partial.category ?? null;
  return {
    featureId: partial.featureId,
    featureType: partial.featureType ?? "unit",
    levelId: partial.levelId === undefined ? "level-1" : partial.levelId,
    category,
    labels,
    altLabels,
    normalizedLabels: partial.normalizedLabels ?? Object.values(labels).map(normalizeSearchText),
    normalizedAltLabels:
      partial.normalizedAltLabels ?? Object.values(altLabels).map(normalizeSearchText),
    normalizedCategory:
      partial.normalizedCategory ?? (category === null ? "" : normalizeSearchText(category)),
  };
}

function query(partial: Partial<SearchQuery> & { text: string }): SearchQuery {
  return {
    text: partial.text,
    category: partial.category ?? "all",
    locale: partial.locale ?? "en",
    levelId: partial.levelId === undefined ? null : partial.levelId,
  };
}

describe("normalizeSearchText (public behavior)", () => {
  it("applies NFKC, lowercases Latin, and collapses whitespace", () => {
    expect(normalizeSearchText("ＡＢＣ")).toBe("abc");
    expect(normalizeSearchText("Shop  Name")).toBe("shop name");
    expect(normalizeSearchText("  café  ")).toBe("café");
    // Full-width katakana → half-width under NFKC, then compared as-is (no Latin lowercasing needed).
    expect(normalizeSearchText("カタカナ")).toBe("カタカナ");
    expect(normalizeSearchText("ｶﾀｶﾅ")).toBe("カタカナ");
    expect(normalizeSearchText("ＡＢＣ\t\n  ＤＥＦ")).toBe("abc def");
  });

  it("is applied to query text so full-width input matches normalized labels", () => {
    const entries = [entry({ featureId: "a", labels: { en: "ABC Shop" }, normalizedLabels: ["abc shop"] })];
    const results = searchVenue(entries, query({ text: "ＡＢＣ Ｓｈｏｐ" }));
    expect(results).toHaveLength(1);
    expect(results[0]?.score).toBe(500);
  });
});

describe("searchVenue scoring", () => {
  it("returns exact integer scores for each match tier", () => {
    const entries = [
      entry({
        featureId: "exact-primary",
        labels: { en: "Station Gate" },
        normalizedLabels: ["station gate"],
      }),
      entry({
        featureId: "exact-alt",
        labels: { en: "Other" },
        altLabels: { en: "Station Gate" },
        normalizedLabels: ["other"],
        normalizedAltLabels: ["station gate"],
      }),
      entry({
        featureId: "prefix-primary",
        labels: { en: "Station Gate North" },
        normalizedLabels: ["station gate north"],
      }),
      entry({
        featureId: "prefix-alt",
        labels: { en: "Other" },
        altLabels: { en: "Station Gate North" },
        normalizedLabels: ["other"],
        normalizedAltLabels: ["station gate north"],
      }),
      entry({
        featureId: "substr-primary",
        labels: { en: "Main Station Gate Area" },
        normalizedLabels: ["main station gate area"],
      }),
      entry({
        featureId: "substr-alt",
        labels: { en: "Other" },
        altLabels: { en: "Main Station Gate Area" },
        normalizedLabels: ["other"],
        normalizedAltLabels: ["main station gate area"],
      }),
      entry({
        featureId: "category-hit",
        labels: { en: "Unrelated" },
        category: "station gate service",
        normalizedLabels: ["unrelated"],
        normalizedCategory: "station gate service",
      }),
      entry({
        featureId: "feature-type-hit",
        featureType: "opening",
        labels: { en: "Unrelated" },
        normalizedLabels: ["unrelated"],
        normalizedCategory: "",
      }),
    ];

    const byId = Object.fromEntries(
      searchVenue(entries, query({ text: "station gate", levelId: null })).map((r) => [
        r.featureId,
        r.score,
      ]),
    );

    expect(byId["exact-primary"]).toBe(500);
    expect(byId["exact-alt"]).toBe(450);
    expect(byId["prefix-primary"]).toBe(400);
    expect(byId["prefix-alt"]).toBe(350);
    expect(byId["substr-primary"]).toBe(300);
    expect(byId["substr-alt"]).toBe(250);
    expect(byId["category-hit"]).toBe(200);

    const typeHit = searchVenue(
      [
        entry({
          featureId: "feature-type-hit",
          featureType: "opening",
          labels: { en: "Unrelated" },
          normalizedLabels: ["unrelated"],
        }),
      ],
      query({ text: "opening", levelId: null }),
    );
    expect(typeHit).toHaveLength(1);
    expect(typeHit[0]?.score).toBe(200);
  });

  it("adds exactly +20 when entry.levelId matches query.levelId", () => {
    const entries = [
      entry({
        featureId: "on-level",
        levelId: "L1",
        labels: { en: "Cafe" },
        normalizedLabels: ["cafe"],
      }),
      entry({
        featureId: "off-level",
        levelId: "L2",
        labels: { en: "Cafe" },
        normalizedLabels: ["cafe"],
      }),
    ];
    const results = searchVenue(entries, query({ text: "cafe", levelId: "L1" }));
    const byId = Object.fromEntries(results.map((r) => [r.featureId, r.score]));
    expect(byId["on-level"]).toBe(520);
    expect(byId["off-level"]).toBe(500);
  });

  it("matches short_name values through normalizedAltLabels at 450/350/250", () => {
    const entries = [
      entry({
        featureId: "short-exact",
        labels: { en: "Long Name" },
        normalizedLabels: ["long name"],
        normalizedAltLabels: ["sg"],
      }),
      entry({
        featureId: "short-prefix",
        labels: { en: "Long Name" },
        normalizedLabels: ["long name"],
        normalizedAltLabels: ["sgwest"],
      }),
      entry({
        featureId: "short-substr",
        labels: { en: "Long Name" },
        normalizedLabels: ["long name"],
        normalizedAltLabels: ["the sg store"],
      }),
    ];
    const byId = Object.fromEntries(
      searchVenue(entries, query({ text: "sg", levelId: null })).map((r) => [r.featureId, r.score]),
    );
    expect(byId["short-exact"]).toBe(450);
    expect(byId["short-prefix"]).toBe(350);
    expect(byId["short-substr"]).toBe(250);
  });
});

describe("searchVenue category filters", () => {
  const catalog = [
    entry({
      featureId: "ped-gate",
      featureType: "opening",
      category: "pedestrian.gate",
      labels: { en: "Ped Gate" },
    }),
    entry({
      featureId: "service-door",
      featureType: "opening",
      category: "service",
      labels: { en: "Service" },
    }),
    entry({
      featureId: "shop-a",
      featureType: "occupant",
      category: "shopping",
      labels: { en: "Shop A" },
    }),
    entry({
      featureId: "amenity-a",
      featureType: "amenity",
      category: "restroom",
      labels: { en: "Restroom" },
    }),
    entry({
      featureId: "kiosk-a",
      featureType: "kiosk",
      category: "information",
      labels: { en: "Info Kiosk" },
    }),
    entry({
      featureId: "unit-a",
      featureType: "unit",
      category: "room",
      labels: { en: "Room" },
    }),
  ];

  const typedCatalog = [
    entry({
      featureId: "ped-gate",
      featureType: "opening",
      category: "pedestrian.gate",
      labels: { en: "Shared Token Ped" },
    }),
    entry({
      featureId: "shop-a",
      featureType: "occupant",
      category: "shopping",
      labels: { en: "Shared Token Shop" },
    }),
    entry({
      featureId: "amenity-a",
      featureType: "amenity",
      category: "restroom",
      labels: { en: "Shared Token Amenity" },
    }),
    entry({
      featureId: "kiosk-a",
      featureType: "kiosk",
      category: "information",
      labels: { en: "Shared Token Kiosk" },
    }),
    entry({
      featureId: "unit-a",
      featureType: "unit",
      category: "room",
      labels: { en: "Shared Token Unit" },
    }),
  ];

  it("filters gates to openings whose category starts with pedestrian", () => {
    const results = searchVenue(catalog, query({ text: "", category: "gates", levelId: null }));
    expect(results.map((r) => r.featureId)).toEqual(["ped-gate"]);
  });

  it("filters shops to occupants only", () => {
    const results = searchVenue(catalog, query({ text: "", category: "shops", levelId: null }));
    expect(results.map((r) => r.featureId)).toEqual(["shop-a"]);
  });

  it("filters facilities to amenities and kiosks", () => {
    const results = searchVenue(catalog, query({ text: "", category: "facilities", levelId: null }));
    expect(results.map((r) => r.featureId).sort()).toEqual(["amenity-a", "kiosk-a"]);
  });

  it("includes every indexed type under all when text matches", () => {
    const results = searchVenue(typedCatalog, query({ text: "shared token", category: "all", levelId: null }));
    const ids = new Set(results.map((r) => r.featureId));
    expect(ids.has("ped-gate")).toBe(true);
    expect(ids.has("shop-a")).toBe(true);
    expect(ids.has("amenity-a")).toBe(true);
    expect(ids.has("kiosk-a")).toBe(true);
    expect(ids.has("unit-a")).toBe(true);
  });
});

describe("searchVenue empty-query behavior", () => {
  it("returns [] for empty text with category all", () => {
    const entries = [
      entry({ featureId: "a", featureType: "occupant", labels: { en: "A" } }),
      entry({ featureId: "b", featureType: "amenity", labels: { en: "B" } }),
    ];
    expect(searchVenue(entries, query({ text: "", category: "all", levelId: "L1" }))).toEqual([]);
    expect(searchVenue(entries, query({ text: "   ", category: "all", levelId: "L1" }))).toEqual([]);
  });

  it("returns category list sorted current-level first, then label, then id", () => {
    const entries = [
      entry({
        featureId: "z-other",
        featureType: "occupant",
        levelId: "L2",
        labels: { en: "Zulu" },
      }),
      entry({
        featureId: "b-on",
        featureType: "occupant",
        levelId: "L1",
        labels: { en: "Bravo" },
      }),
      entry({
        featureId: "a-on",
        featureType: "occupant",
        levelId: "L1",
        labels: { en: "Alpha" },
      }),
      entry({
        featureId: "a-other",
        featureType: "occupant",
        levelId: "L2",
        labels: { en: "Alpha" },
      }),
      entry({
        featureId: "a-on-2",
        featureType: "occupant",
        levelId: "L1",
        labels: { en: "Alpha" },
      }),
    ];
    const results = searchVenue(entries, query({ text: "", category: "shops", levelId: "L1" }));
    expect(results.map((r) => r.featureId)).toEqual([
      "a-on",
      "a-on-2",
      "b-on",
      "a-other",
      "z-other",
    ]);
  });
});

describe("searchVenue ties and cap", () => {
  it("breaks equal scores by code-point label order then feature id", () => {
    const entries = [
      entry({
        featureId: "id-b",
        labels: { en: "Same" },
        normalizedLabels: ["same"],
        levelId: "L1",
      }),
      entry({
        featureId: "id-a",
        labels: { en: "Same" },
        normalizedLabels: ["same"],
        levelId: "L1",
      }),
      entry({
        featureId: "id-c",
        labels: { en: "Other" },
        normalizedLabels: ["same"],
        levelId: "L1",
      }),
    ];
    // levelId null on query so no boost; all scores stay exactly 500.
    // localizedLabel for en: "Same", "Same", "Other" — label order first, then id.
    // "Other" < "Same", so id-c first; then id-a before id-b.
    const results = searchVenue(entries, query({ text: "same", levelId: null }));
    expect(results.map((r) => r.featureId)).toEqual(["id-c", "id-a", "id-b"]);
    expect(results.every((r) => r.score === 500)).toBe(true);
  });

  it("caps results at 50", () => {
    const entries = Array.from({ length: 80 }, (_, i) =>
      entry({
        featureId: `f-${String(i).padStart(3, "0")}`,
        labels: { en: `Item ${i}` },
        normalizedLabels: [`item ${i}`, "common"],
      }),
    );
    const results = searchVenue(entries, query({ text: "common", levelId: null }));
    expect(results).toHaveLength(50);
  });
});

describe("searchVenue 10k benchmark", () => {
  it("completes 100 deterministic queries under 100ms P95 after 10 warm-ups", () => {
    // Seeded LCG — no Math.random. Deterministic 10,000 entries + 100 queries.
    let seed = 0x1a2b3c4d;
    function next(): number {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    }

    const labels = ["cafe", "shop", "gate", "restroom", "kiosk", "ticket", "locker", "pharmacy"];
    const entries: SearchEntry[] = Array.from({ length: 10_000 }, (_, i) => {
      const n = next();
      const label = labels[n % labels.length] ?? "cafe";
      const name = `${label} ${i}`;
      const featureType: FeatureType =
        n % 5 === 0 ? "occupant" : n % 5 === 1 ? "amenity" : n % 5 === 2 ? "opening" : n % 5 === 3 ? "kiosk" : "unit";
      return entry({
        featureId: `feat-${String(i).padStart(5, "0")}`,
        featureType,
        levelId: `level-${n % 3}`,
        category: featureType === "opening" ? "pedestrian.gate" : label,
        labels: { en: name, ja: name },
        normalizedLabels: [normalizeSearchText(name)],
        normalizedAltLabels: n % 7 === 0 ? [normalizeSearchText(`${label}-alt`)] : [],
        normalizedCategory: normalizeSearchText(featureType === "opening" ? "pedestrian.gate" : label),
      });
    });

    const queries: SearchQuery[] = Array.from({ length: 100 }, (_, i) => {
      const n = next();
      const text = labels[n % labels.length] ?? "cafe";
      const categories = ["all", "gates", "shops", "facilities"] as const;
      return query({
        text: i % 11 === 0 ? "" : text,
        category: categories[n % categories.length] ?? "all",
        levelId: `level-${n % 3}`,
        locale: n % 2 === 0 ? "en" : "ja",
      });
    });

    for (let i = 0; i < 10; i++) {
      searchVenue(entries, queries[i % queries.length]!);
    }

    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      searchVenue(entries, queries[i]!);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    // Plan §6: nearest-rank P95 = ceil(0.95 × n) - 1
    const p95Index = Math.ceil(0.95 * samples.length) - 1;
    const p95 = samples[p95Index];
    expect(p95).toBeDefined();
    expect(p95!).toBeLessThan(100);
  });
});
