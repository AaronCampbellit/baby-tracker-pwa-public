ALTER TABLE owlet_readings ADD COLUMN IF NOT EXISTS provider_data jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS owlet_alert_settings (
  family_id uuid NOT NULL,
  child_id uuid NOT NULL,
  oxygen_below integer CHECK (oxygen_below BETWEEN 1 AND 100),
  heart_below integer CHECK (heart_below BETWEEN 1 AND 300),
  heart_above integer CHECK (heart_above BETWEEN 1 AND 300),
  battery_below integer CHECK (battery_below BETWEEN 1 AND 100),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (family_id, child_id),
  FOREIGN KEY (child_id, family_id) REFERENCES children(id, family_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS owlet_alert_events (
  id bigserial PRIMARY KEY,
  family_id uuid NOT NULL,
  child_id uuid NOT NULL,
  reading_id bigint NOT NULL REFERENCES owlet_readings(id),
  kind text NOT NULL CHECK (kind IN ('oxygen_below','heart_below','heart_above','battery_below')),
  measured_value numeric(6,1) NOT NULL,
  threshold_value integer NOT NULL,
  measured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  push_attempted_at timestamptz,
  UNIQUE (reading_id, kind),
  FOREIGN KEY (child_id, family_id) REFERENCES children(id, family_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS owlet_alert_events_recent ON owlet_alert_events(family_id, child_id, created_at DESC);
CREATE INDEX IF NOT EXISTS owlet_alert_events_pending ON owlet_alert_events(created_at) WHERE push_attempted_at IS NULL;
