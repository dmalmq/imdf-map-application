# GDB Harden + Auto-Prune Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default Tokyo `JRTokyoSta_3857.gdb.zip` suggested plan publish successfully end-to-end, with structural client/server alignment and reported auto-exclusion of layers that still fail deep conversion.

**Architecture:** Normalize empty `buildingId` values; tighten `suggestGdbMapping` auto-include for unstructured POIs without level refs; align `collectBlockingIssues` with conversion’s building rules; on publish, after GDAL convert, use existing `collectGdbConversionFailures` to prune blamed layers, return `excludedLayers` on the 202 body, and toast them in the gallery.

**Tech Stack:** TypeScript, Fastify + TypeBox, Vitest, React gallery, existing `server/src/gdb/mapping.ts` helpers.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-gdb-harden-design.md` — implement only what it lists; no import-as-version, no shared validation package, no DB migration for exclusions.
- Server remains the source of truth for suggestion and conversion; client holds structural blocking only.
- `excludedLayers` is always present on publish 202 (may be `[]`).
- Blame key for exclusions remains `layerName` (same as `GdbConversionError.details.layer` / `collectGdbConversionFailures`).
- Tokyo fixture path for smoke: `/home/apollo/Downloads/JRTokyoSta_3857.gdb.zip` via `KIRIKO_GDB_SMOKE`.
- Strict TypeScript, no `any`; match existing server/gallery patterns.
- TDD each task; commit after each green task; do not push unless asked.

## File map

| File | Responsibility |
|------|----------------|
| `server/src/gdb/mapping.ts` | `normalizeGdbPlan`, suggestion include hygiene, `resolveGdbImdfWithExclusions` (pure publish build helper) |
| `server/src/gdb/routes.ts` | Call normalize + resolve helper; 202 schema with `excludedLayers` |
| `server/test/gdbMapping.test.ts` | Unit tests for normalize, suggestion, resolve helper |
| `server/test/gdbSmoke.test.ts` | Full default-plan Tokyo publish acceptance |
| `src/gdb/planValidation.ts` + `.test.ts` | Client blocking + empty-string buildingId |
| `src/gallery/GdbImportDialog.tsx` | Normalize `""` in `pruneUnusedBuildings` |
| `src/gallery/api.ts` + `api.test.ts` | `publishGdb` return type includes `excludedLayers` |
| `src/gallery/GalleryPage.tsx` + `gallery.test.tsx` | Toast when exclusions non-empty |

---

### Task 1: `normalizeGdbPlan`

**Files:**
- Modify: `server/src/gdb/mapping.ts`
- Test: `server/test/gdbMapping.test.ts`

**Interfaces:**
- Produces: `export function normalizeGdbPlan(plan: GdbMappingPlan): GdbMappingPlan`

- [ ] **Step 1: Write the failing test** — append to `server/test/gdbMapping.test.ts`:

```ts
import { normalizeGdbPlan, /* existing imports */ } from "../src/gdb/mapping";

describe("normalizeGdbPlan", () => {
  it("coerces empty-string buildingId to null and leaves real ids", () => {
    const plan = {
      venueName: "V",
      buildings: [{ id: "building-1", name: "A" }],
      layers: [
        {
          key: { databaseId: "gdb-1", layerName: "A_1_Floor" },
          included: true,
          targetType: "level" as const,
          buildingId: "",
          levelRule: { kind: "layer-name" as const },
          idField: "id",
          ordinalField: null,
          shortNameField: null,
          nameField: null,
          categoryField: null,
        },
        {
          key: { databaseId: "gdb-1", layerName: "A_1_Space" },
          included: true,
          targetType: "unit" as const,
          buildingId: "building-1",
          levelRule: { kind: "layer-name" as const },
          idField: "id",
          ordinalField: null,
          shortNameField: null,
          nameField: null,
          categoryField: null,
        },
      ],
    };
    const out = normalizeGdbPlan(plan);
    expect(out.layers[0]!.buildingId).toBeNull();
    expect(out.layers[1]!.buildingId).toBe("building-1");
    // Does not mutate input
    expect(plan.layers[0]!.buildingId).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir server exec vitest run gdbMapping`
Expected: FAIL — `normalizeGdbPlan` is not exported.

- [ ] **Step 3: Implement**

Near the other plan helpers in `server/src/gdb/mapping.ts` (after `suggestGdbMapping` is fine):

```ts
/** Coerce wire-footgun empty strings so conversion treats them as unset. */
export function normalizeGdbPlan(plan: GdbMappingPlan): GdbMappingPlan {
  return {
    ...plan,
    layers: plan.layers.map((row) => ({
      ...row,
      buildingId: row.buildingId === "" ? null : row.buildingId,
    })),
  };
}
```

Import `GdbMappingPlan` is already available via types import in this file — confirm the existing import line includes it; add if missing.

- [ ] **Step 4: Run tests**

Run: `pnpm --dir server exec vitest run gdbMapping`
Expected: PASS (all prior + new).

- [ ] **Step 5: Commit**

```bash
git add server/src/gdb/mapping.ts server/test/gdbMapping.test.ts
git commit -m "feat(server): normalize empty GDB buildingId to null"
```

---

### Task 2: Suggestion hygiene for unstructured layers

**Files:**
- Modify: `server/src/gdb/mapping.ts` (`suggestLayerPlan`, ~318–384)
- Test: `server/test/gdbMapping.test.ts`

**Interfaces:**
- Consumes: existing `STRUCTURED_NAME`, `findField`, `inferTargetType`
- Produces: changed auto-`included` behavior only (no new exports)

- [ ] **Step 1: Write the failing tests**

```ts
describe("suggestGdbMapping unstructured include", () => {
  it("does not auto-include unstructured amenity without level/floor id field", () => {
    const inspection = inspect([
      layer("Free_shuttle_bus_busstop_Facility", "point", 3, ["id", "name", "category"]),
      layer("Station_1_Floor", "polygon", 2, ["id", "ordinal"]),
    ]);
    const plan = suggestGdbMapping(inspection);
    const shuttle = plan.layers.find((l) => l.key.layerName === "Free_shuttle_bus_busstop_Facility")!;
    expect(shuttle.targetType).toBe("amenity"); // or whatever inferTargetType yields — assert non-null if guessed
    expect(shuttle.included).toBe(false);
    expect(shuttle.buildingId).toBeNull();
  });

  it("may auto-include unstructured amenity when floor_id is present", () => {
    const inspection = inspect([
      layer("Free_shuttle_bus_busstop_Facility", "point", 3, ["id", "floor_id", "name"]),
      layer("Station_1_Floor", "polygon", 2, ["id", "ordinal"]),
    ]);
    const plan = suggestGdbMapping(inspection);
    const shuttle = plan.layers.find((l) => l.key.layerName === "Free_shuttle_bus_busstop_Facility")!;
    // With a source-reference field, keep prior include behavior when geometry/type allow.
    expect(shuttle.levelRule).toEqual({ kind: "source-reference", field: "floor_id" });
    expect(shuttle.included).toBe(true);
    expect(shuttle.buildingId).toBeNull();
  });
});
```

If `inferTargetType("Free_shuttle_bus_busstop_Facility")` is not `"amenity"`, assert the actual guessed type from a quick probe, or use a name the existing inferrer maps to amenity/occupant (e.g. suffix `_Facility` / `_Occupant` — match whatever `inferTargetType` already does in this file). Do not change `inferTargetType` in this task.

- [ ] **Step 2: Run test — expect FAIL** on `included === false` for the no-ref case (today it is likely `true`).

Run: `pnpm --dir server exec vitest run gdbMapping`

- [ ] **Step 3: Implement in `suggestLayerPlan`**

After the block that sets `included = layer.featureCount > 0 && !crossFloor` (and levelRule assignment), add:

```ts
  const structured = STRUCTURED_NAME.test(name);
  if (
    included &&
    targetType !== null &&
    targetType !== "level" &&
    !structured
  ) {
    const hasLevelRef = levelIdField !== null || floorIdField !== null;
    if (!hasLevelRef) {
      included = false;
    }
  }
```

Keep building assignment as today (`buildingId` null when no structured prefix).

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm --dir server exec vitest run gdbMapping`

- [ ] **Step 5: Commit**

```bash
git add server/src/gdb/mapping.ts server/test/gdbMapping.test.ts
git commit -m "fix(server): do not auto-include unstructured GDB POIs without level ref"
```

---

### Task 3: Pure `resolveGdbImdfWithExclusions`

**Files:**
- Modify: `server/src/gdb/mapping.ts`
- Test: `server/test/gdbMapping.test.ts`

**Interfaces:**
- Consumes: `normalizeGdbPlan`, `buildGdbImdf`, `collectGdbConversionFailures`, `GdbConversionError`
- Produces:

```ts
export interface GdbImdfResolveResult {
  archive: ParsedImdfArchive;
  excludedLayers: GdbConversionFailure[]; // { layer: string; reason: string }[]
}

/**
 * Normalize plan, build IMDF, or auto-prune blamed layers via
 * collectGdbConversionFailures. Throws GdbConversionError when nothing
 * remains convertible or the failure is not layer-attributable.
 */
export function resolveGdbImdfWithExclusions(
  conversion: GdbConversionResult,
  plan: GdbMappingPlan,
): GdbImdfResolveResult;
```

(`GdbConversionResult` is the type of `{ layers, warnings }` already used by `buildGdbImdf` — use the same type name already in `mapping.ts` / `convert.ts`. If the param type is inlined today, match `buildGdbImdf`’s first parameter type exactly.)

- [ ] **Step 1: Write failing tests**

Reuse helpers from the existing `collectGdbConversionFailures` test:

```ts
describe("resolveGdbImdfWithExclusions", () => {
  it("returns empty excludedLayers when the plan already converts", () => {
    const ok = layer("Station_1_Floor", "polygon", 1, ["id"]);
    const plan = suggestGdbMapping(inspect([ok]));
    // ensure included
    const resolved = resolveGdbImdfWithExclusions(
      { layers: [convert([ok], "id1")], warnings: [] },
      plan,
    );
    expect(resolved.excludedLayers).toEqual([]);
    expect(resolved.archive.collections.level?.features.length).toBeGreaterThan(0);
  });

  it("prunes blamed layers and returns exclusions", () => {
    const ok = layer("Station_1_Floor", "polygon", 1, ["id"]);
    const bad = layer("Station_1_Space", "polygon", 1, ["id"]);
    const plan = suggestGdbMapping(inspect([ok, bad]));
    const convertedOk = convert([ok], "id1");
    const emptyBad = {
      key: bad.key,
      featureCollection: { type: "FeatureCollection" as const, features: [] },
      skippedGeometryCount: 0,
    };
    const resolved = resolveGdbImdfWithExclusions(
      { layers: [convertedOk, emptyBad], warnings: [] },
      plan,
    );
    expect(resolved.excludedLayers.map((f) => f.layer)).toEqual(["Station_1_Space"]);
    expect(resolved.archive.collections.level?.features.length).toBeGreaterThan(0);
  });

  it("throws when every included layer is blamed", () => {
    const bad = layer("Station_1_Floor", "polygon", 1, ["id"]);
    const plan = suggestGdbMapping(inspect([bad]));
    const emptyBad = {
      key: bad.key,
      featureCollection: { type: "FeatureCollection" as const, features: [] },
      skippedGeometryCount: 0,
    };
    expect(() =>
      resolveGdbImdfWithExclusions({ layers: [emptyBad], warnings: [] }, plan),
    ).toThrow(GdbConversionError);
  });
});
```

Import `resolveGdbImdfWithExclusions` and `GdbConversionError`.

- [ ] **Step 2: Run — FAIL** (export missing)

Run: `pnpm --dir server exec vitest run gdbMapping`

- [ ] **Step 3: Implement**

```ts
export interface GdbImdfResolveResult {
  archive: ParsedImdfArchive;
  excludedLayers: GdbConversionFailure[];
}

export function resolveGdbImdfWithExclusions(
  conversion: /* same as buildGdbImdf first arg */,
  plan: GdbMappingPlan,
): GdbImdfResolveResult {
  const normalized = normalizeGdbPlan(plan);
  try {
    return { archive: buildGdbImdf(conversion, normalized), excludedLayers: [] };
  } catch (error) {
    if (!(error instanceof GdbConversionError)) throw error;
  }

  const failures = collectGdbConversionFailures(conversion, normalized);
  if (failures.length === 0) {
    // Non-attributable or unrecoverable — rethrow by rebuilding once for the error, or:
    try {
      buildGdbImdf(conversion, normalized);
    } catch (error) {
      throw error;
    }
  }

  const excludedNames = new Set(failures.map((f) => f.layer));
  const working: GdbMappingPlan = {
    ...normalized,
    layers: normalized.layers.map((row) =>
      excludedNames.has(row.key.layerName) ? { ...row, included: false } : row,
    ),
  };

  const stillIncluded = working.layers.some((l) => l.included && l.targetType !== null);
  if (!stillIncluded) {
    throw new GdbConversionError("gdb_conversion_failed", "no convertible layers after exclusions", {
      excludedLayers: failures,
    });
  }

  // collectGdbConversionFailures already proved a residual converts; build it.
  const archive = buildGdbImdf(conversion, working);
  return { archive, excludedLayers: failures };
}
```

Match `GdbConversionError` constructor signature already in the file (reason string + details object). If the constructor differs, use the same pattern as other throws in `mapping.ts` (`conversionFailed(...)` is not available outside — use `new GdbConversionError` as tests already import the class).

Simplify the “failures.length === 0” branch: if first build threw `GdbConversionError` and collect returns `[]`, rethrow the **original** error (capture it in the first catch).

- [ ] **Step 4: Run — PASS**

Run: `pnpm --dir server exec vitest run gdbMapping`

- [ ] **Step 5: Commit**

```bash
git add server/src/gdb/mapping.ts server/test/gdbMapping.test.ts
git commit -m "feat(server): resolve GDB IMDF with blamed-layer auto-prune"
```

---

### Task 4: Wire publish route + Tokyo full-plan smoke

**Files:**
- Modify: `server/src/gdb/routes.ts`
- Modify: `server/test/gdbSmoke.test.ts`
- (Optional light assert in `server/test/gdbRoutes.test.ts` only if a non-GDAL path exists — do not add hanging stubs.)

**Interfaces:**
- Consumes: `resolveGdbImdfWithExclusions`, `normalizeGdbPlan` (via resolve)
- Produces: 202 body `{ jobId, versionId, seq, excludedLayers: Array<{ layer: string; reason: string }> }`

- [ ] **Step 1: Update 202 schema and handler**

In `server/src/gdb/routes.ts`:

1. Import `resolveGdbImdfWithExclusions` (and drop direct `buildGdbImdf` use in publish if unused elsewhere in file — keep `buildGdbImdf` import only if still needed).
2. Change 202 schema to:

```ts
202: Type.Object({
  jobId: Type.String(),
  versionId: Type.Number(),
  seq: Type.Number(),
  excludedLayers: Type.Array(
    Type.Object({ layer: Type.String(), reason: Type.String() }),
  ),
}),
```

3. Replace the build block:

```ts
      let archive;
      let excludedLayers: Array<{ layer: string; reason: string }> = [];
      try {
        const resolved = resolveGdbImdfWithExclusions(conversion, plan);
        archive = resolved.archive;
        excludedLayers = resolved.excludedLayers;
      } catch (error) {
        if (isGdbConversionError(error)) {
          return reply.code(400).send(
            errorBody("gdb_conversion_failed", "gdb_conversion_failed", {
              reason: error.reason,
              ...error.details,
            }),
          );
        }
        request.log.error({ err: error }, "gdb imdf build failed");
        return reply.code(500).send(errorBody("internal_error", "internal_error"));
      }
```

4. Final send:

```ts
      return reply.code(202).send({ jobId, versionId, seq: nextSeq, excludedLayers });
```

**Important:** `includedLayerNames` for GDAL should still be computed from the **client-submitted** plan (pre-prune). Only IMDF build uses the pruned plan. That matches the spec.

- [ ] **Step 2: Update gdbSmoke to publish the default suggested plan**

Replace the subset selection in `server/test/gdbSmoke.test.ts` with:

```ts
    const plan = inspected.suggestedPlan;

    const publish = await app.inject({
      method: "POST",
      url: "/api/gdb/publish",
      headers: { cookie },
      payload: {
        venueId,
        blobHash: inspected.blobHash,
        plan,
      },
    });
    expect(publish.statusCode, publish.body).toBe(202);
    const accepted = publish.json() as {
      jobId: string;
      versionId: number;
      seq: number;
      excludedLayers: Array<{ layer: string; reason: string }>;
    };
    expect(accepted.seq).toBe(1);
    expect(Array.isArray(accepted.excludedLayers)).toBe(true);
    // exclusions allowed; must not block publish
```

Keep job idle + published status + stats > 0 assertions. Increase timeout if needed (full convert is heavier than 2 layers) — e.g. `120_000` if 30s is tight.

- [ ] **Step 3: Run focused tests**

```bash
pnpm --dir server exec vitest run gdbMapping
KIRIKO_GDB_SMOKE=/home/apollo/Downloads/JRTokyoSta_3857.gdb.zip pnpm --dir server exec vitest run gdbSmoke
pnpm --dir server exec tsc --noEmit
```

Expected: all PASS; smoke publish 202; version `published`.

- [ ] **Step 4: Commit**

```bash
git add server/src/gdb/routes.ts server/test/gdbSmoke.test.ts
git commit -m "feat(server): auto-prune failing GDB layers on publish"
```

---

### Task 5: Client structural blocking + dialog normalize

**Files:**
- Modify: `src/gdb/planValidation.ts`
- Modify: `src/gdb/planValidation.test.ts`
- Modify: `src/gallery/GdbImportDialog.tsx` (`pruneUnusedBuildings`)

**Interfaces:**
- `collectBlockingIssues` behavior change only (same signature)

- [ ] **Step 1: Failing tests** — append to `src/gdb/planValidation.test.ts`:

```ts
  it("treats empty-string buildingId as missing on levels", () => {
    const plan = {
      ...basePlan,
      layers: [{ ...basePlan.layers[0]!, buildingId: "" }],
    };
    expect(collectBlockingIssues(plan, map, "en").some((m) => m.includes("building"))).toBe(true);
  });

  it("allows source-reference non-level with null buildingId", () => {
    const amenity = descriptor("POI", "point", ["id", "floor_id"]);
    const amenityMap = new Map([[gdbLayerKeyString(amenity.key), amenity]]);
    const plan: GdbMappingPlan = {
      venueName: "Station",
      buildings: [{ id: "b1", name: "Station" }],
      layers: [
        basePlan.layers[0]!,
        {
          key: amenity.key,
          included: true,
          targetType: "amenity",
          buildingId: null,
          levelRule: { kind: "source-reference", field: "floor_id" },
          idField: "id",
          ordinalField: null,
          shortNameField: null,
          nameField: null,
          categoryField: null,
        },
      ],
    };
    const issues = collectBlockingIssues(plan, amenityMap, "en");
    expect(issues.some((m) => m.includes("POI") && m.includes("building"))).toBe(false);
  });

  it("flags non-source-reference non-level with empty buildingId", () => {
    const unit = descriptor("Station_1_Space", "polygon", ["id"]);
    const unitMap = new Map([
      [gdbLayerKeyString(basePlan.layers[0]!.key), descriptor("Station_1_Floor", "polygon", ["id"])],
      [gdbLayerKeyString(unit.key), unit],
    ]);
    const plan: GdbMappingPlan = {
      venueName: "Station",
      buildings: [{ id: "b1", name: "Station" }],
      layers: [
        basePlan.layers[0]!,
        {
          key: unit.key,
          included: true,
          targetType: "unit",
          buildingId: "",
          levelRule: { kind: "layer-name" },
          idField: "id",
          ordinalField: null,
          shortNameField: null,
          nameField: null,
          categoryField: null,
        },
      ],
    };
    const issues = collectBlockingIssues(plan, unitMap, "en");
    expect(issues.some((m) => m.includes("Space"))).toBe(true);
  });
```

Adapt fixture names to match existing `basePlan` / `descriptor` helpers already in the file.

- [ ] **Step 2: Run — RED**

Run: `pnpm exec vitest run planValidation`

- [ ] **Step 3: Implement**

In `collectBlockingIssues`, add a local helper:

```ts
  const hasBuilding = (id: string | null): boolean =>
    typeof id === "string" && id !== "" && buildingIds.has(id);
```

Replace level check:

```ts
      if (!hasBuilding(row.buildingId)) {
        issues.push(blockingText.levelNoBuilding[locale](label));
      }
```

Replace non-level building check:

```ts
      if (rule.kind !== "source-reference" && !hasBuilding(row.buildingId)) {
        issues.push(blockingText.needBuilding[locale](label));
      }
```

In `GdbImportDialog.tsx` `pruneUnusedBuildings`:

```ts
function pruneUnusedBuildings(plan: GdbMappingPlan): GdbMappingPlan {
  const layers = plan.layers.map((layer) => ({
    ...layer,
    buildingId: layer.buildingId === "" ? null : layer.buildingId,
  }));
  const used = new Set(
    layers
      .filter((layer) => layer.included && layer.buildingId !== null)
      .map((layer) => layer.buildingId as string),
  );
  const buildings = plan.buildings.every((building) => used.has(building.id))
    ? plan.buildings
    : plan.buildings.filter((building) => used.has(building.id));
  return { ...plan, layers, buildings };
}
```

- [ ] **Step 4: Run — GREEN**

```bash
pnpm exec vitest run planValidation GdbImportDialog
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/gdb/planValidation.ts src/gdb/planValidation.test.ts src/gallery/GdbImportDialog.tsx
git commit -m "fix(web): align GDB blocking with empty buildingId and source-ref rules"
```

---

### Task 6: Client publish type + exclusion toast

**Files:**
- Modify: `src/gallery/api.ts`
- Modify: `src/gallery/api.test.ts`
- Modify: `src/gallery/GalleryPage.tsx`
- Modify: `src/gallery/gallery.test.tsx`

**Interfaces:**
- Produces:

```ts
export type GdbPublishResponse = {
  jobId: string;
  versionId: number;
  seq: number;
  excludedLayers: Array<{ layer: string; reason: string }>;
};

// api.publishGdb(...): Promise<GdbPublishResponse>
```

- [ ] **Step 1: API test update**

In `src/gallery/api.test.ts`, change the publish mock body and expectation:

```ts
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          jobId: "j1",
          versionId: 7,
          seq: 1,
          excludedLayers: [{ layer: "Bad_Layer", reason: "empty or geometry-less layer" }],
        }),
        { status: 202 },
      ),
    );
    // ...
    expect(result).toEqual({
      jobId: "j1",
      versionId: 7,
      seq: 1,
      excludedLayers: [{ layer: "Bad_Layer", reason: "empty or geometry-less layer" }],
    });
```

- [ ] **Step 2: Implement API type**

```ts
export type GdbPublishResponse = {
  jobId: string;
  versionId: number;
  seq: number;
  excludedLayers: Array<{ layer: string; reason: string }>;
};

// publishGdb return type → Promise<GdbPublishResponse>
// after res.ok:
const body = (await res.json()) as GdbPublishResponse;
return {
  jobId: body.jobId,
  versionId: body.versionId,
  seq: body.seq,
  excludedLayers: Array.isArray(body.excludedLayers) ? body.excludedLayers : [],
};
```

- [ ] **Step 3: Gallery toast**

Add ui copy:

```ts
  publishedWithSkips: {
    ja: (n: number, sample: string) =>
      `公開しました（${n} レイヤーをスキップ: 例 ${sample}）`,
    en: (n: number, sample: string) =>
      `Published with ${n} layer(s) skipped (e.g. ${sample}).`,
  },
```

Extend flow or local state:

```ts
const [gdbNotice, setGdbNotice] = useState<string | null>(null);
```

In `publishGdbPlan` success path:

```ts
        const published = await api.publishGdb(venue.id, data.blobHash, plan);
        const job = await api.waitForJob(published.jobId);
        if (job.status === "done") {
          const skipped = published.excludedLayers ?? [];
          if (skipped.length > 0) {
            const sample = skipped[0]!.layer;
            setGdbNotice(ui.publishedWithSkips[locale](skipped.length, sample));
          } else {
            setGdbNotice(null);
          }
          setGdbFlow({ phase: "idle" });
          if (gdbInputRef.current) gdbInputRef.current.value = "";
          await reload();
        } else {
```

Render near other toasts:

```tsx
{gdbNotice !== null ? (
  <div className="gallery-toast" role="status">{gdbNotice}</div>
) : null}
```

Clear notice when starting a new import (`onGdbFile` / `startGdbImport`).

- [ ] **Step 4: Gallery test**

Extend the existing import test mock:

```ts
publishGdb.mockResolvedValue({
  jobId: "j",
  versionId: 1,
  seq: 1,
  excludedLayers: [{ layer: "Bad_Layer", reason: "empty or geometry-less layer" }],
});
```

After import succeeds, assert:

```ts
await waitFor(() =>
  expect(screen.getByRole("status").textContent).toMatch(/skipped|スキップ/),
);
```

(Switch to EN in the test as today so English copy matches if easier.)

- [ ] **Step 5: Run**

```bash
pnpm exec vitest run gallery/api gallery.test
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/gallery/api.ts src/gallery/api.test.ts src/gallery/GalleryPage.tsx src/gallery/gallery.test.tsx
git commit -m "feat(web): surface GDB publish layer exclusions in gallery"
```

---

### Task 7: Inspect timeout (stretch — do if Tasks 1–6 green and time allows)

**Files:**
- Modify: `server/src/gdb/routes.ts` (inspect handler only)

- [ ] **Step 1:** Wrap `inspectGdbArchive` await:

```ts
const INSPECT_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// usage:
inspection = await withTimeout(inspectGdbArchive(stagedPath), INSPECT_TIMEOUT_MS, "gdb inspect");
```

Keep existing `finally { removeStagedGdb(stagedPath); }`. Map timeout to 400 `gdb_inspection_failed` via the existing catch.

- [ ] **Step 2:** No new hanging unit test (gdal hang is environmental). Typecheck + existing gdbRoutes/gdbSmoke still pass.

- [ ] **Step 3: Commit** if implemented:

```bash
git add server/src/gdb/routes.ts
git commit -m "fix(server): timeout GDB inspect to avoid hung uploads"
```

If skipped, note in the Task 8 report.

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

```bash
pnpm exec tsc --noEmit && pnpm --dir server exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 2: Full suites**

```bash
pnpm exec vitest run
KIRIKO_GDB_SMOKE=/home/apollo/Downloads/JRTokyoSta_3857.gdb.zip pnpm --dir server exec vitest run
```

Expected: all pass; gdbSmoke publishes default Tokyo plan.

- [ ] **Step 3: Manual browser smoke (optional but preferred)**

Start `pnpm dev:server` + `pnpm dev`, sign in, Import Geodatabase → Tokyo zip → Import without row edits → venue published → open viewer. Note exclusion toast if any.

- [ ] **Step 4:** No commit unless smoke-driven fixes were required (then commit those fixes with a clear message).

---

## Spec coverage checklist

| Spec section | Task(s) |
|--------------|---------|
| 4.2 Plan normalization | 1, 5 (client prune) |
| 4.3 Suggestion hygiene | 2 |
| 4.4 Client blocking | 5 |
| 4.5 Publish auto-prune | 3, 4 |
| 4.6 202 `excludedLayers` | 4, 6 |
| 4.7 Gallery toast | 6 |
| 4.8 Inspect timeout | 7 (stretch) |
| §6 Testing / Tokyo acceptance | 4 smoke, 8 |
| Non-goals respected | — no version import, no DB column, no shared package |

## Execution handoff

After this plan is committed, choose:

1. **Subagent-Driven (recommended)** — `superpowers:subagent-driven-development`
2. **Inline Execution** — `superpowers:executing-plans`
