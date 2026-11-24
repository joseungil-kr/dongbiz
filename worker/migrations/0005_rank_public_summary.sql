-- Apply once before the new Worker. This one-time bootstrap scans history.
-- Subsequent refreshes use idx_rank_snapshots_keyword_place and one dirty key.
CREATE TABLE IF NOT EXISTS rank_public_summary (
  keyword TEXT PRIMARY KEY,
  obs INTEGER NOT NULL,
  last_at TEXT,
  places INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rank_public_summary_dirty (keyword TEXT PRIMARY KEY);
CREATE TRIGGER IF NOT EXISTS rank_public_summary_insert AFTER INSERT ON rank_snapshots
WHEN NEW.keyword != '__watch__' AND NEW.rank IS NOT NULL
  AND (NEW.source IS NULL OR NEW.source != 'analytics')
  AND (NEW.sort_mode = 'popular' OR NEW.sort_mode IS NULL)
  AND (NEW.is_ad = 0 OR NEW.is_ad IS NULL)
BEGIN
  INSERT OR IGNORE INTO rank_public_summary_dirty(keyword) VALUES (NEW.keyword);
END;
CREATE TRIGGER IF NOT EXISTS rank_public_summary_delete AFTER DELETE ON rank_snapshots
WHEN OLD.keyword != '__watch__' AND OLD.rank IS NOT NULL
  AND (OLD.source IS NULL OR OLD.source != 'analytics')
  AND (OLD.sort_mode = 'popular' OR OLD.sort_mode IS NULL)
  AND (OLD.is_ad = 0 OR OLD.is_ad IS NULL)
BEGIN
  INSERT OR IGNORE INTO rank_public_summary_dirty(keyword) VALUES (OLD.keyword);
END;
CREATE TRIGGER IF NOT EXISTS rank_public_summary_update
AFTER UPDATE OF keyword, rank, source, sort_mode, is_ad, collected_at, place_id ON rank_snapshots
BEGIN
  INSERT OR IGNORE INTO rank_public_summary_dirty(keyword)
    SELECT OLD.keyword WHERE OLD.keyword != '__watch__' AND OLD.rank IS NOT NULL
  AND (OLD.source IS NULL OR OLD.source != 'analytics')
  AND (OLD.sort_mode = 'popular' OR OLD.sort_mode IS NULL)
  AND (OLD.is_ad = 0 OR OLD.is_ad IS NULL);
  INSERT OR IGNORE INTO rank_public_summary_dirty(keyword)
    SELECT NEW.keyword WHERE NEW.keyword != '__watch__' AND NEW.rank IS NOT NULL
  AND (NEW.source IS NULL OR NEW.source != 'analytics')
  AND (NEW.sort_mode = 'popular' OR NEW.sort_mode IS NULL)
  AND (NEW.is_ad = 0 OR NEW.is_ad IS NULL);
END;
INSERT INTO rank_public_summary(keyword,obs,last_at,places)
SELECT keyword, COUNT(DISTINCT collected_at), MAX(collected_at), COUNT(DISTINCT place_id)
FROM rank_snapshots
WHERE keyword != '__watch__' AND rank IS NOT NULL
  AND (source IS NULL OR source != 'analytics')
  AND (sort_mode = 'popular' OR sort_mode IS NULL)
  AND (is_ad = 0 OR is_ad IS NULL)
GROUP BY keyword HAVING COUNT(DISTINCT collected_at) >= 2
ON CONFLICT(keyword) DO UPDATE SET obs=excluded.obs,last_at=excluded.last_at,places=excluded.places;
