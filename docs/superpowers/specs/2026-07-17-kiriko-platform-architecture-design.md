# Kiriko Platform Architecture

**Date:** 2026-07-17
**Status:** Approved design, pre-implementation
**Scope:** System architecture for the Kiriko platform — backend, shared client core, web app, embeds, and customer SDKs. This spec sets boundaries and contracts; each phase gets its own implementation plan.

## 1. Context

Kiriko today is a client-only React/MapLibre viewer for IMDF archives with the Kiriko design system applied (see `PRODUCT.md`, `DESIGN.md`). The vision is a Forma/ACC-style platform for indoor GIS: view and review datasets with pinned comments, embed venue maps into websites, and sell SDKs for map and indoor-navigation applications — from simple shopping-center maps to advanced in-station navigation. JRE Consultants already sells station map access, store information, and beacon/wifi positioning; Kiriko is the platform that future versions of those offerings build on.

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
│  auth · datasets · comments · publish pipeline · registry   │
│         └── calls kiriko-core via Node addon for:           │
│             validate → build graph → compile bundle          │
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
| `kiriko-model` | Venue/level/unit/store/beacon types, IMDF import, validation warnings (Rust twin of today's TS `src/imdf/` normalizer) | everything |
| `kiriko-bundle` | Venue-bundle format: encode/decode, versioning, integrity | everything |
| `kiriko-route` | Walkable-network extraction (openings, corridors, conveyances), A* with floor changes, accessibility profiles (e.g. avoid stairs) | server (build graph), clients (query routes) |
| `kiriko-position` | Beacon/wifi fingerprint model + fusion filter → position estimate. **Stub crate until fingerprint data exists**; the boundary exists from day one | mobile SDKs |
| `kiriko-wasm` | wasm-bindgen surface for web + the Node addon build | web, server |
| `kiriko-ffi` | UniFFI definitions → generated Swift package + Kotlin/Android bindings | mobile |

Key property: **graph building runs on the server at publish time; graph querying runs on the device.** Bundles carry the precomputed routing graph, so phones never parse raw IMDF — they load a compact binary and answer route queries locally, offline.

Accepted duplication: the core's model/validation deliberately duplicates the existing TS `src/imdf/` loader. Long-term the web viewer migrates to the WASM core and the TS loader retires; until then the golden-fixture conformance tests (§7) keep them agreeing.

## 4. kiriko-server (TypeScript)

One Node process (Fastify), one SQLite database, one content-addressed blob directory. Runs under systemd on the office server today; one container on any platform tomorrow.

### Data model (SQLite)

```
users        id · username · password_hash · role (admin | member | viewer)
api_keys     id · tenant_id · key_hash · scopes · expires_at
tenants      id · name · slug            -- JRE internal; later, customer organizations
venues       id · tenant_id · slug · name · created_by
versions     id · venue_id · seq · bundle_hash · status (draft|published|archived)
             · source_kind (imdf|gdb) · stats_json · created_at
comments     id · venue_id · version_id · author_id · level_id · lng · lat
             · body · status (open|in_review|closed) · parent_id
blobs        hash · size · created_at    -- rows mirror files on disk
```

### Storage layout

S3-compatible keys from day one so cloud migration is a storage-driver swap, not a schema change:

```
data/kiriko.db
blobs/sha256/<aa>/<hash>     ← uploads (raw IMDF/GDB zips) and compiled bundles
```

Bundles are immutable and content-addressed; `versions` points at them by hash. Publishing never overwrites; rollback is repointing.

### API surface

OpenAPI-first. The spec generates the TS client for the web app and the Swift/Kotlin API clients inside the SDKs.

```
POST /api/auth/login                    session cookie (web) | Authorization: key (SDKs)
GET  /api/venues                        list, tenant-scoped
POST /api/venues/:id/versions           upload → 202 + job id
GET  /api/jobs/:id                      publish pipeline progress
GET/POST/PATCH /api/venues/:id/comments review workflow
GET  /v/:tenant/:venue/bundle           hot path: latest published bundle
GET  /v/:tenant/:venue/bundle@:seq      pinned version
```

`/v/` routes serve static files with auth-by-API-key, ETag = bundle hash, immutable cache headers — deliberately boring so nginx or a CDN can take them over without touching the app.

### Publish pipeline

Upload → blob store → in-process job queue (`p-queue`; no Redis) → **kiriko-core via Node addon**: parse + validate (same warnings the viewer shows) → extract walkable network → build routing graph → compile bundle → write blob → flip version status. GDB ingest runs server-side GDAL here (heavy lifting belongs on the server, not in browser workers).

### Auth

Sessions for humans, scoped API keys for machines (SDKs, customer-site embeds). Key scopes: per-tenant + per-venue read, tiered by capability (§6). Publishing requires a human session. SSO/OIDC deferred until an enterprise customer requires it; it bolts onto the session layer.

### Ops posture

Single process; SQLite with Litestream-style continuous backup to a second disk/NAS; logs to stdout. Deliberate simplifications, with the seams where scale-up screws in later: queue behind an interface (→ external queue), storage behind a driver (→ S3), DB access behind a repository layer (→ Postgres). None of these are needed at office scale.

## 5. The venue bundle (`.kvb`)

zstd-compressed container, content-addressed, format-versioned (`kvb1`):

```
manifest      venue id · seq · format version · section index · display metadata
geometry      levels/units/openings/fixtures as compact binary + display points
style         category → color/icon mapping (Kiriko map palette, themeable per tenant)
stores        store/occupant records: names (ja/en) · categories · hours · unit refs
graph         precomputed routing network: nodes/edges · floor transitions · access flags
beacons       fingerprint map (empty section until positioning ships)
```

Decoded only by `kiriko-bundle` — the same decoder on web, Android, iOS, and server. Clients download one file per venue, cache by hash, revalidate by ETag, and operate fully offline afterward.

## 6. SDKs

Three packages, one shape — thin idiomatic wrappers around the same core:

- **`@kiriko/web`** (npm): WASM core + MapLibre GL JS integration layer (bundle → sources/layers, level switching, route drawing). Customer tiers: **iframe embed** (zero-code, the `?embed=1` app) and the **JS SDK** for full map applications.
- **`KirikoKit`** (Swift Package, SPM): UniFFI-generated Swift + async/await API client (OpenAPI-generated) + MapLibre Native helpers.
- **`com.kiriko:sdk`** (Maven/AAR): UniFFI Kotlin bindings + coroutines API client + MapLibre Native helpers.

**Capability tiers map to API-key scopes** — the commercial lever:
Tier 1 map display → Tier 2 store info + search → Tier 3 on-device routing → Tier 4 positioning. A customer starts on an iframe embed and upgrades tiers without replatforming.

## 7. Testing strategy

- **Rust core:** unit + property tests (routing-graph invariants: connectivity, floor-transition symmetry), golden-file round-trip tests for the bundle codec.
- **Conformance vectors (the glue):** golden test venues (the existing minimal IMDF fixture graduates into this role) + JSON test vectors ("route A→B expects this node sequence"), executed against the core on every platform in CI. Same input must produce a byte-identical bundle and identical routes on web, iPhone, and Android, or the build fails.
- **Server:** API tests against a real SQLite file in a temp dir; publish-pipeline tests use the golden venues end to end.
- **Web app:** existing vitest + Playwright suites continue; e2e grows a gallery/auth journey per phase.

## 8. Phasing

Each step ships something usable; nothing waits on the full vision.

1. **kiriko-server MVP** — auth, venues, IMDF upload → publish (validation initially in TS), serving raw archives; web-app gallery consumes it. *(Supersedes the earlier "IndexedDB local gallery" idea — with a backend this early, local-only storage is a dead end.)*
2. **kiriko-core v0** — `kiriko-model` + `kiriko-bundle`, wired into the publish pipeline via the Node addon; viewer starts reading bundles.
3. **Comments** — review workflow (pins, statuses, panel — Figma 💬 page).
4. **kiriko-route + `@kiriko/web`** — routing on web; embeds get directions; GDB ingest joins the publish pipeline (server-side GDAL).
5. **Mobile SDKs** — UniFFI bindings, KirikoKit + Android SDK: map + stores + routing.
6. **kiriko-position** — when station fingerprint data exists to calibrate against.

## 9. Risks and open questions

- **Rust learning curve:** mitigated by starting the core small (model + bundle codec) while the TS backend carries product velocity; agents author Rust well and the compiler catches integration mistakes.
- **UniFFI + WASM from one crate set** requires discipline about which crates use which std features; the workspace splits bindings into dedicated crates for this reason.
- **Positioning quality** (kiriko-position) is a research effort dependent on fingerprint data access — intentionally unscheduled.
- **MapLibre Native API churn** on iOS/Android is outside our control; SDK helpers wrap it thinly so churn stays in the helper layer.
- **Bundle format evolution:** `kvb` carries a format version from day one; the decoder rejects newer majors; the server can recompile bundles from retained source uploads at any time.
