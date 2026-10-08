BEGIN;
ALTER TABLE owlet_alert_settings ADD COLUMN IF NOT EXISTS repeat_until_accepted boolean NOT NULL DEFAULT false;
ALTER TABLE owlet_alert_events
  ADD COLUMN IF NOT EXISTS repeat_until_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS owlet_alert_events_unaccepted_kind
  ON owlet_alert_events(family_id,child_id,kind)
  WHERE repeat_until_accepted AND acknowledged_at IS NULL;
CREATE TABLE IF NOT EXISTS owlet_alert_deliveries (
  event_id bigint NOT NULL REFERENCES owlet_alert_events(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  finished_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  last_status integer,
  PRIMARY KEY(event_id,subscription_id)
);
CREATE INDEX IF NOT EXISTS owlet_alert_deliveries_due ON owlet_alert_deliveries(next_attempt_at)
  WHERE finished_at IS NULL;
CREATE INDEX IF NOT EXISTS owlet_alert_deliveries_subscription_due ON owlet_alert_deliveries(subscription_id,next_attempt_at,event_id)
  WHERE finished_at IS NULL;
CREATE TABLE IF NOT EXISTS owlet_push_backoff (
  subscription_id uuid PRIMARY KEY REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  retry_at timestamptz NOT NULL
);
COMMIT;
