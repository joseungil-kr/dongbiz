-- Public rank observations only. User-requested store diagnostics are not enrolled here.
CREATE TABLE IF NOT EXISTS periodic_keywords (
  keyword TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('restaurant', 'hairshop')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  interval_hours INTEGER NOT NULL DEFAULT 72 CHECK (interval_hours >= 24),
  last_attempt_at DATETIME,
  last_success_at DATETIME,
  last_error_code TEXT,
  next_run_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO periodic_keywords (keyword, category, interval_hours)
VALUES
  ('안산 닭한마리 맛집', 'restaurant', 72),
  ('강남 미용실', 'hairshop', 72);
