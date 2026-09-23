-- Expand only: existing public-rank keywords remain `rank` collectors.
ALTER TABLE periodic_keywords
  ADD COLUMN collection_mode TEXT NOT NULL DEFAULT 'rank'
  CHECK (collection_mode IN ('rank', 'analytics'));
