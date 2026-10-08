-- NULL means unknown. Do not backfill historical readings into current state.
ALTER TABLE owlet_polls ADD COLUMN IF NOT EXISTS charging boolean;
