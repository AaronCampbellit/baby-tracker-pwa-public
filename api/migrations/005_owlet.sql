CREATE TABLE IF NOT EXISTS owlet_connections (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  child_id uuid NOT NULL,
  connected_by uuid NOT NULL REFERENCES users(id),
  account_email text NOT NULL,
  device_serial text NOT NULL,
  device_name text NOT NULL,
  encrypted_tokens text NOT NULL,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  last_polled_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(family_id, child_id),
  UNIQUE(family_id, account_email),
  FOREIGN KEY(child_id, family_id) REFERENCES children(id, family_id)
);
CREATE TABLE IF NOT EXISTS owlet_readings (
  id bigserial PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  child_id uuid NOT NULL,
  device_serial text NOT NULL,
  measured_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  heart_rate integer,
  oxygen_percent numeric(5,1),
  battery_percent numeric(5,1),
  movement integer,
  sleep_state integer,
  sock_connection integer,
  charging boolean,
  alerts jsonb NOT NULL DEFAULT '{}',
  UNIQUE(family_id, child_id, device_serial, measured_at),
  FOREIGN KEY(child_id, family_id) REFERENCES children(id, family_id)
);
CREATE INDEX IF NOT EXISTS owlet_readings_recent ON owlet_readings(family_id, child_id, measured_at DESC);
