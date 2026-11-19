/**
 * 캐시·요청 한도 저장소를 Workers KV에서 D1으로 옮긴다 (2026-11-19).
 *
 * 왜 옮겼나: Workers KV 무료 플랜은 "하루 쓰기 1,000건"이 한도다. 이 Worker는
 * /api/keyword-volume 처럼 요청 1건마다 KV write가 생기는 경로가 있어서, 사람이
 * 하루 수백 번만 써도 한도의 90% 경고가 났고, 한도를 넘으면 그날 KV 쓰기가 전부
 * 실패했다(캐시는 계속 미스 → 네이버 수집 부하 증가). D1 무료 한도는 하루
 * 100,000 rows write라 같은 사용량에서 여유가 100배다.
 *
 * 테이블 두 개만 쓴다 (스키마는 첫 사용 시 자동 생성 — 마이그레이션 미적용 상태에서도 동작):
 * - edge_cache    : key/value 캐시. value는 JSON 문자열, expires_at(유닉스 초)로 만료 판정.
 * - edge_counters : IP별 요청 한도 카운터. UPSERT 한 번으로 원자적으로 증가시킨다.
 *
 * D1 바인딩이 없거나 쿼리가 실패하면 "캐시 없음 / 한도 통과"로 조용히 물러난다.
 * 기존 CACHE(KV) 미바인딩 동작과 같은 원칙이다 — 기능은 항상 동작하고, 저장소만 손해를 본다.
 */

export type CacheEnv = { DB?: D1Database };

/** 만료 행 정리는 쓰기 요청 중 이 확률로만 돌린다(매번 돌리면 rows_written이 불필요하게 는다). */
const CLEANUP_CHANCE = 0.02;
/** 한 번에 지우는 만료 행 수 상한. 한도(rows_written)가 갑자기 튀지 않게 고정한다. */
const CLEANUP_BATCH = 50;

/** isolate당 한 번만 스키마를 확인한다. */
let schemaPromise: Promise<void> | null = null;

const nowSec = () => Math.floor(Date.now() / 1000);

async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const found = await db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master
                WHERE type = 'table' AND name IN ('edge_cache', 'edge_counters')`)
      .first<{ n: number }>();
    if (Number(found?.n || 0) >= 2) return;
    await db.prepare(`CREATE TABLE IF NOT EXISTS edge_cache (
      cache_key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_edge_cache_expires ON edge_cache (expires_at)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS edge_counters (
      counter_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_edge_counters_expires ON edge_counters (expires_at)`).run();
  })().catch((err) => {
    // 다음 요청에서 다시 시도한다(동시에 여러 isolate가 DDL을 걸면 한쪽이 잠금 오류를 볼 수 있다).
    schemaPromise = null;
    throw err;
  });
  return schemaPromise;
}

/** 만료된 캐시/카운터 행을 소량씩 지운다. 키가 시간 버킷을 포함하므로 만료돼도 다시 쓰이지 않는다. */
async function cleanupExpired(db: D1Database, now: number): Promise<void> {
  try {
    await db.batch([
      db.prepare(`DELETE FROM edge_cache WHERE cache_key IN (
        SELECT cache_key FROM edge_cache WHERE expires_at <= ? ORDER BY expires_at LIMIT ${CLEANUP_BATCH}
      )`).bind(now),
      db.prepare(`DELETE FROM edge_counters WHERE counter_key IN (
        SELECT counter_key FROM edge_counters WHERE expires_at <= ? ORDER BY expires_at LIMIT ${CLEANUP_BATCH}
      )`).bind(now),
    ]);
  } catch (err) {
    console.error('D1 캐시 정리 실패:', err);
  }
}

/** 캐시 조회. 없거나 만료면 null. */
export async function cacheGet<T>(env: CacheEnv, key: string): Promise<T | null> {
  const db = env.DB;
  if (!db) return null;
  try {
    await ensureSchema(db);
    const row = await db
      .prepare(`SELECT value FROM edge_cache WHERE cache_key = ? AND expires_at > ?`)
      .bind(key, nowSec())
      .first<{ value: string }>();
    if (!row) return null;
    return JSON.parse(row.value) as T;
  } catch (err) {
    console.error('D1 캐시 읽기 실패:', err);
    return null;
  }
}

/** 캐시 저장(같은 키면 덮어쓰기). ttlSeconds 뒤 만료. */
export async function cachePut(env: CacheEnv, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const db = env.DB;
  if (!db) return;
  try {
    await ensureSchema(db);
    const now = nowSec();
    await db
      .prepare(`INSERT INTO edge_cache (cache_key, value, expires_at) VALUES (?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`)
      .bind(key, JSON.stringify(value), now + ttlSeconds)
      .run();
    if (Math.random() < CLEANUP_CHANCE) await cleanupExpired(db, now);
  } catch (err) {
    console.error('D1 캐시 쓰기 실패:', err);
  }
}

/**
 * 한도 확인만 한다(카운트 증가 없음). 남은 횟수가 있으면 true.
 * /api/gap 처럼 "성공한 분석만 차감"하는 경로의 사전 확인용.
 */
export async function peekCounter(env: CacheEnv, key: string, limit: number): Promise<boolean> {
  const db = env.DB;
  if (!db) return true;
  try {
    await ensureSchema(db);
    const row = await db
      .prepare(`SELECT count FROM edge_counters WHERE counter_key = ? AND expires_at > ?`)
      .bind(key, nowSec())
      .first<{ count: number }>();
    return Number(row?.count || 0) < limit;
  } catch (err) {
    console.error('D1 한도 조회 실패:', err);
    return true;
  }
}

/**
 * 카운터를 1 증가시키고 한도 안이면 true를 돌려준다. UPSERT + RETURNING 한 번이라
 * 동시 요청에도 count가 한도를 넘지 않는다. 한도를 넘은 요청은 WHERE로 UPDATE가
 * 건너뛰어져 행을 쓰지 않는다(rows_written 절약).
 */
export async function consumeCounter(
  env: CacheEnv,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const db = env.DB;
  if (!db) return true;
  try {
    await ensureSchema(db);
    const now = nowSec();
    // CASE 두 개: 창이 지난 행은 1로 리셋하고, 살아 있는 행은 한도 미만일 때만 +1.
    const row = await db
      .prepare(`INSERT INTO edge_counters (counter_key, count, expires_at) VALUES (?, 1, ?)
                ON CONFLICT(counter_key) DO UPDATE SET
                  count = CASE WHEN edge_counters.expires_at <= ? THEN 1 ELSE edge_counters.count + 1 END,
                  expires_at = CASE WHEN edge_counters.expires_at <= ? THEN ? ELSE edge_counters.expires_at END
                WHERE edge_counters.expires_at <= ? OR edge_counters.count < ?
                RETURNING count`)
      .bind(key, now + windowSeconds, now, now, now + windowSeconds, now, limit)
      .first<{ count: number }>();
    return !!row;
  } catch (err) {
    console.error('D1 한도 증가 실패:', err);
    return true;
  }
}
