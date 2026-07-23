-- Mark versions whose routing graph was synthesized from the venue's own
-- geometry (no source net_junction/net_path GDB). Lets the UI offer network
-- export / floor-by-floor review on generated datasets that carry no
-- real-network blob hashes. Older/real-network/IMDF rows keep the default 0.
ALTER TABLE versions ADD COLUMN synthesized INTEGER NOT NULL DEFAULT 0;
