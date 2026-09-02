-- Readings, one row per (user, reading id). Idempotent so it can be applied
-- with `wrangler d1 migrations apply` or pasted into the dashboard console.
--
-- updated_at : client clock (ms). Last-writer-wins between devices.
-- synced_at  : D1 clock (ms) at the last write. Cursor for incremental pulls.
-- deleted_at : tombstone (ms). Deleted rows are kept so other devices learn
--              about the deletion and cannot resurrect the reading.
CREATE TABLE IF NOT EXISTS readings (
  user_id    TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  ts         TEXT    NOT NULL,
  sys        INTEGER,
  dia        INTEGER,
  pul        INTEGER,
  arm        TEXT,
  note       TEXT,
  source     TEXT,
  irregular  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  synced_at  INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (user_id, id),
  CHECK (deleted_at IS NOT NULL OR (sys IS NOT NULL AND dia IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS readings_user_synced ON readings (user_id, synced_at);
