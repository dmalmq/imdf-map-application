# GIS Dataset Sharing Platform — Design

Date: 2026-07-16
Status: Approved (brainstorming complete)

## Purpose

Pivot the existing IMDF/GDB viewer into an ACC/Forma-style sharing platform for
GIS data: GIS-capable publishers upload reviewed datasets (Shinjuku, Shibuya,
Tokyo Station, ...); colleagues without ArcGIS Pro/QGIS pick a dataset from a
gallery and review it in the browser, leave comments, and embed datasets in
other websites.

## Decisions record

| Question | Decision |
|---|---|
| Hosting | One small intranet server for everything (app, dataset blobs, catalog, comments). |
| Access control | Basic accounts (roles `admin`/`user`), write-gated: reads are public on the intranet so embeds work over plain HTTP; publishing/deleting requires `admin`; commenting requires a signed-in account. Intranet/VPN remains the network boundary. |
| Source formats | GDB only (plus existing IMDF ZIPs). Shapefiles deferred. |
| Publishers | The author plus a few GIS-capable colleagues; publish flow must be self-explanatory but stays in-app. |
| Colleague features | View, deep links, and in-app comments with map pins. |
| Architecture | Approach A: publish-time snapshot bundles. Conversion and mapping review happen once, in the publisher's browser; colleagues only fetch pre-converted artifacts. |
| GDB fidelity | Original GDB fields/columns are preserved verbatim and are the primary feature-details presentation. No coercion into IMDF fields. |
| iOS/Android, navigation | Dropped from scope (future additions). |

## 1. Product shape

One app, three entries selected by URL:

| Entry | Audience | Behavior |
|---|---|---|
| `/` (no params) | Colleagues | Gallery: dataset cards from the server catalog; click opens the viewer. Also an "open local data" section (current dropzone) for publishers. |
| `/?dataset=<id>` | Colleagues | Viewer loads the published dataset. All existing viewer features apply: floors, search, selection, themes, `level=`, `lang=`, `theme=`. |
| `/?dataset=<id>&embed=1` | Websites | Existing embed mode addressing published datasets. `?src=<url>` keeps working unchanged. |

Publishing stays inside the app: review a GDB import (existing dialog,
exclusions and all) or open an IMDF ZIP locally, then click **Publish**, which
uploads to the server. Colleagues never see review/conversion. GDAL WASM
assets remain separate lazily fetched chunks and never load for viewers.

When the server is unreachable (local dev, static preview), the app falls back
to the current dropzone landing page; every existing local workflow keeps
working without the server.

## 2. Dataset bundle format

Two dataset kinds, distinguished by the catalog entry:

### `venue-snapshot` (GDB-derived)

A ZIP (written client-side with `@zip.js/zip.js`, the existing dependency)
containing a single entry `snapshot.json`:

```jsonc
{
  "schemaVersion": 1,
  "kind": "venue-snapshot",
  "generatedAt": "2026-07-16T12:00:00.000Z",
  "sourceName": "JRTokyoSta.gdb",
  "venue": { /* serialized LoadedVenue */ }
}
```

Serialization rules for `LoadedVenue`:

- `manifest`, `venue`, `levels`, `searchEntries`, `warnings` serialize as
  plain JSON.
- The four `Map` fields (`featuresById`, `renderFeaturesByLevel`,
  `boundsByLevel`, `enrichmentByFeatureId`) serialize as arrays of
  `[key, value]` entries and are revived to `Map`s on load.
- Loading a snapshot is pure deserialization: no re-normalization, no
  re-validation. Colleagues see exactly what the publisher reviewed.
- A `schemaVersion` other than the viewer's supported version fails loudly
  with a "this dataset needs republishing" error. No silent migration.

Fidelity guarantee: the snapshot preserves every original GDB field name and
value verbatim per feature (`ViewerFeature.sourceProperties`, already defined
as the complete original properties object), in original layer field order,
including nulls. IMDF-style derivations (level grouping, categories, icons,
search labels) are internal rendering metadata only; original columns are
never renamed, remapped, or dropped. Provenance keys (`__gdb_database`,
`__gdb_layer`, `__gdb_resolved_level_id`) are additive and prefix-marked.

Deliberate simplicity: `featuresById` and `renderFeaturesByLevel` duplicate
geometry (~2x JSON size; ZIP deflate recovers most of it). Acceptable on an
intranet; avoids exposing a partial re-normalization path.

### `imdf`

The original IMDF ZIP uploads verbatim and is loaded through the existing
strict `loadImdfArchive` path (worker parse + Apple validation), exactly like
`?src=` today.

## 3. Server

One dependency-free Node service in `server/` (TypeScript compiled to plain
JS at build time; runtime uses only `node:http`, `node:fs`, `node:path`,
`node:crypto`). Started as:

```
node server/dist/main.js --port 8080 --data <data-dir> --app <path-to-dist>
```

### API

```
POST   /api/login                          <- { username, password }; sets HttpOnly session cookie
POST   /api/logout                         -> clears the session
GET    /api/me                             -> { username, role } or 401
GET    /api/catalog                        -> { datasets: CatalogEntry[] }            (public)
PUT    /api/datasets/:id?name=...&kind=...&levelCount=...&featureCount=...&sourceName=...
                                           <- ZIP body; create or overwrite           (admin)
DELETE /api/datasets/:id                   -> removes blob + catalog entry + comments (admin)
GET    /datasets/:id.zip                   -> dataset blob (ETag from content hash)   (public)
GET    /api/datasets/:id/comments          -> { comments: Comment[] }                 (public)
POST   /api/datasets/:id/comments          <- { text, levelId?, lngLat?, featureId? } (user or admin)
DELETE /api/datasets/:id/comments/:cid     -> owner or admin
GET    /*                                  -> built app (dist/), SPA fallback to index.html
```

### Shapes

```ts
interface CatalogEntry {
  id: string;            // ^[a-z0-9][a-z0-9-]{0,63}$
  name: string;          // 1..120 chars, display name (Japanese OK)
  kind: "venue-snapshot" | "imdf";
  levelCount: number;    // client-supplied metadata, trusted (intranet)
  featureCount: number;
  sourceName: string;    // e.g. "JRTokyoSta.gdb" or "tokyo-imdf.zip"
  updatedAt: string;     // ISO, server-assigned
}

interface Comment {
  id: string;            // server-assigned UUID
  author: string;        // server-assigned from the session account
  text: string;          // 1..2000 chars
  createdAt: string;     // ISO, server-assigned
  levelId?: string;      // viewer level id the pin belongs to
  lngLat?: [number, number];
  featureId?: string;    // linked selected feature
}
```

### Storage

```
<data>/catalog.json          // single source of truth for entries
<data>/blobs/<id>.zip
<data>/comments/<id>.json    // flat array
<data>/users.json            // [{ username, role, salt, passwordHash }] (scrypt)
<data>/sessions.json         // [{ token, username, createdAt }]
```

- All writes are atomic (temp file + rename) and serialized through one
  in-process queue. Single-process service; no concurrent-writer support.
- Boot validation: catalog entries whose blob is missing are dropped with a
  log line; orphan blobs are logged and ignored.

### Limits and validation

- Upload cap 600 MiB (matches the client-side 500 MiB staging limit with
  headroom); oversize -> `413`.
- Body must be a ZIP (magic-byte check); invalid -> `400`.
- Id regex, name/kind/comment field validation -> `400` with a typed JSON
  error `{ code, message }` the client surfaces verbatim.
- Unknown dataset -> `404`.

### Accounts and sessions

- Roles: `admin` (publish, delete datasets, delete any comment) and `user`
  (comment, delete own comments). Reads (catalog, blobs, comments, app) are
  public: intranet/VPN is the read boundary, and cross-site iframe embeds
  must keep working over plain HTTP where session cookies are not sent.
- Passwords hashed with `node:crypto` scrypt (per-user random salt); verified
  with `timingSafeEqual`. Sessions are random 32-byte tokens in an HttpOnly,
  `SameSite=Lax` cookie, persisted to `sessions.json` so restarts keep users
  signed in. No expiry in v1; logout deletes the session.
- User management is CLI-only, no UI:
  `node server/dist/main.js add-user <name> --role admin|user --data <dir>`
  (prompts for the password; also used to reset one). No password reset,
  rate limiting, or lockout in v1.
- Unauthenticated write -> `401`; authenticated but wrong role -> `403`.
  Both use the typed `{ code, message }` error body.
- Known trade-off (accepted): login credentials transit the intranet as
  plain HTTP unless IT terminates TLS in front (IIS/reverse proxy). Noted in
  the README.

## 4. Frontend: gallery and dataset loading

- On `/` without `dataset`/`src`: probe `GET /api/catalog` (3-second
  timeout). Success -> gallery; failure -> current dropzone landing
  unchanged.
- Gallery card: name, kind badge (GDB snapshot / IMDF), level count, feature
  count, source name, updated date. Click -> navigate to `?dataset=<id>`.
  No thumbnails in v1.
- The gallery keeps an "open local data" section exposing the existing IMDF
  dropzone and GDB folder/archive controls for publishers.
- `?dataset=<id>` joins `viewerParams` beside `src`; when both are present,
  `dataset` wins and `src` is ignored. Loading resolves the catalog entry,
  then loads `kind`-appropriately (snapshot deserialize vs existing IMDF
  fetch path). Fetch/parse failures reuse the existing error banner and
  Retry behavior.
- Original-fields presentation: for GDB-derived features (provenance keys
  present), the selected-feature card's primary content is the original
  attribute table: every original column with its original field name and raw
  value, in original layer field order, nulls rendered explicitly, plus a
  provenance line (layer and database name from `__gdb_*` keys, which are
  excluded from the table body). The IMDF-oriented summary presentation
  (enrichment description, hours/phone/website parsing) remains for IMDF
  datasets. Search and floor switching keep using derived fields internally.
- Field names are shown raw and untranslated regardless of UI locale, by
  design.

## 5. Frontend: publish

- A Publish control is visible only when (a) a venue is loaded from local
  data (GDB conversion result or locally opened IMDF ZIP), (b) the server
  probe succeeded, and (c) the signed-in account has role `admin`.
- Publish dialog: display name (prefilled from the venue name), editable id
  slug (generated from the name), overwrite warning when the id already
  exists in the catalog, upload progress, then copyable view and embed URLs.
- GDB path serializes the live `LoadedVenue` into a snapshot ZIP in the
  browser and uploads it. IMDF path uploads the retained original `File`
  (App keeps a reference to the last locally opened archive).
- Republish to the same id overwrites; there is no version history.
- A compact account control (sign in / signed-in name / sign out) lives in
  the existing viewer menu; it drives `/api/login`, `/api/logout`, and
  `/api/me`. Signed-out users can view everything.

## 6. Frontend: comments

- Comments panel is available only when viewing `?dataset=<id>` (comments
  key off the dataset id) and hidden in embed mode; embeds link out to the
  full viewer.
- Composing requires a signed-in account (the panel shows a sign-in prompt
  otherwise): comment text, optional map pin (a "pin" mode captures one
  click as level + lngLat), optional link to the currently selected feature.
  The author is the account name, assigned server-side.
- Reading: flat list, newest first; clicking a pinned comment switches to its
  level and flies to its location; feature-linked comments select the
  feature.
- Refresh on panel open and after posting. No polling, no websockets.
- Delete is shown for the comment owner and for admins.
- Comment failures (list or post) show an inline non-blocking notice with
  retry; they never block viewing.

## 7. Error handling

- Dataset fetch/unzip/parse errors surface through the existing
  `ArchiveError` banner with Retry.
- Snapshot `schemaVersion` mismatch: explicit "republish this dataset" error
  state (not a generic parse failure).
- Publish errors surface the server's typed `{ code, message }` in the
  publish dialog; the reviewed venue stays loaded so publishing can be
  retried without re-converting.
- Server-side: atomic writes, boot consistency check, typed 4xx errors,
  500 with logged stack for unexpected faults.
- `401` on a write while signed out opens the sign-in control; `403`
  (role too low) shows the server message verbatim.

## 8. Testing

- Server (vitest, node environment, real temp data dir, ephemeral port):
  upload -> catalog -> blob fetch -> comments lifecycle; overwrite semantics;
  id/name/size validation; atomicity (no partial catalog on failed upload);
  dangling-entry recovery at boot; login/logout/me lifecycle; scrypt hash
  round-trip; write-gating matrix (anonymous/user/admin x publish, delete
  dataset, post comment, delete own/foreign comment); session persistence
  across a server restart.
- Client (vitest + testing-library, existing conventions):
  - Snapshot round-trip property: `LoadedVenue -> ZIP -> LoadedVenue`
    deep-equal including Map revival and `sourceProperties` fidelity.
  - `viewerParams`: `dataset=` parsing beside `src=`.
  - Gallery rendering from a mocked catalog; fallback to dropzone when the
    probe fails.
  - Publish dialog flow with mocked fetch (slug generation, overwrite
    warning, error surfacing).
  - Comments panel: list/post/delete with mocked fetch; pin capture wiring.
  - Account control: sign-in success/failure, me-probe on boot, publish
    visibility by role, comment composer gating.
  - Original attribute table: full column set, original order, null
    rendering, provenance exclusion.
- e2e (Playwright, real server via `webServer`): sign in as the seeded
  admin -> publish a converted dataset -> appears in gallery -> colleague
  (second account) opens it -> leaves a pinned comment -> embed deep link
  renders chrome-free with the pin's level preselected.

## 9. Deployment

- `pnpm build` builds the app; a new `pnpm build:server` compiles `server/`
  to plain JS. The service serves the built app, so one VM process is the
  whole deployment.
- Windows VM friendly: plain Node process; run under Task Scheduler or NSSM.
  Document the run command, `--data` backup note (the data dir is the entire
  persistent state), and intranet-only exposure in the README.

## 10. Future additions (explicitly deferred, not rejected)

- iOS/Android apps
- Shapefile import (loose .shp/.dbf/.prj sets)
- Comment threads, mentions, resolve/close workflow
- Per-dataset permissions, SSO/Windows-integrated auth, password reset and
  account-management UI (v1 accounts are CLI-managed, write-gated only)
- Turn-by-turn navigation/routing
- Dataset version history (current: overwrite on republish)
- Multi-dataset overlay/comparison
- Gallery thumbnails (needs MapLibre `preserveDrawingBuffer` trade-off)
- Live comment updates (websockets/polling)
