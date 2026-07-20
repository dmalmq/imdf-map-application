# GDB Data & Routing Reference

Durable reference for the JR East Tokyo Station source data (three File Geodatabases), the routing network, point facilities, and how Kiriko turns them into a published bundle with routing. Captured 2026-07-20 from direct `ogrinfo`/`ogr2ogr` probing of the real datasets. Read this before touching GDB import, `kiriko-route`, `kiriko-facilities`, or the KVB section layout.

## Source dataset layout

The Tokyo dataset is three sibling File Geodatabases (all **EPSG:3857 / WebMercator**; Kiriko reprojects to **EPSG:4326 / WGS84** on import via `ogr2ogr -t_srs EPSG:4326`):

```
tokyo station/
  JRTokyoSta_3857.gdb                 ← venue geometry (IMDF-shaped)
  network_WebMercator.gdb             ← routing graph (nodes + edges)
  point_facility_WebMercator_202006.gdb  ← POIs, wifi, beacons, floor outlines
```

A File Geodatabase is a **directory**; upload/inspection expects it zipped as `<name>.gdb.zip`. gdal3.js's OpenFileGDB driver sniffs the `.gdb.zip`/`.zip` extension, so a blob with no extension must be staged to a `*.gdb.zip` path first (`server/src/gdb/staging.ts`).

## 1. Venue GDB — `JRTokyoSta_3857.gdb`

- **318 layers.** Geometry families: **139 line / 170 polygon / 9 point**.
- Per-building/per-floor layers named `<Building>_<Floor>_<Kind>`:
  - `*_Drawing` (MultiLineString) — walls / detail linework, **not routable**.
  - `*_Opening` (MultiLineString) — IMDF openings (doorway connections); the standard IMDF connectivity signal. Fields: `id, floor_id, name, source, Shape_Length`.
  - `*_detail`, `*_opening` (lowercase variants for some buildings, e.g. `TOFROM_YAESU_*`) carry `category, level_id, access_con, door, …`.
  - Polygon layers are the walkable spaces / fixtures (units).
- Also outdoor/context lines: `軌道の中心線_*` (rail track centerlines), `道路縁`/`道路構成線` (road edges), `Free_shuttle_bus_*ルート` (outdoor shuttle bus routes). **None of these is an indoor pedestrian routing network** — the venue GDB alone has no routing graph.
- This GDB is what the existing GDB import converts into synthesized IMDF (`server/src/gdb/*`), compiled to KVB by the Rust core.

## 2. Network GDB — `network_WebMercator.gdb` (routing graph)

- **68 layers.** The canonical graph is two layers; the rest are per-floor / inter-floor slices of it.
- **`net_junction`** — Point, **10,118 nodes**. Fields:
  - `NODEID` (unique node id), `FLOOR` (`F1`/`B1`/`F36`/`M2`…), `altitude`, `relative_height`, `PATH_COUNT` (degree), `BARRIER`, `GATE`, `STARTTIME`/`ENDTIME` (time windows, `-1` = none), `NAME`.
- **`net_path`** — MultiLineString, **25,625 edges**. Fields:
  - `FNODEID`→`TNODEID` (endpoint NODEIDs), `cost` (integer edge weight — **already encodes passage penalty**: a 2 m walk ≈ 2k, a floor change ≈ 32k), `passage_type`, `direction` (one-way hint; often null/0 = bidirectional), `FLOOR`, `PATHID`/`RPATHID` (forward/reverse ids), `BARRIER`, `RFLAG`, `HFLAG`, `STARTTIME`/`ENDTIME`, altitudes.
- **`*_link` layers** (e.g. `JRTokyoSt_1_link`, `TokyoSt_F5_to_F6_link`) — per-floor and inter-floor decompositions of the same graph, with `node1`/`node2`/`path_cost`/`FLOOR1`/`FLOOR2`/`passage_type`/`start_altitude`/`end_altitude`. **Not the canonical source** — use `net_junction` + `net_path`.

## 3. Point-facility GDB — `point_facility_WebMercator_202006.gdb`

- **8 layers:**
  | layer | geom | feats | use |
  |---|---|---|---|
  | `point_facility_network` | Point | 2426 | **canonical POIs** — metadata + routing linkage |
  | `point_facility` | Point | 2426 | POIs (icon-styling variant) |
  | `Facility_Merge` | Point | 2591 | merged POIs incl. building/area overlays |
  | `Facility_Merge_tap` | Point | 135 | tappable/labeled subset |
  | `wifi` | Point | 288 | WiFi APs (positioning — Phase 6) |
  | `beacon` | Point | 540 | beacons (positioning — Phase 6) |
  | `floor_all` | MultiPolygon | 16 | per-floor outline polygons |
  | `not_ar` | MultiPolygon | 5 | (non-AR regions) |
- **Facility fields** (`point_facility_network`): `name` (store/facility name, e.g. `博多らーめん由丸　八重洲店`), `category` (`movement`, `Tickets`, `area`, …), `floor`, `symbol_id` (e.g. `1039_0300`; generic facilities may instead carry `image`), `image` (icon path like `/marker/escalator.png`; **empty for most named stores**), `pict_scale` (icon scale 0.08–0.48), `min_zoom_level`/`max_zoom_level`, `w3` (location description, e.g. `B1F改札内` = inside ticket gate), `altitude`, and **routing linkage**: `nodeid1`/`nodeid2` (net_junction NODEIDs, `-1` = none), `node1_len`/`node2_len` (distance to node), `pathid`, `node_index`.

## Floor labels → ordinals

Network and facility `FLOOR`/`floor` labels map to venue level ordinals (`kiriko_route::floor_to_ordinal`):

- `F<n>` → `n - 1`  (F1 = ground = ordinal 0; F36 → 35)
- `B<n>` → `-n`     (B1 → -1; B5 → -5)
- `M<n>` → `(n - 1) + 0.5`  (mezzanine above floor n)
- anything else → unmapped → node/facility dropped with a warning.

## Icons

- 34 generic facility PNGs are staged at `src/map/icons/marker/` (elevator, escalator, stairs_up/down, ticket, locker, bus, taxi, male/female/unisex, info, smoking, …).
- Facilities reference icons via the `image` field basename (`/marker/escalator.png` → `escalator`). **Named-store and building images (e.g. `marunouchi_bldg.png`) are NOT in the staged set** and are not currently available — those facilities fall back to a generic **pin** marker.

## Kiriko pipeline (how it all comes together)

**Boundary rule:** GDAL runs in TypeScript (gdal3.js, server-side, `server/src/gdb/`). **All interpretation of venue/network/facility data is Rust** (`kiriko-*` crates). The server extracts layers to WGS84 GeoJSON and moves bytes; it never parses geometry.

**Combined GDB import** (one publish → one bundle → one `source_kind='gdb'` version):
- `POST /api/gdb/inspect` — venue GDB → layer summary + suggested plan (`blobHash`).
- `POST /api/gdb/inspect-network` — network GDB → `{ networkBlobHash, nodeCount, edgeCount, floors }`.
- `POST /api/gdb/inspect-facilities` — point-facility GDB → `{ facilitiesBlobHash, facilityCount, floors }`.
- `POST /api/gdb/publish` — `{ venueId, blobHash, plan, networkBlobHash?, facilitiesBlobHash? }`. Server converts venue layers → synthesized IMDF, extracts `net_junction`/`net_path` and `point_facility_network` → GeoJSON, and threads all of it into `compileImdf` (napi). The Rust core builds the graph and facilities and embeds them in the bundle.

**KVB bundle sections** (`kiriko-bundle`, `core/crates/kiriko-bundle/src/format.rs`):
- `1 manifest`, `2 geometry`, `3 stores` — always (IMDF).
- `5 graph` — routing graph, present when a network GDB was imported.
- `7 facilities` — point facilities, present when a point-facility GDB was imported.
- `4 style`, `6 beacons` — reserved, not emitted.
- Sections 5 and 7 are **optional and backward compatible**: older decoders read 1–3 and ignore unknown ids. Directory rows are id-ascending.

**Routing (`kiriko-route`):**
- `build_route_graph(junctions_geojson, paths_geojson, level_ordinals)` → `RouteGraphBuild { graph, warnings, node_ids }`. Nodes carry `(lon, lat, ordinal)`; edges carry `(from, to, weight = net_path.cost)`. `node_ids[i]` is the source NODEID of `graph.nodes[i]`.
- Edges are traversed **bidirectionally** this phase (`direction`/one-way/barriers/time-windows deferred).
- `route(graph, origin, dest)` → A\*: snaps origin/dest to nearest node, heuristic = `k × haversine` (k = min cost-per-metre; keeps the heuristic admissible against abstract cost units).
- WASM: `routeBundle(bundle, oLon,oLat,oOrd, dLon,dLat,dOrd)` decodes §5 and runs A\*.

**Facilities (`kiriko-facilities`):**
- `build_facilities(geojson, graph, node_ids)` → `Facilities`. Each `Facility` has `(lon, lat, ordinal, name, icon, anchor?)`. `anchor` is resolved from `nodeid1` → the graph node's `(lon,lat,ordinal)`, enabling **route-to-facility** by reusing `route(origin, anchor)`.
- WASM: `facilities(bundle)` decodes §7; viewer renders a floor-filtered GL symbol layer (icon by `image` basename, pin fallback) and offers **Route here** on tap.

## Gotchas

- **Total route weight is in `cost` units, not metres**, though the viewer currently labels it `m` (known follow-up).
- **`cost` already models stairs/elevator penalty** — do not re-penalize passage types.
- Reproject EPSG:3857 → 4326 on every GDB read (`-t_srs EPSG:4326`).
- Network/facility floor labels must line up with the venue's converted levels; mismatches drop nodes/facilities with warnings surfaced in the review dialog.
- New Rust warning codes (e.g. `route_build`, `facility_build`) MUST be added to the TS bridge allowlist (`server/src/core/native.ts`) **and** the client type (`src/imdf/types.ts`) or publish fails with `bridge_error`.

## Known follow-ups

- **Floor merge (viewer):** GDB import synthesizes one IMDF level per `(building, ordinal)` (`resolveOrCreateLevel` in `server/src/gdb/mapping.ts`, keyed by `buildingUuid\0ordinal`). This is correct IMDF modeling (a level belongs to one building), but a multi-building venue like Tokyo Station (~15 buildings) yields ~15 separate `1F` entries. The **viewer floor selector should group levels by ordinal** and show one floor per ordinal, rendering every building's geometry at that ordinal together. Fix belongs in the viewer/level model, not the importer. (Next phase after point-facility POIs.)
- **Route total units:** viewer labels the A\* total `m` though it is `net_path.cost` units.
- Deferred routing semantics: `passage_type`, `direction`/one-way, `barrier`/`gate`, time windows, accessibility profiles.

## Specs & plans

- `docs/superpowers/specs/2026-07-17-kiriko-platform-architecture-design.md` — platform architecture, phasing, KVB format.
- `docs/superpowers/specs/2026-07-20-kiriko-route-slice-design.md` + `docs/superpowers/plans/2026-07-20-kiriko-route-slice.md` — routing.
- `docs/superpowers/specs/2026-07-20-point-facility-poi-design.md` + `docs/superpowers/plans/2026-07-20-point-facility-poi.md` — facilities.
- `docs/superpowers/specs/2026-07-20-gdb-*` — GDB import frontend, harden, version-on-existing-venue.
