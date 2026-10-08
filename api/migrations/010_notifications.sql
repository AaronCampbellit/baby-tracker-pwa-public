BEGIN;
-- Keep the most recent duplicate enrollment, then make registration idempotent.
DELETE FROM push_subscriptions older USING push_subscriptions newer
WHERE older.user_id=newer.user_id
  AND older.subscription->>'endpoint'=newer.subscription->>'endpoint'
  AND (older.created_at,older.id)<(newer.created_at,newer.id);
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_device
  ON push_subscriptions(user_id,(subscription->>'endpoint'));
CREATE TABLE IF NOT EXISTS push_expired_endpoints (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint_hash text NOT NULL,
  expired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,endpoint_hash)
);
CREATE TABLE IF NOT EXISTS notification_history (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  family_id uuid REFERENCES families(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('timer','test')),
  title text NOT NULL,
  body text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,event_key)
);
CREATE INDEX IF NOT EXISTS notification_history_recent ON notification_history(user_id,created_at DESC);
-- New settings default on; retain already-saved choices and thresholds.
ALTER TABLE owlet_alert_settings ALTER COLUMN repeat_until_accepted SET DEFAULT true;
COMMIT;
