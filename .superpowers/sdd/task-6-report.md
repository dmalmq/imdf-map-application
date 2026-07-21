# Task 6 Report: Server — point-facility extract + section 7

## Status
Complete.

## TDD evidence

### RED
`pnpm --dir server exec vitest run gdbFacilities`

- `server/test/gdbFacilities.test.ts` failed to load because `server/src/gdb/facilities.ts` did not exist.
- Vitest reported 1 failed suite, 0 tests collected.

### GREEN
`pnpm --dir server exec vitest run gdbFacilities`

- 1 test file passed.
- 9/9 tests passed.

Required verification:

`pnpm --dir server exec vitest run gdb && pnpm --dir server exec tsc --noEmit`

- GDB suites: 6 passed, 1 skipped.
- GDB tests: 44 passed, 1 skipped.
- Server TypeScript check completed cleanly.

Additional mirror verification:

`pnpm exec tsc --noEmit`

- Frontend TypeScript check completed cleanly.

## Changes

- Added `server/src/gdb/facilities.ts` to extract `point_facility_network` through serialized GDAL access as WGS84 RFC7946 GeoJSON, enforce the generated-output cap, count facilities, collect sorted distinct `FLOOR` values, and raise `missing_facility_layer` when absent.
- Added `POST /api/gdb/inspect-facilities`, returning `facilitiesBlobHash`, `facilityCount`, and `floors`, with staged-file cleanup in `finally`.
- Extended GDB publish validation and payloads with optional `facilitiesBlobHash`, including 404 handling for a missing blob and 400 handling for a missing facility layer.
- Publish now extracts facilities before conversion side effects, stores the generated GeoJSON as a content-addressed blob, and threads `facilitiesGeoJsonHash` through the `publish_imdf` job.
- `makePublishRunner` reopens the facilities GeoJSON blob and sets `CompileVenueMetadata.facilitiesGeoJson`.
- The native compile bridge forwards facilities GeoJSON as the sixth optional `compileImdf` argument.
- Added server `FacilitiesExtraction` / `FacilitiesInspectResponse` contracts and the client `FacilitiesInspectResponse` mirror.
- Exported the existing network module's generic layer-extraction and summary helpers so facilities extraction reuses the exact GDAL arguments and summary behavior.
- Added `server/test/gdbFacilities.test.ts` covering extraction summary, missing-layer errors, inspect summary, invalid archives, combined network+facilities publish, facilities-less publish, missing blob, and publish-time missing-layer handling.

## Commit

`9f31a80 feat(server): combined import — point-facility extract + section 7`

## Concerns

None. Plain and network-only publish requests omit the new facilities hash and compile metadata, preserving their existing behavior.
