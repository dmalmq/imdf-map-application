# Kiriko: Point-Facility POIs — Markers + Route-to-Facility

**Date:** 2026-07-20
**Status:** Approved (design direction)
**Depends on:** kiriko-route slice (`2026-07-20-kiriko-route-slice-design.md`) — KVB §5 graph, `routeBundle` WASM query, combined GDB import; kiriko-core; server GDB pipeline.

## 1. Context

The customer's Tokyo dataset ships a third File Geodatabase, `point_facility_WebMercator_202006.gdb` (EPSG:3857), alongside the venue and network GDBs. Its `point_facility_network` layer holds **2,426 named facilities/stores**, each carrying:

- `name` (e.g. `博多らーめん由丸　八重洲店`), `category`, `floor` (`F1`/`B1`/…), `symbol_id` (e.g. `1039_0300`), `image` (icon path like `/marker/escalator.png`, often empty for stores), `pict_scale`, `min_zoom_level`/`max_zoom_level`, Point geometry.
- **Routing linkage:** `nodeid1`/`nodeid2` (net_junction node ids), `node1_len`/`node2_len` (distances), `pathid`.

The routing slice already publishes a KVB `§5 graph` from the network GDB and routes between two tapped points via `routeBundle`. 34 generic facility marker icons are staged at `src/map/icons/marker/` (from a prior session). Named-store and building icons are **not** available.

The existing viewer renders IMDF unit/amenity markers as DOM bubbles (curated JIS/Maki icons, capped 200/level). Point facilities are a separate, larger dataset better suited to a GL symbol layer.

## 2. Goal

Import point facilities as a third combined-import layer, render them as floor-aware GL symbol markers, and let a user tap a facility and **route to it** using its pre-linked network node — reusing the A\* already shipped.

## 3. Scope decisions (locked in brainstorming)

- **Full loop:** markers **and** route-to-facility.
- **Icons:** resolve `image` basename → staged `src/map/icons/marker/<name>.png`; missing → generic **pin**.
- **New KVB section id 7 `facilities`** (not folded into IMDF).
- **Route anchor:** at build time, resolve each facility's `nodeid1` → that graph node's `(lon,lat,ordinal)`, stored as the facility's route anchor. Tap → existing `route(origin, anchor)`. No new query.
- **Source layer:** `point_facility_network` (has metadata + node linkage).

### Non-goals
`wifi`/`beacon` layers (positioning, Phase 6) · `floor_all`/`not_ar` polygons · store/building icons not on hand (pin fallback) · facility name search · label-collision tuning beyond zoom gating · changes to the existing IMDF DOM marker system · `nodeid2` secondary anchor (use `nodeid1` only this phase).

## 4. Architecture

```
Combined GDB import: venue.gdb + network.gdb + point_facility.gdb
  server (gdal3.js): extract point_facility_network → WGS84 GeoJSON
    → kiriko-node compile:
        build graph (existing) → build facilities:
          kiriko-facilities parses GeoJSON → Facilities
            floor→ordinal (reuse kiriko_route::floor_to_ordinal)
            resolve nodeid1 → anchor (lon,lat,ordinal) from the built graph
        → kiriko-bundle encodes §5 graph + §7 facilities
  → published .kvb (§1-3 + §5 + §7)
  → wasm decode §7 → viewer GL symbol layer + tap → route to anchor
```

Boundary unchanged: GDAL stays in TypeScript; all facility interpretation (parse, floor map, anchor resolution) is Rust.

## 5. `kiriko-facilities` crate

New pure crate `core/crates/kiriko-facilities` (no binding deps), mirroring `kiriko-route`.

### 5.1 Types

```rust
pub struct Facilities { pub items: Vec<Facility> }

pub struct Facility {
    pub lon: f64,
    pub lat: f64,
    pub ordinal: f64,
    pub name: String,        // "" when source empty
    pub icon: String,        // image basename without extension, "" → pin
    pub anchor: Option<FacilityAnchor>, // None when nodeid1 missing/unresolved
}

pub struct FacilityAnchor { pub lon: f64, pub lat: f64, pub ordinal: f64 }
```

### 5.2 Build

```rust
pub fn build_facilities(
    facilities_geojson: &str,
    graph: &kiriko_route::RouteGraph,
    node_id_index: &BTreeMap<u64, u32>, // NODEID → node index, from graph build
) -> Result<(Facilities, Vec<FacilityBuildWarning>), FacilityBuildError>;
```

1. Parse `point_facility_network` FeatureCollection.
2. Per feature: `name` (trim; "" allowed), Point `(lon,lat)`, `floor`→ordinal via `kiriko_route::floor_to_ordinal` (unmappable → drop + warn `unmapped_floor`).
3. Icon: `image` basename minus extension (e.g. `/marker/escalator.png` → `escalator`); empty/absent → `""`.
4. Anchor: read `nodeid1` (u64); look up in `node_id_index`; anchor = that node's `(lon,lat,ordinal)`. Missing id / `-1` / not in graph → `anchor = None` + warn `unresolved_anchor` (facility still rendered, not routable).
5. Deterministic order: sort by `(ordinal, lon, lat, name)`.

**Requires** the graph build to expose its `NODEID → index` map. Add that to `kiriko_route::build_route_graph`'s return (a `node_ids: Vec<u64>` parallel to nodes, or a returned map) so facilities can resolve anchors. This is an additive change to the route build signature.

## 6. KVB section 7 (`facilities`)

`kiriko-bundle`: add section id **7** (`SECTION_FACILITIES`), version 1, postcard DTO (mirrors §5 style), `canonical_f64` on every coordinate.

- `BundleDocument.facilities: Option<Facilities>`.
- `encode_bundle` emits §7 iff `Some` and non-empty, after §5 (directory stays id-ascending: …,5,7).
- `decode_bundle` populates `facilities`; absent → `None`.
- Backward compatible (extra optional section; older decoders ignore it). No format major/minor bump.
- Golden round-trip + determinism + absent-section tests.
- Document id 7 in `format.rs` (currently 1-6 defined; 7 is a new allocation for facilities).

## 7. `kiriko-node` (compile integration)

`compile_imdf_with_network` (or a superseding entry) gains optional `facilities_geojson: Option<&str>`.

- When present (and a graph was built): call `kiriko_facilities::build_facilities(...)`, set `document.facilities`, fold warnings into the warning channel (new `WarningCode::FacilityBuild`).
- Facilities without a network/graph: render-only — anchors all `None`; still embed §7 so markers show (warn once).
- napi `compileImdf` gains an optional `facilitiesGeoJson` param.

Add `facility_build` to the server bridge `ViewerWarningCode` allowlist and the client type (the same place the routing slice added `route_build`).

## 8. `kiriko-wasm`

- `decodeBundle` result gains `hasFacilities` (mirrors `hasGraph`).
- New `facilities(bundle)` → `[{ lon, lat, ordinal, name, icon, anchor: {lon,lat,ordinal}|null }]` (serde-wasm-bindgen, camelCase js_name), or empty when no §7.

## 9. Server — combined import (third layer)

- `POST /api/gdb/inspect-facilities`: stage blob, confirm `point_facility_network` present, return `{ facilitiesBlobHash, facilityCount, floors }`.
- `GdbPublishRequest` gains optional `facilitiesBlobHash`.
- Publish: when set, extract `point_facility_network` → WGS84 GeoJSON (new `extractFacilitiesGeoJson` in `server/src/gdb/facilities.ts`, mirroring `network.ts`), store as blob, thread the hash through the publish job → `compileImdf(..., facilitiesGeoJson)`.
- Missing blob → 404; missing layer → 400 `missing_facility_layer`.
- `types.ts` (server + client mirror): `FacilitiesInspectResponse`, `facilitiesBlobHash`.

## 10. Client — import UX

- GDB flow gains a second optional file input: **Add point facilities (optional)** → `inspectGdbFacilities` → store summary/hash in flow state → review dialog shows "Facilities: N places, K floors".
- Publish passes `facilitiesBlobHash` when present. Flow works with any subset (venue only / +network / +facilities).

## 11. Viewer — markers + route-to-facility

- Bundle worker exposes decoded facilities + `hasFacilities`.
- Register staged marker icons + a generic pin as MapLibre images; build a GeoJSON source of facilities with `{ icon, name, ordinal }`.
- New **GL symbol layer** on the indoor map: `icon-image` = resolved icon or `pin`, filtered to the active floor ordinal, `text-field` = name at close zoom, sized per a fixed scale (source `pict_scale` guides relative size; zoom gating via `min/max_zoom_level` folded into the layer's zoom stops).
- A facility layer toggle (reuse existing control pattern).
- Tap a facility → popup with name + floor + **Route here**. If an origin is already set (Directions mode), route origin→anchor; else prompt "tap your start", then route. Reuse the existing per-floor route drawing from the slice. Facilities with `anchor: null` show the popup but disable **Route here**.

## 12. Testing

- **kiriko-facilities (Rust):** build from fixture (name/icon/floor/anchor), unmapped floor dropped, unresolved anchor → `None`+warn+kept, icon basename extraction, determinism.
- **kiriko-route:** `build_route_graph` now returns the NODEID→index map; existing tests updated; a test that facilities resolve a known nodeid to the right node coord.
- **kiriko-bundle:** §7 round-trip, determinism, absent → `None`, malformed rejection; §5+§7 coexist in directory order.
- **kiriko-node/wasm:** compile with facilities embeds §7; `facilities()` returns items; `hasFacilities` flag.
- **Server:** `inspect-facilities` counts; publish with `facilitiesBlobHash` → bundle carries §7; without → unchanged; missing layer → 400.
- **Client:** dialog shows facility summary; publish sends hash.
- **Viewer:** symbol layer present when `hasFacilities`; floor filter switches with level; tap → popup; **Route here** with anchor calls route and draws a line; anchor-less disables it.
- **Smoke:** import Tokyo venue + network + point-facility → viewer shows floor-aware facility markers → tap a store → Route here → route drawn.

## 13. Success criteria

- Combined import of all three Tokyo GDBs publishes one version whose `.kvb` carries §5 and §7.
- Viewer renders floor-aware facility markers (icons where available, pins otherwise), zoom-gated.
- Tapping a facility offers **Route here** and draws a route to its network anchor.
- Venue-only and venue+network imports are unaffected (no §7).
- `cargo test`, `tsc`, web/server vitest green.

## 14. Implementation order (for the plan)

1. `kiriko-route`: expose `NODEID → index` map from `build_route_graph` (additive).
2. `kiriko-facilities` crate: types + build + tests.
3. `kiriko-bundle` §7 encode/decode + tests.
4. `kiriko-node` compile integration (+`facility_build` warning) + bridge/client allowlist.
5. `kiriko-wasm` `facilities()` + `hasFacilities`.
6. Server: extract + `inspect-facilities` + publish `facilitiesBlobHash`.
7. Client: optional facility file + review summary.
8. Viewer: symbol layer + tap + Route here.
9. Verification + Tokyo smoke.

## 15. Open risks

- **Icon coverage:** most named stores fall back to pins (store icons unavailable); acceptable per decision, revisit when the full icon set arrives.
- **Anchor accuracy:** `nodeid1` may point to a node on a different floor than the facility; `node1_len` is available if snap-quality issues appear (defer).
- **Marker density:** 2,426 symbols — GL symbol layer with zoom gating handles it; watch label collisions (MapLibre default de-clutter).
- **Facilities without network:** render-only (no anchors); flagged, not blocked.
