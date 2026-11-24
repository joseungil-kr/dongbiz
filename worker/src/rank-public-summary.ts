type RankSummary = {keyword: string; obs: number; last_at: string; places: number};

const latest = new WeakMap<D1Database, RankSummary[]>();

// Keep the same raw-key order as SQLite's old GROUP BY on timestamp ties.
export async function readRankPublicSummary(db: D1Database): Promise<RankSummary[]> {
  try {
    const {results} = await db.prepare(`
      SELECT keyword,obs,last_at,places FROM rank_public_summary
      ORDER BY last_at DESC, keyword COLLATE BINARY ASC
    `).all<RankSummary>();
    latest.set(db, results);
    return results;
  } catch (error) {
    const stale = latest.get(db);
    if (stale) {
      console.warn('Rank summary unavailable; serving last successful read:', error);
      return stale;
    }
    // Don't invent an empty inventory or fall back to scanning history.
    throw error;
  }
}

// Check dirty membership inside the atomic batch; concurrent refreshes cannot
// erase a newer committed dirty marker or replace the last good row on error.
export async function refreshRankPublicSummary(db: D1Database, keyword: string): Promise<void> {
  try {
    await db.batch([
      db.prepare(`DELETE FROM rank_public_summary WHERE keyword = ?
        AND EXISTS (SELECT 1 FROM rank_public_summary_dirty WHERE keyword = ?)`).bind(keyword, keyword),
      db.prepare(`
        INSERT INTO rank_public_summary(keyword,obs,last_at,places)
        SELECT keyword, COUNT(DISTINCT collected_at), MAX(collected_at), COUNT(DISTINCT place_id)
        FROM rank_snapshots WHERE keyword = ?
          AND EXISTS (SELECT 1 FROM rank_public_summary_dirty WHERE keyword = ?)
          AND keyword != '__watch__' AND rank IS NOT NULL
          AND (source IS NULL OR source != 'analytics')
          AND (sort_mode = 'popular' OR sort_mode IS NULL)
          AND (is_ad = 0 OR is_ad IS NULL)
        GROUP BY keyword HAVING COUNT(DISTINCT collected_at) >= 2
      `).bind(keyword, keyword),
      db.prepare('DELETE FROM rank_public_summary_dirty WHERE keyword = ?').bind(keyword),
    ]);
  } catch (error) {
    console.warn('Rank public summary refresh failed; retaining dirty key and last good row:', error);
  }
}

export async function retryRankPublicSummary(db: D1Database | undefined): Promise<void> {
  if (!db) return;
  try {
    const {results} = await db.prepare(`
      SELECT keyword FROM rank_public_summary_dirty ORDER BY keyword LIMIT 10
    `).all<{keyword: string}>();
    for (const {keyword} of results) await refreshRankPublicSummary(db, keyword);
  } catch (error) {
    console.warn('Rank public summary dirty queue unavailable:', error);
  }
}
