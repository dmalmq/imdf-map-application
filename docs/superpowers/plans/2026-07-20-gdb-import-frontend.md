# Frontend GDB Import UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gallery flow that uploads a `.gdb.zip`, reviews the server-suggested mapping plan in an editable dialog, and publishes it through the existing server GDB endpoints.

**Architecture:** The server already owns inspect/convert/publish. This phase adds a thin client: `/api/gdb/inspect` is extended to also return the server-computed suggested plan; the client mirrors the API contract types, ports only small structural-validation helpers for live feedback, ports the branch's review dialog rewired to drive the server, and wires a gallery entry that orchestrates inspect → review → createVenue → publish → poll.

**Tech Stack:** React 19, TypeScript (strict), Vite, Vitest + jsdom + @testing-library/react (client); Fastify + TypeBox + better-sqlite3 (server); `@zip.js/zip.js` + `gdal3.js` already wired server-side.

**Spec:** `docs/superpowers/specs/2026-07-20-gdb-import-frontend-design.md`

## Global Constraints

- Every user-facing string is a bilingual `{ ja, en }` record keyed by `LocaleCode` (from `src/imdf/types`), following the existing `ui`-object pattern in `UploadModal.tsx`/`GalleryPage.tsx`.
- TypeScript strict; no `any`; mirror existing file patterns and naming.
- The client NEVER re-implements `suggestGdbMapping` or `buildGdbImdf`. It holds only the small structural helpers listed in Task 3.
- Client validation is structural only; deep conversion failures surface from `/api/gdb/publish`.
- Client tests run from repo root: `pnpm exec vitest run <pattern>`.
- Server tests run: `pnpm --dir server exec vitest run <pattern>`; the real-fixture smoke is gated on `KIRIKO_GDB_SMOKE=/home/apollo/Downloads/JRTokyoSta_3857.gdb.zip`.
- The Tokyo fixture `/home/apollo/Downloads/JRTokyoSta_3857.gdb.zip` is the canonical structure and the primary acceptance test.
- Out of scope: marker icons, client-side gdal/worker, import-into-existing-venue, streaming progress.
- Commit after every task.

---

### Task 1: Server returns `suggestedPlan` from `/api/gdb/inspect`

**Files:**
- Modify: `server/src/gdb/types.ts` (GdbInspectResponse)
- Modify: `server/src/gdb/routes.ts` (inspect handler + 200 schema + import)
- Test: `server/test/gdbRoutes.test.ts`

**Interfaces:**
- Produces: `GdbInspectResponse = { blobHash: string; inspection: GdbInspection; suggestedPlan: GdbMappingPlan }`. The client (Task 2) mirrors this shape.

- [ ] **Step 1: Write the failing test** — append to `server/test/gdbRoutes.test.ts`:

```ts
import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

function validSystemCatalog(): Uint8Array {
  const bytes = new Uint8Array(41);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 3, true);
  view.setBigUint64(24, BigInt(bytes.byteLength), true);
  view.setBigUint64(32, 40n, true);
  return bytes;
}

async function minimalGdbZip(): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("Station.gdb/a00000001.gdbtable", new Uint8ArrayReader(validSystemCatalog()));
  await writer.add("Station.gdb/a00000001.gdbtablx", new TextReader("idx"));
  return writer.close();
}

it("inspect returns a suggestedPlan alongside the inspection", async () => {
  const { app } = await makeTestApp();
  const cookie = await loginCookie(app);
  const multipart = multipartZip(await minimalGdbZip());
  const response = await app.inject({
    method: "POST",
    url: "/api/gdb/inspect",
    headers: { cookie, ...multipart.headers },
    payload: multipart.payload,
  });
  // gdal cannot read the stub catalog, so inspect fails cleanly — assert the
  // contract shape is wired, not that this stub inspects. Real inspection is
  // covered by gdbSmoke against the Tokyo fixture.
  expect([200, 400]).toContain(response.statusCode);
  if (response.statusCode === 200) {
    const body = response.json() as { suggestedPlan?: { layers: unknown[] } };
    expect(Array.isArray(body.suggestedPlan?.layers)).toBe(true);
  }
});
```

Also update the existing `gdbSmoke.test.ts` assertion to consume `inspected.suggestedPlan` (Step 3 wires it; the smoke is the real coverage).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir server exec vitest run gdbRoutes`
Expected: FAIL — `minimalGdbZip`/multipart helper import mismatch or `suggestedPlan` undefined until wired. (If the stub returns 400, the test passes trivially; the real assertion is the gdbSmoke change below, which fails until Step 3.)

- [ ] **Step 3: Add `suggestedPlan` to the type and handler**

In `server/src/gdb/types.ts`, extend `GdbInspectResponse`:

```ts
/** Response envelope for `POST /api/gdb/inspect`. */
export interface GdbInspectResponse {
  blobHash: string;
  inspection: GdbInspection;
  suggestedPlan: GdbMappingPlan;
}
```

Ensure `GdbMappingPlan` is imported/defined in that file (it already is). In `server/src/gdb/routes.ts`, add `suggestGdbMapping` to the mapping import:

```ts
import { buildGdbImdf, GdbConversionError, suggestGdbMapping } from "./mapping";
```

Change the inspect 200 schema to include the field:

```ts
200: Type.Object({
  blobHash: Type.String(),
  inspection: Type.Unknown(),
  suggestedPlan: Type.Unknown(),
}),
```

Change the response construction (currently `const body: GdbInspectResponse = { blobHash: hash, inspection };`):

```ts
const body: GdbInspectResponse = {
  blobHash: hash,
  inspection,
  suggestedPlan: suggestGdbMapping(inspection),
};
```

In `server/test/gdbSmoke.test.ts`, replace `const suggested = suggestGdbMapping(inspected.inspection);` with `const suggested = inspected.suggestedPlan;` and add `expect(inspected.suggestedPlan.layers.length).toBe(318);` after the existing inspection assertions. Remove the now-unused `suggestGdbMapping` import there if nothing else uses it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir server exec vitest run gdbRoutes && KIRIKO_GDB_SMOKE=/home/apollo/Downloads/JRTokyoSta_3857.gdb.zip pnpm --dir server exec vitest run gdbSmoke`
Expected: PASS. Then `pnpm --dir server exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/gdb/types.ts server/src/gdb/routes.ts server/test/gdbRoutes.test.ts server/test/gdbSmoke.test.ts
git commit -m "feat(server): return suggested GDB plan from /api/gdb/inspect"
```

---

### Task 2: Client GDB contract types

**Files:**
- Create: `src/gdb/types.ts`

**Interfaces:**
- Produces: `GdbGeometryFamily`, `GdbTargetType`, `GdbLayerKey`, `gdbLayerKeyString`, `GdbFieldDescriptor`, `GdbLayerDescriptor`, `GdbInspection`, `GdbBuildingPlan`, `GdbLevelRule`, `GdbLayerPlan`, `GdbMappingPlan`, `GdbInspectResponse`. Consumed by Tasks 3–6.

This is a types-only mirror of the server contract; it has no standalone test and is committed with Task 3 (its first consumer). Create the file now:

- [ ] **Step 1: Create `src/gdb/types.ts`** (mirror of `server/src/gdb/types.ts`, trimmed to the client contract):

```ts
/**
 * Client mirror of the server GDB import API contract
 * (`server/src/gdb/types.ts`). Kept in sync by hand, exactly as
 * `src/gallery/api.ts` mirrors the venue/version response shapes.
 */
export type GdbGeometryFamily = "point" | "line" | "polygon" | "mixed" | "none";

export type GdbTargetType =
  | "level" | "unit" | "opening" | "detail" | "fixture" | "kiosk" | "amenity" | "occupant";

export interface GdbLayerKey {
  databaseId: string;
  layerName: string;
}

export function gdbLayerKeyString(key: GdbLayerKey): string {
  return `${key.databaseId}\u0000${key.layerName}`;
}

export interface GdbFieldDescriptor {
  name: string;
  type: string;
}

export interface GdbLayerDescriptor {
  key: GdbLayerKey;
  databaseName: string;
  featureCount: number;
  geometryFamily: GdbGeometryFamily;
  fields: GdbFieldDescriptor[];
}

export interface GdbInspection {
  sourceName: string;
  databases: Array<{ id: string; name: string }>;
  layers: GdbLayerDescriptor[];
  warnings: string[];
}

export interface GdbBuildingPlan {
  id: string;
  name: string;
}

export type GdbLevelRule =
  | { kind: "source-reference"; field: string }
  | { kind: "property"; field: string }
  | { kind: "layer-name" }
  | { kind: "fixed"; label: string; ordinal: number };

export interface GdbLayerPlan {
  key: GdbLayerKey;
  included: boolean;
  targetType: GdbTargetType | null;
  buildingId: string | null;
  levelRule: GdbLevelRule | null;
  idField: string | null;
  ordinalField: string | null;
  shortNameField: string | null;
  nameField: string | null;
  categoryField: string | null;
}

export interface GdbMappingPlan {
  venueName: string;
  buildings: GdbBuildingPlan[];
  layers: GdbLayerPlan[];
}

export interface GdbInspectResponse {
  blobHash: string;
  inspection: GdbInspection;
  suggestedPlan: GdbMappingPlan;
}
```

- [ ] **Step 2: Verify it typechecks** (committed with Task 3).

Run: `pnpm exec tsc --noEmit`
Expected: clean (the file is unused until Task 3, but must compile).

---

### Task 3: Client structural validation module

**Files:**
- Create: `src/gdb/planValidation.ts`
- Test: `src/gdb/planValidation.test.ts`

**Interfaces:**
- Consumes: types from `src/gdb/types.ts`.
- Produces:
  - `GDB_TARGET_TYPES: readonly GdbTargetType[]`
  - `isGdbTargetGeometryCompatible(type: GdbTargetType, family: GdbGeometryFamily): boolean`
  - `gdbTargetTypesForGeometry(family: GdbGeometryFamily): GdbTargetType[]`
  - `layerNameFloorOrdinal(layerName: string): number | null`
  - `structuredFloorOrdinal(layerName: string): number | null`
  - `collectBlockingIssues(plan: GdbMappingPlan, descriptorByKey: ReadonlyMap<string, GdbLayerDescriptor>, locale: LocaleCode): string[]`

Port the pure helpers verbatim from `server/src/gdb/mapping.ts` (they exist there and are the canonical implementation): `GDB_TARGET_TYPES`, `GEOMETRY_REQUIREMENT`, `isGdbTargetGeometryCompatible`, `gdbTargetTypesForGeometry` (lines ~84–121), and the floor-ordinal block `buildFloorSynonyms`, `SYNONYM_LOOKUP`, `parseFloorToken`, `extractGdbFloorOrdinal`, `STRUCTURED_NAME`, `structuredFloorOrdinal`, `layerNameFloorOrdinal` (lines ~127–296). Then add `fieldExists`, the `blockingText` bilingual copy, and `collectBlockingIssues` (moved out of the branch dialog — see code below).

- [ ] **Step 1: Write the failing test** — `src/gdb/planValidation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  collectBlockingIssues,
  gdbTargetTypesForGeometry,
  isGdbTargetGeometryCompatible,
  layerNameFloorOrdinal,
} from "./planValidation";
import { gdbLayerKeyString, type GdbLayerDescriptor, type GdbMappingPlan } from "./types";

function descriptor(name: string, family: GdbLayerDescriptor["geometryFamily"], fields: string[]): GdbLayerDescriptor {
  return {
    key: { databaseId: "gdb-1", layerName: name },
    databaseName: "db",
    featureCount: 1,
    geometryFamily: family,
    fields: fields.map((f) => ({ name: f, type: "String" })),
  };
}

describe("geometry compatibility", () => {
  it("matches target types to geometry families", () => {
    expect(isGdbTargetGeometryCompatible("level", "polygon")).toBe(true);
    expect(isGdbTargetGeometryCompatible("level", "point")).toBe(false);
    expect(gdbTargetTypesForGeometry("point")).toEqual(["amenity", "occupant"]);
    expect(gdbTargetTypesForGeometry("mixed")).toEqual([]);
  });
});

describe("floor ordinal", () => {
  it("reads the structured floor token", () => {
    expect(layerNameFloorOrdinal("Station_B1_Floor")).toBe(-1);
    expect(layerNameFloorOrdinal("Station_5_Space")).toBe(5);
    expect(layerNameFloorOrdinal("Station_R_Floor")).toBeNull();
  });
});

describe("collectBlockingIssues", () => {
  const d = descriptor("Station_1_Floor", "polygon", ["id"]);
  const map = new Map([[gdbLayerKeyString(d.key), d]]);
  const basePlan: GdbMappingPlan = {
    venueName: "Station",
    buildings: [{ id: "b1", name: "Station" }],
    layers: [
      {
        key: d.key, included: true, targetType: "level", buildingId: "b1",
        levelRule: { kind: "layer-name" }, idField: "id",
        ordinalField: null, shortNameField: null, nameField: null, categoryField: null,
      },
    ],
  };

  it("returns no issues for a resolvable level", () => {
    expect(collectBlockingIssues(basePlan, map, "en")).toEqual([]);
  });

  it("flags a level with no assigned building", () => {
    const plan = { ...basePlan, layers: [{ ...basePlan.layers[0]!, buildingId: null }] };
    expect(collectBlockingIssues(plan, map, "en").length).toBe(1);
  });

  it("flags a target type incompatible with the geometry", () => {
    const plan = { ...basePlan, layers: [{ ...basePlan.layers[0]!, targetType: "amenity" as const }] };
    expect(collectBlockingIssues(plan, map, "en")[0]).toContain("incompatible");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run planValidation`
Expected: FAIL — `Cannot find module './planValidation'`.

- [ ] **Step 3: Create `src/gdb/planValidation.ts`**

Copy the pure helper blocks named above verbatim from `server/src/gdb/mapping.ts` (adjust the import line to `import type { GdbGeometryFamily, GdbTargetType, ... } from "./types";` and drop the `export` on internal-only helpers like `parseFloorToken`, `buildFloorSynonyms`, `SYNONYM_LOOKUP`, `extractGdbFloorOrdinal`, `GEOMETRY_REQUIREMENT` — keep `export` only on the six Produces interfaces above). Then append the blocking-issue logic (ported from the branch dialog, `git show origin/feature/gdb-import:src/components/GdbImportDialog.tsx`, the `blockingText`, `fieldExists`, and `collectBlockingIssues` definitions), with these exact heads:

```ts
import type { LocaleCode } from "../imdf/types";
import {
  gdbLayerKeyString,
  type GdbGeometryFamily,
  type GdbLayerDescriptor,
  type GdbMappingPlan,
  type GdbTargetType,
} from "./types";

// ... (ported GDB_TARGET_TYPES, GEOMETRY_REQUIREMENT, isGdbTargetGeometryCompatible,
//      gdbTargetTypesForGeometry, floor-ordinal helpers, STRUCTURED_NAME,
//      structuredFloorOrdinal, layerNameFloorOrdinal — verbatim from server mapping.ts) ...

const blockingText = {
  incompatibleType: {
    ja: (name: string) => `${name}: 対象種別が形状と一致しません`,
    en: (name: string) => `${name}: target type is missing or incompatible with the geometry`,
  },
  levelNoBuilding: {
    ja: (name: string) => `${name}: レベルに建物を割り当ててください`,
    en: (name: string) => `${name}: assign a building to this level`,
  },
  levelNoOrdinal: {
    ja: (name: string) => `${name}: レベルの序数の取得元を指定してください`,
    en: (name: string) => `${name}: this level needs a resolvable ordinal`,
  },
  noLevelRule: {
    ja: (name: string) => `${name}: レベル規則を指定してください`,
    en: (name: string) => `${name}: choose a level rule`,
  },
  needBuilding: {
    ja: (name: string) => `${name}: 建物または参照規則を指定してください`,
    en: (name: string) => `${name}: assign a building or use a source-reference rule`,
  },
  fixed: {
    ja: (name: string) => `${name}: 固定レベルにはラベルと序数が必要です`,
    en: (name: string) => `${name}: fixed level needs a label and a finite ordinal`,
  },
  field: {
    ja: (name: string) => `${name}: 選択された項目がレイヤーに存在しません`,
    en: (name: string) => `${name}: a selected field does not exist on this layer`,
  },
} as const;

function fieldExists(descriptor: GdbLayerDescriptor | undefined, field: string | null): boolean {
  if (field === null) return true;
  if (!descriptor) return false;
  return descriptor.fields.some((f) => f.name === field);
}

export function collectBlockingIssues(
  plan: GdbMappingPlan,
  descriptorByKey: ReadonlyMap<string, GdbLayerDescriptor>,
  locale: LocaleCode,
): string[] {
  // Body ported verbatim from the branch dialog's collectBlockingIssues.
}
```

Paste the exact body of `collectBlockingIssues` from the branch dialog (the loop over included layers computing incompatibleType / levelNoBuilding / levelNoOrdinal / noLevelRule / needBuilding / fixed / field issues). It already references `isGdbTargetGeometryCompatible`, `layerNameFloorOrdinal`, `gdbLayerKeyString`, `blockingText`, and `fieldExists`, all now in-module.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run planValidation && pnpm exec tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/gdb/types.ts src/gdb/planValidation.ts src/gdb/planValidation.test.ts
git commit -m "feat(web): add GDB contract types and structural plan validation"
```

---

### Task 4: API client — inspectGdb, publishGdb, gdbErrorMessage

**Files:**
- Modify: `src/gallery/api.ts`
- Test: `src/gallery/api.test.ts`

**Interfaces:**
- Consumes: `GdbInspectResponse`, `GdbMappingPlan` from `src/gdb/types`.
- Produces:
  - `interface GdbError { code: string; message: string; details?: Record<string, unknown> }`
  - `api.inspectGdb(file: File, onProgress?: (fraction: number) => void): Promise<GdbInspectResponse>`
  - `api.publishGdb(venueId: number, blobHash: string, plan: GdbMappingPlan): Promise<{ jobId: string; versionId: number; seq: number }>`
  - `gdbErrorMessage(err: GdbError, locale: LocaleCode): string`

- [ ] **Step 1: Write the failing test** — append to `src/gallery/api.test.ts`:

```ts
import { api, gdbErrorMessage } from "./api";

describe("gdb api", () => {
  it("publishGdb posts the plan and returns the job envelope", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jobId: "j1", versionId: 7, seq: 1 }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await api.publishGdb(7, "a".repeat(64), {
      venueName: "V", buildings: [], layers: [],
    });
    expect(result).toEqual({ jobId: "j1", versionId: 7, seq: 1 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ venueId: 7, blobHash: "a".repeat(64) });
  });

  it("gdbErrorMessage maps known codes and names the blamed layer", () => {
    expect(gdbErrorMessage({ code: "invalid_geodatabase", message: "x" }, "en")).toContain("File Geodatabase");
    const conv = gdbErrorMessage(
      { code: "gdb_conversion_failed", message: "x", details: { layer: "Station_1_Space", reason: "empty or geometry-less layer" } },
      "en",
    );
    expect(conv).toContain("Station_1_Space");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run gallery/api`
Expected: FAIL — `gdbErrorMessage` / `api.publishGdb` not exported.

- [ ] **Step 3: Implement in `src/gallery/api.ts`**

Add near the top imports:

```ts
import type { GdbInspectResponse, GdbMappingPlan } from "../gdb/types";
import type { LocaleCode } from "../imdf/types";
```

Add the error type + copy above the `api` object:

```ts
export interface GdbError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const gdbErrorCopy: Record<string, { ja: string; en: string } | undefined> = {
  invalid_geodatabase: {
    ja: "読み取り可能な Esri File Geodatabase が見つかりませんでした。",
    en: "The upload does not contain a readable Esri File Geodatabase.",
  },
  gdb_too_large: {
    ja: "GDB データが処理上限（アーカイブ 200 MiB 等）を超えています。",
    en: "The geodatabase exceeds the processing limits (e.g. 200 MiB archive).",
  },
  gdb_inspection_failed: {
    ja: "geodatabase を検査できませんでした。ファイルを確認してください。",
    en: "The geodatabase could not be inspected. Check the file and try again.",
  },
  gdb_conversion_failed: {
    ja: "選択したレイヤーを変換できませんでした。割り当てを見直してください。",
    en: "The selected layers could not be converted. Review the mapping and try again.",
  },
};

export function gdbErrorMessage(err: GdbError, locale: LocaleCode): string {
  const copy = gdbErrorCopy[err.code];
  const base = copy ? copy[locale] : (locale === "ja" ? "取り込みに失敗しました。" : "Import failed.");
  const layer = typeof err.details?.layer === "string" ? err.details.layer : null;
  if (layer !== null) {
    return locale === "ja" ? `${base}（レイヤー: ${layer}）` : `${base} (layer: ${layer})`;
  }
  return base;
}
```

Add two methods inside the `api` object (mirror `uploadVersion` for the XHR upload):

```ts
inspectGdb(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<GdbInspectResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/gdb/inspect");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText) as GdbInspectResponse);
      } else {
        let parsed: GdbError = { code: "gdb_inspection_failed", message: xhr.responseText };
        try { parsed = JSON.parse(xhr.responseText) as GdbError; } catch { /* non-JSON */ }
        reject(parsed);
      }
    });
    xhr.addEventListener("error", () => reject({ code: "gdb_inspection_failed", message: "network error" } as GdbError));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
},

async publishGdb(
  venueId: number,
  blobHash: string,
  plan: GdbMappingPlan,
): Promise<{ jobId: string; versionId: number; seq: number }> {
  const res = await fetch("/api/gdb/publish", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ venueId, blobHash, plan }),
  });
  if (!res.ok) {
    let parsed: GdbError = { code: "gdb_conversion_failed", message: `${res.status}` };
    try { parsed = (await res.json()) as GdbError; } catch { /* non-JSON */ }
    throw parsed;
  }
  return (await res.json()) as { jobId: string; versionId: number; seq: number };
},
```

Note: `publishGdb` rejects with a `GdbError` (not `ApiError`) so the dialog can render `gdbErrorMessage`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run gallery/api && pnpm exec tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/gallery/api.ts src/gallery/api.test.ts
git commit -m "feat(web): add GDB inspect/publish API client and error copy"
```

---

### Task 5: Review dialog (port + adapt)

**Files:**
- Create: `src/gallery/GdbImportDialog.tsx` (ported from `feature/gdb-import`; lives in `gallery/` alongside `UploadModal.tsx`/`SignInModal.tsx`, matching the codebase's placement of gallery dialogs)
- Modify: `src/app/app.css` (port `.gdb-dialog*` rules)
- Test: `src/gallery/GdbImportDialog.test.tsx`

**Interfaces:**
- Consumes: `collectBlockingIssues`, `gdbTargetTypesForGeometry`, `layerNameFloorOrdinal` from `src/gdb/planValidation`; contract types from `src/gdb/types`; `GdbError`, `gdbErrorMessage` from `src/gallery/api`.
- Produces:
  ```ts
  interface GdbImportDialogProps {
    inspection: GdbInspection;
    initialPlan: GdbMappingPlan;
    locale: LocaleCode;
    busy: boolean;
    error: GdbError | null;
    onImport: (plan: GdbMappingPlan) => void;
    onCancel: () => void;
  }
  export function GdbImportDialog(props: GdbImportDialogProps): ReactElement;
  ```

- [ ] **Step 1: Seed the file from the branch**

```bash
git show origin/feature/gdb-import:src/components/GdbImportDialog.tsx > src/gallery/GdbImportDialog.tsx
```

- [ ] **Step 2: Apply these exact adaptations**

1. Replace the import `import { archiveErrorCopy, type ArchiveError } from "../errors/ArchiveError";` with:
   ```ts
   import { gdbErrorMessage, type GdbError } from "./api";
   ```
2. Change the helper import from `"../gdb/gdbMapping"` to `"../gdb/planValidation"`, keeping only `gdbTargetTypesForGeometry`, `isGdbTargetGeometryCompatible`, `layerNameFloorOrdinal` (whichever the file references), and add `collectBlockingIssues`.
3. Delete the in-file `collectBlockingIssues`, `fieldExists`, and `blockingText` definitions (now in `planValidation.ts`).
4. In `conversionErrorDetail` and `conversionFailureList`, change the parameter type `error: ArchiveError` → `error: GdbError` (bodies read `error.code`/`error.details`, unchanged). Keep these two functions in this file.
5. In `GdbImportDialogProps`, change `error: ArchiveError | null` → `error: GdbError | null`. Change the prop name `initialPlan` stays as-is.
6. Wherever the top-level error banner renders `archiveErrorCopy[error.code]`, replace with `gdbErrorMessage(error, locale)`.
7. Remove any remaining `ArchiveError`/`archiveErrorCopy` references (typecheck will surface them).

Everything else — venue-name input, buildings editor, paginated layer table, target/building/level-rule/field dropdowns, summary, warnings, blocking-issue list, `canImport = blockingIssues.length === 0 && !busy`, `onImport(pruneUnusedBuildings(plan))` — ports unchanged.

- [ ] **Step 3: Port the dialog CSS**

Copy the `.gdb-dialog*` rule block from the branch stylesheet into `src/app/app.css` (append at end):

```bash
git show origin/feature/gdb-import:src/app/app.css | sed -n '/^\.gdb-dialog {/,/^\.gdb-dialog__btn--primary/p' >> src/app/app.css
```

Then open `src/app/app.css` and copy any trailing `.gdb-dialog*` rules after `.gdb-dialog__btn--primary` from the branch (the `sed` stops at that selector; verify the block is complete by eye against `git show origin/feature/gdb-import:src/app/app.css`).

- [ ] **Step 4: Write the failing test** — `src/gallery/GdbImportDialog.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GdbImportDialog } from "./GdbImportDialog";
import type { GdbInspection, GdbMappingPlan } from "../gdb/types";

const inspection: GdbInspection = {
  sourceName: "Station.gdb",
  databases: [{ id: "gdb-1", name: "Station.gdb" }],
  layers: [
    { key: { databaseId: "gdb-1", layerName: "Station_1_Floor" }, databaseName: "Station.gdb", featureCount: 3, geometryFamily: "polygon", fields: [{ name: "id", type: "String" }] },
  ],
  warnings: [],
};

const plan: GdbMappingPlan = {
  venueName: "Station",
  buildings: [{ id: "b1", name: "Station" }],
  layers: [
    { key: { databaseId: "gdb-1", layerName: "Station_1_Floor" }, included: true, targetType: "level", buildingId: "b1", levelRule: { kind: "layer-name" }, idField: "id", ordinalField: null, shortNameField: null, nameField: null, categoryField: null },
  ],
};

describe("GdbImportDialog", () => {
  it("imports the plan when there are no blocking issues", () => {
    const onImport = vi.fn();
    render(<GdbImportDialog inspection={inspection} initialPlan={plan} locale="en" busy={false} error={null} onImport={onImport} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /import/i }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0].layers[0].targetType).toBe("level");
  });

  it("disables import while a blocking issue exists", () => {
    const brokenPlan = { ...plan, layers: [{ ...plan.layers[0]!, buildingId: null }] };
    render(<GdbImportDialog inspection={inspection} initialPlan={brokenPlan} locale="en" busy={false} error={null} onImport={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /import/i })).toBeDisabled();
  });
});
```

- [ ] **Step 5: Run tests to verify they fail then pass**

Run: `pnpm exec vitest run GdbImportDialog`
Expected: first FAIL (module/type errors from un-applied adaptations), then PASS after Steps 2–3. Then `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/gallery/GdbImportDialog.tsx src/gallery/GdbImportDialog.test.tsx src/app/app.css
git commit -m "feat(web): port GDB review dialog wired to server plan"
```

---

### Task 6: Gallery entry + orchestration

**Files:**
- Modify: `src/gallery/GalleryPage.tsx`
- Test: `src/gallery/gallery.test.tsx`

**Interfaces:**
- Consumes: `api.inspectGdb`, `api.publishGdb`, `api.createVenue`, `api.deleteVenue`, `api.waitForJob`, `gdbErrorMessage`, `GdbError`; `GdbImportDialog`.

- [ ] **Step 1: Write the failing test** — in `src/gallery/gallery.test.tsx`, extend the top-of-file `vi.mock("./api")` factory to also expose the GDB methods, declare their `vi.fn()`s beside `me`/`listVenues`, and add the test. The mock factory becomes:

```tsx
const me = vi.fn();
const listVenues = vi.fn();
const inspectGdb = vi.fn();
const createVenue = vi.fn();
const publishGdb = vi.fn();
const waitForJob = vi.fn();
const deleteVenue = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: () => me(),
      listVenues: () => listVenues(),
      inspectGdb: (...args: unknown[]) => inspectGdb(...args),
      createVenue: (...args: unknown[]) => createVenue(...args),
      publishGdb: (...args: unknown[]) => publishGdb(...args),
      waitForJob: (...args: unknown[]) => waitForJob(...args),
      deleteVenue: (...args: unknown[]) => deleteVenue(...args),
    },
  };
});
```

Add the test (fixtures chosen so `collectBlockingIssues` returns empty — a polygon level with a `layer-name` rule that resolves the `_1_` token):

```tsx
const gdbInspection = {
  sourceName: "Station.gdb",
  databases: [{ id: "gdb-1", name: "Station.gdb" }],
  layers: [{
    key: { databaseId: "gdb-1", layerName: "Station_1_Floor" },
    databaseName: "Station.gdb", featureCount: 3, geometryFamily: "polygon",
    fields: [{ name: "id", type: "String" }],
  }],
  warnings: [],
};
const gdbPlan = {
  venueName: "Station",
  buildings: [{ id: "b1", name: "Station" }],
  layers: [{
    key: { databaseId: "gdb-1", layerName: "Station_1_Floor" },
    included: true, targetType: "level", buildingId: "b1",
    levelRule: { kind: "layer-name" }, idField: "id",
    ordinalField: null, shortNameField: null, nameField: null, categoryField: null,
  }],
};

it("imports a geodatabase: inspect, review, publish, reload", async () => {
  me.mockResolvedValue({ id: 1, username: "daniel", role: "admin" });
  listVenues.mockResolvedValue([]);
  inspectGdb.mockResolvedValue({ blobHash: "a".repeat(64), inspection: gdbInspection, suggestedPlan: gdbPlan });
  createVenue.mockResolvedValue({ id: 9, slug: "station", name: "Station", createdAt: "" });
  publishGdb.mockResolvedValue({ jobId: "j", versionId: 1, seq: 1 });
  waitForJob.mockResolvedValue({ status: "done" });

  const user = userEvent.setup();
  const { container } = render(<GalleryPage />);
  await waitFor(() => expect(screen.getByText("データセットがありません")).toBeTruthy());
  await user.click(screen.getByRole("button", { name: "EN" }));

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], "Station.gdb.zip", { type: "application/zip" });
  await user.upload(input, file);

  await waitFor(() => expect(screen.getByRole("button", { name: "Import" })).toBeTruthy());
  await user.click(screen.getByRole("button", { name: "Import" }));

  await waitFor(() => expect(publishGdb).toHaveBeenCalledTimes(1));
  expect(createVenue).toHaveBeenCalledWith("Station");
  expect(publishGdb).toHaveBeenCalledWith(9, "a".repeat(64), expect.objectContaining({ venueName: "Station" }));
  await waitFor(() => expect(listVenues).toHaveBeenCalledTimes(2));
});
```

The entry button uses the exact name `Import Geodatabase`; the dialog's confirm button is exactly `Import` — `getByRole("button", { name: "Import" })` matches only the latter. `user.upload` fires the input's change directly, bypassing the OS file dialog that `startGdbImport`'s hidden-input click can't open under jsdom.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run gallery.test`
Expected: FAIL — no "Import Geodatabase" control.

- [ ] **Step 3: Implement the entry + flow in `GalleryPage.tsx`**

Add imports:

```ts
import { useRef } from "react";
import { api, gdbErrorMessage, type GdbError /* + existing */ } from "./api";
import { GdbImportDialog } from "./GdbImportDialog";
import type { GdbInspectResponse } from "../gdb/types";
```

Add UI copy to the `ui` object:

```ts
importGdb: { ja: "Geodatabase を取り込む", en: "Import Geodatabase" },
inspecting: { ja: "検査中…", en: "Inspecting…" },
```

Add a GDB flow state + a hidden file input ref:

```ts
type GdbFlow =
  | { phase: "idle" }
  | { phase: "inspecting" }
  | { phase: "review"; data: GdbInspectResponse; busy: boolean; error: GdbError | null }
  | { phase: "error"; message: string };

const [gdbFlow, setGdbFlow] = useState<GdbFlow>({ phase: "idle" });
const gdbInputRef = useRef<HTMLInputElement>(null);
```

Add handlers:

```ts
const startGdbImport = () => gdbInputRef.current?.click();

const onGdbFile = (file: File | undefined) => {
  if (!file) return;
  setGdbFlow({ phase: "inspecting" });
  void (async () => {
    try {
      const data = await api.inspectGdb(file);
      setGdbFlow({ phase: "review", data, busy: false, error: null });
    } catch (err) {
      setGdbFlow({ phase: "error", message: gdbErrorMessage(err as GdbError, locale) });
    }
  })();
};

const publishGdbPlan = (plan: GdbInspectResponse["suggestedPlan"]) => {
  setGdbFlow((prev) => (prev.phase === "review" ? { ...prev, busy: true, error: null } : prev));
  void (async () => {
    const data = gdbFlow.phase === "review" ? gdbFlow.data : null;
    if (!data) return;
    let venueId: number | null = null;
    try {
      const venue = await api.createVenue(plan.venueName.trim());
      venueId = venue.id;
      const { jobId } = await api.publishGdb(venue.id, data.blobHash, plan);
      const job = await api.waitForJob(jobId);
      if (job.status === "done") {
        setGdbFlow({ phase: "idle" });
        await reload();
      } else {
        setGdbFlow((prev) => prev.phase === "review"
          ? { ...prev, busy: false, error: { code: "gdb_conversion_failed", message: job.error } }
          : prev);
      }
    } catch (err) {
      // Synchronous publish 400 before any version row: delete the orphan venue.
      if (venueId !== null) { try { await api.deleteVenue(venueId); } catch { /* best effort */ } }
      setGdbFlow((prev) => prev.phase === "review"
        ? { ...prev, busy: false, error: err as GdbError }
        : prev);
    }
  })();
};
```

Add the button to the ready-state actions (next to the existing upload/open-local action in the gallery body) plus the hidden input and the dialog render (near the existing `UploadModal` render):

```tsx
<button type="button" className="chip" onClick={startGdbImport}>{ui.importGdb[locale]}</button>
<input
  ref={gdbInputRef}
  type="file"
  accept=".zip,.gdb.zip"
  style={{ display: "none" }}
  onChange={(e) => onGdbFile(e.target.files?.[0])}
/>
{gdbFlow.phase === "inspecting" ? <div className="gallery-toast">{ui.inspecting[locale]}</div> : null}
{gdbFlow.phase === "error" ? <div className="gallery-toast gallery-toast--error">{gdbFlow.message}</div> : null}
{gdbFlow.phase === "review" ? (
  <GdbImportDialog
    inspection={gdbFlow.data.inspection}
    initialPlan={gdbFlow.data.suggestedPlan}
    locale={locale}
    busy={gdbFlow.busy}
    error={gdbFlow.error}
    onImport={publishGdbPlan}
    onCancel={() => setGdbFlow({ phase: "idle" })}
  />
) : null}
```

(If `.gallery-toast` styles don't exist, add minimal rules to `app.css`, or reuse an existing notification class present in the file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run gallery.test && pnpm exec tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/gallery/GalleryPage.tsx src/gallery/gallery.test.tsx src/app/app.css
git commit -m "feat(web): add Import Geodatabase gallery flow"
```

---

### Task 7: Full verification + real-fixture smoke

**Files:** none (verification only).

- [ ] **Step 1: Typecheck both packages**

Run: `pnpm exec tsc --noEmit && pnpm --dir server exec tsc --noEmit`
Expected: both clean.

- [ ] **Step 2: Run full client + server suites**

Run: `pnpm exec vitest run` and `KIRIKO_GDB_SMOKE=/home/apollo/Downloads/JRTokyoSta_3857.gdb.zip pnpm --dir server exec vitest run`
Expected: all pass, including the real-fixture `gdbSmoke`.

- [ ] **Step 3: Manual browser smoke against the Tokyo fixture**

Start dev servers (`KIRIKO_BOOTSTRAP_USER=admin KIRIKO_BOOTSTRAP_PASSWORD=… pnpm dev:server` + `pnpm dev`), sign in, click **Import Geodatabase**, choose `/home/apollo/Downloads/JRTokyoSta_3857.gdb.zip`. Confirm: inspect returns ~318 layers; the dialog opens with a near-publish-ready plan (~272 layers pre-included, buildings populated); Import is enabled (no blocking issues); publish succeeds; the venue appears in the gallery and opens in the viewer.

- [ ] **Step 4: Commit any smoke-driven fixes** (only if needed), otherwise done.
</content>
