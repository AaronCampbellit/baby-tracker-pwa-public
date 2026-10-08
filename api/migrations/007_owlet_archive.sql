ALTER TABLE owlet_connections ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;
ALTER TABLE owlet_connections ADD COLUMN IF NOT EXISTS last_duration_ms integer;
CREATE TABLE IF NOT EXISTS owlet_polls (
  id bigserial PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  child_id uuid NOT NULL,
  device_serial text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  measured_at timestamptz,
  duration_ms integer NOT NULL,
  status text NOT NULL CHECK (status IN ('success','error')),
  http_status integer,
  error text,
  raw_properties jsonb,
  FOREIGN KEY(child_id,family_id) REFERENCES children(id,family_id)
);
CREATE INDEX IF NOT EXISTS owlet_polls_history ON owlet_polls(family_id,child_id,fetched_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS owlet_log_files (
  id bigserial PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  child_id uuid NOT NULL,
  device_serial text NOT NULL,
  property_name text NOT NULL,
  source_url text NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  downloaded_at timestamptz,
  content_type text,
  sha256 text,
  content bytea,
  metadata jsonb,
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(family_id,child_id,source_url),
  FOREIGN KEY(child_id,family_id) REFERENCES children(id,family_id)
);
CREATE INDEX IF NOT EXISTS owlet_files_history ON owlet_log_files(family_id,child_id,discovered_at DESC);
