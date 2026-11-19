-- 캐시·요청 한도를 Workers KV에서 D1으로 이전 (2026-11-19)
-- KV 무료 한도(하루 쓰기 1,000건) 소진 경고를 없애기 위한 변경.
-- Worker는 첫 요청 때 같은 스키마를 자동 생성하므로(worker/src/cache.ts) 이 파일은
-- `wrangler d1 execute dongbiz-db --remote --file=./migrations/0003_edge_cache.sql`로
-- 미리 적용할 때만 쓰면 된다. 여러 번 실행해도 안전하다.

-- key/value 캐시. value는 JSON 문자열, expires_at은 유닉스 초.
CREATE TABLE IF NOT EXISTS edge_cache (
  cache_key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edge_cache_expires ON edge_cache (expires_at);

-- IP별 요청 한도 카운터(UPSERT로 원자적 증가).
CREATE TABLE IF NOT EXISTS edge_counters (
  counter_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edge_counters_expires ON edge_counters (expires_at);
