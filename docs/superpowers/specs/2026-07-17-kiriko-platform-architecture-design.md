# Kiriko Platform Architecture

**Date:** 2026-07-17
**Status:** Approved design; implementation contract reconciled through Phase Three on 2026-07-18
**Scope:** System architecture for the Kiriko platform — backend, shared client core, web app, embeds, and customer SDKs. This spec records implemented boundaries separately from future phases; each phase retains its own detailed plan.

## 1. Context

Kiriko is now a React/MapLibre IMDF review application backed by Fastify, SQLite, immutable KVB bundles, and version-pinned map issues (see `PRODUCT.md`, `DESIGN.md`). The longer-term vision remains a Forma/ACC-style platform for indoor GIS: review datasets with pinned issues, embed venue maps into websites, and sell SDKs for map and indoor-navigation applications — from simple shopping-center maps to advanced in-station navigation. JRE Consultants already sells station map access, store information, and beacon/wifi positioning; Kiriko is the platform that future versions of those offerings build on.

### Constraints (decided during brainstorming)

- **Hosting:** internal office server first, designed container-ready so it can move to cloud without rework. No cloud-only dependencies.
- **Team:** one developer plus AI agents. Minimal operational surface; boring, debuggable technology; no polyglot sprawl unless it pays for itself.
- **On-device requirements:** both positioning (beacon/wifi fusion) and routing run on the phone. Navigation must work in crowded underground concourses regardless of connectivity. This mandates a real shared native core.
- **Relationship to existing commercial systems:** parallel for now. Kiriko owns its own data model; integrating the existing map/store/beacon products is a future importer, not a present constraint.
- **Core language:** Rust. Best-in-class WASM output, first-class Swift/Kotlin bindings via UniFFI, and the backend can reuse the same crate server-side.
- **Backend language:** TypeScript (Option B below).

### The two-decision framing

"What backend works best with WASM, Kotlin, and iOS" is two independent decisions:

1. **The backend service** — stores and serves data. All client platforms speak HTTP/JSON to it; its language is chosen for team velocity and ops, not for client compatibility.
2. **The shared client core** — code that runs *inside* the web app (WASM), Android (Kotlin), and iOS (Swift): venue-data handling, routing, positioning. This is the strategically valuable IP of the SDK business and the place where "write once, run on three platforms" matters.

### Options considered

- **A — All-Rust (Axum backend + core):** maximum coherence, single binary; but CRUD/auth/uploads in Rust is the slowest-iterating choice and everything blocks on Rust fluency.
- **B — Thin TypeScript backend + Rust core (chosen):** TS for HTTP/auth/CRUD (the developer's daily language, same shape as the 3D Tiles Viewer server already in operation), Rust for everything that touches venue data — reused server-side via a Node addon so no logic is duplicated across languages.
- **C — C#/.NET backend + Rust core:** strongest language for the service but a third ecosystem sharing nothing with the frontend or core; weaker Rust interop than Node.

## 2. System overview

```
┌─────────────────────────────────────────────────────────────┐
│  kiriko-server (TypeScript · Fastify · SQLite · disk store) │
│  auth · datasets · issues · publish pipeline · registry     │
│         └── calls kiriko-core via Node addon for:           │
│             inspect source → compile deterministic bundle    │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTP/JSON (OpenAPI)          │ venue bundles (static, CDN-able)
   ┌───────────┴───────────┐      ┌───────────┴──────────────────────┐
   │ Kiriko web app        │      │ SDKs                             │
   │ (React, existing)     │      │  web:     kiriko-core → WASM     │
   │ viewer/review/gallery │      │  Android: kiriko-core → UniFFI   │
   │ + embeds (?embed=1)   │      │  iOS:     kiriko-core → UniFFI   │
   └───────────────────────┘      │  + MapLibre GL JS / Native       │
                                  └──────────────────────────────────┘
```

Principles:

- **kiriko-core (Rust) is the single source of truth** for everything that interprets venue data. If the server "understands" a venue file, it does so by calling the core.
- **kiriko-server (TS) moves bytes and enforces auth.** It never parses geometry itself.
- **Rendering is MapLibre on every platform** (GL JS on web, MapLibre Native on iOS/Android). Kiriko builds the data, routing, and positioning that feed a renderer — not a renderer.
- **Embeds are the existing web app in embed mode**, served from the same origin. No separate embed runtime.
- **The venue bundle is the product's atom** (§5): one immutable file consumed identically by web app, embeds, SDKs, and server.

## 3. kiriko-core (Rust workspace)

| Crate | Purpose | Ships in |
|---|---|---|
| `kiriko-model` | Pure shared venue model, strict IMDF import, canonicalization, and validation warnings; no binding dependencies | shared core |
| `kiriko-bundle` | Pure shared KVB1 encode/decode, versioning, integrity, and deterministic compilation; no binding dependencies | shared core |
| `kiriko-node` | napi-rs adapter exposing asynchronous IMDF compilation plus synchronous source/bundle anchor inspection to the TypeScript server | server |
| `kiriko-wasm` | wasm-bindgen adapter exposing bundle decoding to the browser bundle worker | web |
| `kiriko-route` | Walkable-network extraction (openings, corridors, conveyances), A* with floor changes, accessibility profiles (e.g. avoid stairs) | server (build graph), clients (query routes) |
| `kiriko-position` | Beacon/wifi fingerprint model + fusion filter → position estimate. **Stub crate until fingerprint data exists**; the boundary exists from day one | mobile SDKs |
| `kiriko-ffi` | UniFFI definitions → generated Swift package + Kotlin/Android bindings | mobile |

Key property for the current core: **the server compiles strict IMDF once and every dataset-backed web viewer decodes that immutable KVB through WASM.** Future routing work will add publish-time graph building and on-device querying without changing that ownership boundary.

The deliberate duplication boundary is limited by provenance: published datasets always fetch `.kvb` and decode through `kiriko-wasm`, while direct local uploads, dropped files, and explicit `?src=` ZIP URLs continue through `src/imdf/imdf.worker.ts` and the TypeScript normalizer. Golden-fixture conformance tests keep the Rust and TypeScript projections aligned. Local/source loads have no public version identity and therefore start no review issue API or SSE work; the server never exposes retained source ZIPs as public read routes.

## 4. kiriko-server (TypeScript)

One Node process (Fastify, Node.js 24 deployment floor with Node.js 26 compatibility), one SQLite database, one content-addressed blob directory. Runs under systemd on the office server today; one container on any platform tomorrow.

### Implemented data model (SQLite)

```
users         id · username · password_hash · role (admin | member | viewer)
tenants       id · name · slug
venues        id · tenant_id · slug · name · created_by · created_at
versions      id · venue_id · seq · public_id (permanent random 64-hex identity)
              · source_blob_hash · bundle_hash · status
              · source_kind · stats_json · error · created_at
blobs         hash · size · created_at
comment_state version_id · revision · next_pin_number
comments      id · version_id · parent_id · author_id
              · create_request_id · create_request_hash · pin_number
              · level_id · longitude · latitude · feature_id
              · body_markdown · status · assignee_id · due_date
              · row_version · created_at · updated_at · deleted_at
```

Root comments are map-anchored review issues; child comments are replies. `versions.public_id`, not a venue slug, sequence, or bundle hash, is the review resource identity. It is generated at version-row creation and never reused, including after venue deletion and slug recreation. `comment_state.revision` is the version-scoped monotonic collection revision, while `comments.row_version` is the optimistic-concurrency token for one issue or reply.

### Storage layout

Source uploads and compiled bundles occupy independent content-addressed blobs:

```
data/kiriko.db
blobs/sha256/<aa>/<hash>     ← retained source IMDF/GDB ZIPs
blobs/sha256/<aa>/<hash>     ← compiled KVB bundles
```

Each version records both `source_blob_hash` and `bundle_hash`; publishing compiles from the retained source and never treats source bytes as a bundle. Bundles are immutable, and both successful publish and legacy backfill update a version transactionally only if the compiled source identity still matches that version. Publishing never overwrites; rollback is repointing.

### Implemented API surface

Fastify validates the JSON contracts exposed in its generated OpenAPI document. The current web client uses:

```
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
GET/POST /api/venues
DELETE   /api/venues/:id
POST /api/venues/:id/versions
GET  /api/jobs/:id
GET  /v/:tenant/:venue/bundle
GET  /v/:tenant/:venue/bundle@:seq

GET/POST /api/review/versions/:publicVersionId/issues
GET      /api/review/versions/:publicVersionId/issues/events
GET      /api/reviewers
POST     /api/issues/:issueId/replies
PATCH/DELETE /api/issues/:issueId
PATCH/DELETE /api/replies/:replyId
```

Both latest and pinned bundle responses carry `Kiriko-Version-Id: <versions.public_id>`, including conditional `304` responses. The latest route revalidates; the pinned route is immutable. `ETag` remains the bundle content hash and is intentionally distinct from the permanent review identity. Issue reads are public for an existing version; mutations and reviewer lookup require a session. Mutations use client request IDs for idempotent creation and `expectedVersion` for optimistic concurrency. The SSE stream carries only monotonic revision notifications, so clients always refetch canonical state and coalesce bursts.

### Publish pipeline

Upload → source blob store → in-process job queue (no Redis) → **`kiriko-node`**: inspect the source anchor, parse + validate strict IMDF, compile deterministic KVB → write bundle blob → transactionally publish only the matching version/source anchor. Legacy rows use the same compiler and identity guard during startup backfill. GDB ingest and routing-graph construction remain future work.

### Auth

Sessions for humans, scoped API keys for machines (SDKs, customer-site embeds). Key scopes: per-tenant + per-venue read, tiered by capability (§6). Publishing requires a human session. SSO/OIDC deferred until an enterprise customer requires it; it bolts onto the session layer.

### Ops posture

Single process; SQLite with Litestream-style continuous backup to a second disk/NAS; logs to stdout. Deliberate simplifications, with the seams where scale-up screws in later: queue behind an interface (→ external queue), storage behind a driver (→ S3), DB access behind a repository layer (→ Postgres). None of these are needed at office scale.

## 5. The venue bundle (`.kvb`)

KVB1 is a deterministic, content-addressed container. Its 52-byte envelope is:

```text
0..4   magic = 4b 56 42 00 ("KVB\0")
4..6   major = little-endian u16 = 1
6..8   minor = little-endian u16 = 0
8..12  flags = little-endian u32; bit 0 means zstd
12..20 uncompressed payload length = little-endian u64
20..52 SHA-256 of the uncompressed payload
52..   exactly one zstd frame
```

The uncompressed payload starts with a little-endian `u16` section count followed by fixed 20-byte directory rows `(id: u16, version: u16, offset: u64, length: u64)`, sorted by strictly ascending ID. KVB1 assigns IDs `1 manifest`, `2 geometry`, `3 stores`, `4 style`, `5 graph`, and `6 beacons`. Phase Two requires and emits sections 1–3 only; IDs 4–6 are reserved and are not emitted. Section payload version is `1`. The decoder rejects missing, duplicate, overlapping, out-of-bounds, or unsupported required sections; rejects unknown envelope major versions before section interpretation; and caps declared uncompressed payloads at 512 MiB.

The zstd frame is produced at level 9 with checksum and pledged content size enabled and no worker threads. The decoder verifies the declared length and SHA-256 before decoding section payloads. Changing serialization or compression dependencies/settings requires a bundle-version decision and a reviewed golden update.

Published clients download one immutable `.kvb`, cache by hash, revalidate the latest URL by ETag, and decode it through `kiriko-bundle` via the platform adapter.

## 6. SDKs

Three packages, one shape — thin idiomatic wrappers around the same core:

- **`@kiriko/web`** (npm): WASM core + MapLibre GL JS integration layer (bundle → sources/layers, level switching, route drawing). Customer tiers: **iframe embed** (zero-code, the `?embed=1` app) and the **JS SDK** for full map applications.
- **`KirikoKit`** (Swift Package, SPM): UniFFI-generated Swift + async/await API client (OpenAPI-generated) + MapLibre Native helpers.
- **`com.kiriko:sdk`** (Maven/AAR): UniFFI Kotlin bindings + coroutines API client + MapLibre Native helpers.

**Capability tiers map to API-key scopes** — the commercial lever:
Tier 1 map display → Tier 2 store info + search → Tier 3 on-device routing → Tier 4 positioning. A customer starts on an iframe embed and upgrades tiers without replatforming.

## 7. Testing strategy

- **Rust core:** strict-import, geometry, canonicalization, KVB integrity/determinism, native/WASM binding, and golden-file round-trip tests. Native inspection verifies source and bundle anchors without compiling on request.
- **Conformance vectors:** the minimal IMDF fixture and committed KVB golden prove byte-identical native compilation and equivalent TypeScript local-ZIP projection.
- **Server:** repository/service/API tests against real SQLite files cover source-identity pinning, permanent public version IDs, transactionality, mutation permissions/idempotency/concurrency, bounded SSE streams, and stale publish-job isolation.
- **Web app:** Vitest covers provenance admission, monotonic revision synchronization, Markdown safety, issue state, map pins/camera, auth recovery, and accessibility. Playwright exercises the live publish/bundle/review lifecycle in Chromium and Firefox and proves embed/local/source provenance starts zero issue requests.

## 8. Phasing

Phases 1–3 are implemented; later phases remain planned:

1. **kiriko-server MVP — complete:** auth, venue/version upload and publishing, blob storage, gallery, and viewer entry.
2. **kiriko-core v0 — complete:** strict `kiriko-model`, deterministic `kiriko-bundle`, napi-rs compile/inspect bindings, WASM bundle decoding, dataset cutover, and removal of public raw-archive routes.
3. **Version-pinned review issues — complete:** permanent version identity, transactional issue/reply repository, permissions and anchor checks, bounded SSE revision signals, provenance-safe web synchronization, Markdown issue panel, map pins/placement/camera, responsive/auth/accessibility integration, and Chromium/Firefox acceptance.
4. **kiriko-route + `@kiriko/web` — planned:** routing on web; embeds get directions; GDB ingest joins the publish pipeline (server-side GDAL).
5. **Mobile SDKs — planned:** UniFFI bindings, KirikoKit + Android SDK: map + stores + routing.
6. **kiriko-position — planned:** when station fingerprint data exists to calibrate against.

## 9. Risks and open questions

- **Rust learning curve:** mitigated by starting the core small (model + bundle codec) while the TS backend carries product velocity; agents author Rust well and the compiler catches integration mistakes.
- **UniFFI + WASM from one crate set** requires discipline about which crates use which std features; the workspace splits bindings into dedicated crates for this reason.
- **Positioning quality** (kiriko-position) is a research effort dependent on fingerprint data access — intentionally unscheduled.
- **MapLibre Native API churn** on iOS/Android is outside our control; SDK helpers wrap it thinly so churn stays in the helper layer.
- **Bundle format evolution:** `kvb` carries a format version from day one; the decoder rejects newer majors; the server can recompile bundles from retained source uploads at any time.
