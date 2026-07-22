-- Make GDB versions self-describing for reprocessing (add routing/facilities;
-- re-open & edit layer mapping). All nullable; older/IMDF versions leave them NULL.
ALTER TABLE versions ADD COLUMN gdb_source_blob_hash TEXT;
ALTER TABLE versions ADD COLUMN gdb_plan_json TEXT;
ALTER TABLE versions ADD COLUMN net_junctions_blob_hash TEXT;
ALTER TABLE versions ADD COLUMN net_paths_blob_hash TEXT;
ALTER TABLE versions ADD COLUMN facilities_blob_hash TEXT;
