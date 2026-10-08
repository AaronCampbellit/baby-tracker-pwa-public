CREATE TABLE IF NOT EXISTS password_resets(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL,used_at timestamptz);
