BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Caregiver';
ALTER TABLE families ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
ALTER TABLE families ADD COLUMN IF NOT EXISTS snapshot jsonb NOT NULL DEFAULT '{"children":[],"activities":[]}';
CREATE TABLE IF NOT EXISTS sync_operations(family_id uuid NOT NULL REFERENCES families(id),operation_id uuid NOT NULL,revision integer NOT NULL,PRIMARY KEY(family_id,operation_id));
CREATE TABLE IF NOT EXISTS login_attempts(key text PRIMARY KEY,attempts integer NOT NULL DEFAULT 0,window_start timestamptz NOT NULL DEFAULT now());
COMMIT;
