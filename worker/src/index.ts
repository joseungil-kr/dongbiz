import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { cachedPlace } from './place-cache';
import { CollectionError } from './collection';
import { isStoreName, searchPlaceCandidates, collectSearchListing, SearchListing } from './place-search';
import { basicAuth } from 'hono/basic-auth';
import { scrapeFullPlaceMetrics, getOrganicRanking, getPlaceList, SortMode, PlaceListItem } from './scraper';
import { notify, logDiagnosisToSheet, sendCustomerEmail, NotifyEnv } from './notify';
import { GUIDES, GUIDE_BY_SLUG } from './guides';
import { renderAdsPage, renderBlogPage, siteNav, SITE_NAV_CSS } from './pages';
import { pickTopics, renderMiniHome, renderMiniTopic } from './minisite';
import { getKeywordVolumes, describeVolume, autocomplete, brandVariants, brandCore, normalizeKeyword, SearchAdEnv } from './searchad';

export interface Env extends NotifyEnv, SearchAdEnv {
  DB: D1Database;
  CACHE?: KVNamespace; // 미바인딩 시 캐시 없이 동작 (§6 Phase A)
  ADMIN_USER?: string;
  ADMIN_PASS?: string;
  RATE_LIMIT_BYPASS_TOKEN?: string; // 운영자 본인 테스트용 — 공개 UI엔 절대 안 넣고 URL에 수동으로만 붙인다
  ASSETS: Fetcher; // 정적 index.html을 Worker 코드 내에서 재사용(맞춤개선 리포트)하기 위한 바인딩
}

// 매일 헬스체크에 쓰는 고정 매장 (§6 Phase B). 백세보리밥 닭한마리 - 사용자 지정 테스트 매장.
const HEALTHCHECK_PLACE_ID = '2058645213';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());
// Debug probes must never provide a public, uncached Naver fetch path.
app.use('/api/test-*', async (c) => c.json({ error: 'Not found' }, 404));

// 관리자 화면 인증. ADMIN_USER/ADMIN_PASS 시크릿 미설정이면 아예 막는다(구멍 방지).
app.use('/admin/*', async (c, next) => {
  if (!c.env.ADMIN_USER || !c.env.ADMIN_PASS) {
    return c.text('관리자 계정이 설정되지 않았습니다. wrangler secret put ADMIN_USER / ADMIN_PASS', 503);
  }
  return basicAuth({ username: c.env.ADMIN_USER, password: c.env.ADMIN_PASS })(c, next);
});

function generateShareId() {
  return Math.random().toString(36).substring(2, 10);
}

// 캐시 키 버전. scraper.ts의 추출 로직을 바꿀 때마다 반드시 올릴 것.
// 실제로 두 번 겪은 문제: 코드는 배포됐는데 KV에 남은 예전(버그) 값이 TTL(최대 24h) 동안 계속
// 서빙되어 "고쳤다는데 왜 아직도 이래?"가 재발했다. 버전을 올리면 이전 키가 자동으로 무효화되어
// 수동으로 wrangler kv key delete 할 필요가 없다.
const CACHE_VERSION = 'v9'; // v9: 비교 기준을 상위 10개→6개로 변경 (네이버 지도 1페이지 실노출 개수 기준, §4.2 B15)

// 네이버 지도 "1페이지" 진입선 = 실제로 더보기 누르기 전 노출되는 6곳 (10 아님, 2026-09-08 사용자 확인).
const TOP_N = 6;

// KV 캐시 래퍼. CACHE 바인딩이 없으면 매번 새로 조회한다 (기능은 동작, 속도/원가만 손해).
async function cached<T>(env: Env, key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
  if (!env.CACHE) return fetcher();
  const versionedKey = `${CACHE_VERSION}:${key}`;
  const hit = await env.CACHE.get(versionedKey, 'json');
  if (hit !== null && !(Array.isArray(hit) && hit.length === 0)) return hit as T;
  const fresh = await fetcher();
  if (!(Array.isArray(fresh) && fresh.length === 0)) {
    await env.CACHE.put(versionedKey, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
  }
  return fresh;
}

// 1인당 1일 Gap 분석 제한. 매장 조회(/api/place)는 1회면 끝나지만 그 다음 키워드
// 입력창은 같은 매장으로 몇 번이든 다시 돌릴 수 있어서, 경쟁사 스크랩 비용이 큰
// /api/gap만 제한한다. 계정/로그인이 없어 CF-Connecting-IP로 사람을 구분한다
// (Cloudflare 엣지가 붙이는 값이라 클라이언트가 위조 불가).
// D1 CURRENT_TIMESTAMP·new Date() 등 이 파일 전반은 UTC로 다룬다 — 표시·날짜경계 판단이
// 필요한 곳에서만 이 함수로 KST(UTC+9)로 변환한다. KST 자정(=UTC 15:00)에 날짜가 넘어간다.
function toKST(d: Date = new Date()): Date {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000);
}

// UTC 문자열('YYYY-MM-DD HH:MM:SS', D1 CURRENT_TIMESTAMP 형식)을 KST 표시용으로 변환.
function fmtKST(utcStr: string | null | undefined): string {
  if (!utcStr) return '';
  const d = new Date(utcStr.replace(' ', 'T') + (utcStr.endsWith('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return utcStr;
  return toKST(d).toISOString().slice(0, 19).replace('T', ' ') + ' KST';
}

const DAILY_GAP_LIMIT = 3;
async function checkDailyGapLimit(env: Env, ip: string, consume = false): Promise<boolean> {
  if (!env.CACHE) return true; // 캐시 미바인딩 시 제한 없이 통과(§6 패턴과 일관: 기능은 항상 동작)
  const today = toKST().toISOString().slice(0, 10); // KST 자정(24:00) 기준 날짜 경계
  const key = `gaplimit:${today}:${ip}`;
  const count = Number(await env.CACHE.get(key)) || 0;
  if (count >= DAILY_GAP_LIMIT) return false;
  if (consume) await env.CACHE.put(key, String(count + 1), { expirationTtl: 60 * 60 * 25 });
  return true;
}

const PLACE_TTL = 60 * 60 * 24; // 24h
const KEYWORD_TTL = 60 * 60 * 6; // 6h

// places 테이블 upsert. search_histories.place_id가 FK로 이 테이블을 참조하므로,
// 매장이 관련된 모든 진입점(place/gap)에서 먼저 이 테이블에 존재를 보장해야 한다.
async function upsertPlace(db: D1Database | undefined, store: any) {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT OR IGNORE INTO places (id, name, category, road_address, talktalk_active)
      VALUES (?, ?, ?, ?, ?)
    `).bind(store.placeId, store.name, store.category, store.roadAddress, store.seoMetrics.hasTalktalk ? 1 : 0).run();
  } catch (dbErr) {
    console.error('DB Insert Error (places):', dbErr);
  }
}

type SnapshotEntry = {
  id: string; name: string | null; rank: number | null; s: any;
  nameVolume?: number | null; nameVolumeUnderTen?: boolean;
};

// 순위 스냅샷 배치 기록. /api/gap(source='user')과 cron 자동수집(source='cron') 둘 다 이걸 쓴다.
async function insertRankSnapshotRows(
  db: D1Database | undefined,
  keyword: string,
  entries: SnapshotEntry[],
  source: 'user' | 'cron'
) {
  if (!db || entries.length === 0) return;
  try {
    const stmts = entries.map(({ id, name, rank, s, nameVolume, nameVolumeUnderTen }) => db.prepare(`
      INSERT INTO rank_snapshots (
        id, keyword, place_id, place_name, rank,
        visitor_reviews, blog_reviews, vote_count, photo_count, review_score,
        review_medias_total, coupon_count, has_booking, has_smart_order, has_review_penalty,
        is_new_opening, is_good_store, is_open_now, is_biz_hour_missing, description_length,
        name_contains_keyword, category_matches_keyword, distance_from_me_km,
        name_search_volume, name_volume_under_ten, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), keyword, id, name, rank,
      s.seoMetrics.visitorReviewsTotal ?? null, s.seoMetrics.cafeBlogReviewsTotal ?? null,
      s.seoMetrics.totalVoteCount ?? null, s.seoMetrics.photoCount ?? null, s.seoMetrics.visitorReviewsScore ?? null,
      s.seoMetrics.reviewMediasTotal ?? null, s.seoMetrics.couponCount ?? null,
      s.seoMetrics.hasNaverBooking ? 1 : 0, s.seoMetrics.hasSmartOrder ? 1 : 0, s.seoMetrics.hasReviewPenalty ? 1 : 0,
      s.seoMetrics.isNewOpening ? 1 : 0, s.seoMetrics.isGoodStore ? 1 : 0, s.seoMetrics.isOpenNow ? 1 : 0,
      s.seoMetrics.isBizHourMissing ? 1 : 0, s.seoMetrics.descriptionLength ?? null,
      s.rankFactors?.nameContainsKeyword ? 1 : 0, s.rankFactors?.categoryMatchesKeyword ? 1 : 0,
      s.rankFactors?.distanceFromMeKm ?? null,
      nameVolume ?? null, nameVolumeUnderTen == null ? null : (nameVolumeUnderTen ? 1 : 0), source
    ));
    await db.batch(stmts);
  } catch (err) {
    console.error('rank_snapshots 기록 실패:', err);
  }
}

// /api/gap 전용: myStore + 경쟁사를 SnapshotEntry로 변환해서 기록.
async function logRankSnapshots(
  db: D1Database | undefined,
  keyword: string,
  ranking: string[],
  myStore: any,
  myRank: number | null,
  competitors: any[],
  source: 'user' | 'cron' = 'user',
  nameVolumes: Record<string, { total: number; isUnderTen: boolean } | null> = {}
) {
  // "< 10"은 상한 10을 더한 근사치라 실측과 섞이면 안 된다 — 플래그를 같이 남긴다(§6.5.10).
  const volumeOf = (name: string | null) => {
    const v = name ? nameVolumes[name] : null;
    return { nameVolume: v?.total ?? null, nameVolumeUnderTen: v ? v.isUnderTen : undefined };
  };
  const entries: SnapshotEntry[] = [
    { id: myStore.placeId, name: myStore.name, rank: myRank, s: myStore, ...volumeOf(myStore.name) },
    ...competitors.map((c: any) => {
      const idx = ranking.indexOf(c.placeId);
      return { id: c.placeId, name: c.name, rank: idx >= 0 ? idx + 1 : null, s: c, ...volumeOf(c.name) };
    }),
  ];
  await insertRankSnapshotRows(db, keyword, entries, source);
}

// ─────────────────────────────────────────────────────────────────────────────
// 업체 텍스트 저장/매칭 (§9.13)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 개별 스크랩으로 이미 손에 들어온 텍스트 4종을 place_texts에 남긴다.
 * scrapeFullPlaceMetrics를 부르는 곳이면 어디서든 **추가 요청 없이** 부를 수 있다 —
 * 지금까지는 이 텍스트를 descriptionLength 같은 숫자로만 접고 버려왔다.
 */
async function savePlaceTexts(db: D1Database | undefined, s: any) {
  if (!db || !s?.placeId) return;
  try {
    await db.prepare(`
      INSERT INTO place_texts (place_id, place_name, category, keyword_list, description, menu_names, rep_keywords, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(place_id) DO UPDATE SET
        place_name=excluded.place_name, category=excluded.category,
        keyword_list=excluded.keyword_list, description=excluded.description,
        menu_names=excluded.menu_names, rep_keywords=excluded.rep_keywords,
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      s.placeId, s.name || null, s.category || null,
      JSON.stringify(s.keywordList || []),
      s.description || '',
      JSON.stringify((s.menus || []).map((m: any) => m.name).filter(Boolean)),
      JSON.stringify(s.topRepKeywords || []),
    ).run();
  } catch (err) {
    console.error(`place_texts 저장 실패(${s.placeId}):`, err);
  }
}

/** 공백·대소문자 제거. "강남 맛집"과 "강남맛집"을 같게 보기 위한 것 — 이게 매칭의 절반이다. */
const normText = (s: string | null | undefined) => (s || '').replace(/\s+/g, '').toLowerCase();

/**
 * 검색 키워드를 [지역, 업종] 조각으로 쪼갠다. '강남맛집'은 공백이 없어 split(/\s+/)으로는
 * 토큰 1개다 — 그래서 "강남 최고의 밥집"을 부분일치로도 못 잡았다(기존 keywordMatch의 한계).
 *
 * ponytail: 형태소 분석기 대신 업종어 접미사 목록으로 자른다. listTargetFor와 같은 어휘를
 * 쓰므로 우리가 수집하는 키워드는 전부 커버된다. 새 업종을 수집하면 여기도 같이 늘릴 것.
 */
const BIZ_SUFFIX = /(맛집|밥집|식당|고기집|횟집|카페|미용실|헤어샵|헤어|살롱|성형외과|치과|피부과|한의원|학원|펜션)$/;
function keywordParts(keyword: string): string[] {
  const parts: string[] = [];
  for (const tok of keyword.split(/\s+/).filter(Boolean)) {
    const m = tok.match(BIZ_SUFFIX);
    if (m && tok.length > m[1].length) parts.push(tok.slice(0, tok.length - m[1].length), m[1]);
    else parts.push(tok);
  }
  return parts.filter(p => p.length >= 2);
}

type MatchLevel = 0 | 1 | 2; // 0 없음 · 1 부분(조각만) · 2 정확일치
function matchLevel(keyword: string, text: string | null | undefined): MatchLevel {
  const t = normText(text);
  if (!t) return 0;
  if (t.includes(normText(keyword))) return 2;
  return keywordParts(keyword).some(p => t.includes(normText(p))) ? 1 : 0;
}

/**
 * 대표키워드는 **순서가 있다**. 업체가 입력한 순서 그대로 keywordList에 담기므로,
 * "포함했나"(불린)보다 "몇 번째에 뒀나"가 신호가 클 수 있다. 그래서 3단계로 나눈다.
 *   3 = 정확일치가 1~2번째 · 2 = 정확일치가 3번째 이후 · 1 = 조각만 일치 · 0 = 없음
 */
function repKeywordLevel(keyword: string, list: string[]): { level: 0 | 1 | 2 | 3; at: number | null } {
  const nk = normText(keyword);
  const exactAt = list.findIndex(k => normText(k).includes(nk));
  if (exactAt >= 0) return { level: exactAt < 2 ? 3 : 2, at: exactAt + 1 };
  const parts = keywordParts(keyword).map(normText);
  const partAt = list.findIndex(k => parts.some(p => normText(k).includes(p)));
  return partAt >= 0 ? { level: 1, at: partAt + 1 } : { level: 0, at: null };
}

// 두 좌표 간 거리(km). 상위노출 영향 지표 중 하나로 알려진 "거리" — 별도 수집 없이 이미
// 갖고 있는 좌표만으로 파생 계산 가능 (질문4 B그룹).
function haversineKm(x1: any, y1: any, x2: any, y2: any): number | null {
  const lon1 = Number(x1), lat1 = Number(y1), lon2 = Number(x2), lat2 = Number(y2);
  if ([lon1, lat1, lon2, lat2].some(v => isNaN(v))) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

// 키워드 토큰이 상호명/카테고리에 포함되는지 (질문4 B그룹 — 상호명 키워드 포함 여부는
// 상위노출에 유리하다는 게 정설. 이미 수집 중인 name/category만으로 파생 계산).
function keywordMatch(keyword: string, name: string | null, category: string | null) {
  const tokens = keyword.split(/\s+/).filter(t => t.length >= 2);
  const nameHit = tokens.some(t => (name || '').includes(t));
  const categoryHit = tokens.some(t => (category || '').includes(t));
  return { nameContainsKeyword: nameHit, categoryMatchesKeyword: categoryHit };
}

// 지표별 평균/중앙값 계산 (§7.6 평균 왜곡 방어)
function calcStats(competitors: any[], key: string, isScoreField = false) {
  const raw = competitors.map(s => s.seoMetrics[key]);
  const filtered = isScoreField ? raw.filter((v: any) => v !== null && v !== undefined) : raw;
  const values = filtered.map((v: any) => Number(v) || 0).sort((a: number, b: number) => a - b);
  if (values.length === 0) return { avg: 0, median: 0 };
  const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  return { avg: Math.round(avg * 100) / 100, median: Math.round(median * 100) / 100 };
}

// [1단계] 내 매장 진단
app.get('/api/place', async (c) => {
  const query = c.req.query('query')?.trim();
  if (!query) {
    return c.json({ error: '전화번호나 상호를 입력해주세요.' }, 400);
  }

  try {
    if (isStoreName(query)) {
      const candidates = await cached(c.env, `candidates:v1:${query}`, KEYWORD_TTL, () => searchPlaceCandidates(query));
      return c.json({ success: true, requiresSelection: true, candidates });
    }
    const myStore = await cachedPlace(c.env, query, true);
    await upsertPlace(c.env.DB, myStore);

    return c.json({ success: true, myStore });
  } catch (err: any) {
    console.error('진단 처리 중 오류:', err);
    c.executionCtx.waitUntil(notify(c.env, `⚠️ [진단 실패] query="${query}"\n${err.message || err}`));
    if (err instanceof CollectionError) return c.json({ error: err.message, code: err.code, stage: err.stage }, 503);
    return c.json({ error: err.message || '매장 정보를 찾을 수 없습니다.' }, 500);
  }
});

// [2·3단계] 키워드 기반 Gap 분석 — 지도 목록 최대 350곳에서 위치 확인, 상위 경쟁사 지표 비교.
// competitorId가 있으면(키워드 대신/추가로) 순위 자동수집을 건너뛰고 그 업체 1곳과 바로 비교한다
// (경쟁사 직접 지목, §2 3단계 확정). 만능 리졸버(scrapeFullPlaceMetrics)를 그대로 재사용하므로
// 상호명/전화번호/naver.me 링크 뭘 넣어도 동작한다.
app.get('/api/gap', async (c) => {
  const placeId = c.req.query('placeId');
  const keyword = c.req.query('keyword')?.trim().replace(/\s+/g, ' ');
  const competitorQuery = c.req.query('competitorId');
  if (!placeId || (!keyword && !competitorQuery)) {
    return c.json({ error: 'placeId와 keyword(또는 competitorId)가 필요합니다.' }, 400);
  }

  const bypassed = !!c.env.RATE_LIMIT_BYPASS_TOKEN && c.req.query('bypass') === c.env.RATE_LIMIT_BYPASS_TOKEN;
  if (!bypassed) {
    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown';
    const withinLimit = await checkDailyGapLimit(c.env, clientIp);
    if (!withinLimit) {
      return c.json({ error: `하루 검색 한도(${DAILY_GAP_LIMIT}건)를 초과했습니다. 내일 다시 시도해주세요.` }, 429);
    }
  }

  try {
    // 내 매장 (1단계에서 이미 캐시됐다면 재스크랩 없음)
    const myStore = await cachedPlace(c.env, placeId, true);

    let ranking: string[];
    let myRank: number | null;
    let competitors: any[];
    let boundaryStore: any;
    let displayLabel: string; // targetKeyword 자리에 들어가는 표시용 문자열 (raw_data·화면 제목 등에 재사용)
    let rankObservation: any = null;

    if (competitorQuery) {
      // 경쟁사 직접 지목 모드: 순위 자동수집 없이 지목한 업체 1곳만 비교
      const competitor = await cachedPlace(c.env, competitorQuery);
      if (competitor.placeId === placeId) {
        return c.json({ error: '내 매장과 같은 곳입니다. 다른 업체를 입력해주세요.' }, 400);
      }
      ranking = [placeId, competitor.placeId];
      myRank = null; // 자동순위 개념이 없는 모드
      competitors = [competitor];
      boundaryStore = competitor; // "진입선" = 지목한 그 업체의 실측값
      displayLabel = `'${competitor.name}'와 직접 비교`;
    } else {
      // Map list observation is separate from the legacy search widget.
      const category = /미용실|헤어|살롱/.test(keyword! + myStore.category) ? 'hairshop'
        : /맛집|밥집|식당|고기|횟집|카페|음식|한식|중식|일식|양식|백숙|삼계탕/.test(keyword! + myStore.category) ? 'restaurant' : 'place';
      const listKey = `${CACHE_VERSION}:map-list:v1:${category}:${keyword}`;
      let listing = await c.env.CACHE?.get<SearchListing>(listKey, 'json');
      try {
        if (!listing) {
          listing = await collectSearchListing(keyword!, category);
          // A partial failure is usable with an explicit warning, never a six-hour successful cache.
          if (listing.stopReason !== 'collection_failed') await c.env.CACHE?.put(listKey, JSON.stringify(listing), { expirationTtl: KEYWORD_TTL });
        }
        ranking = listing.items.map(item => item.placeId);
        rankObservation = { ...listing, category };
      } catch (err) {
        // Keep existing diagnoses available when the separate map endpoint is blocked.
        const widget = await cached(c.env, `widget:v1:${keyword}`, KEYWORD_TTL, async () => ({
          ids: await getOrganicRanking(keyword!, 14), collectedAt: new Date().toISOString(),
        }));
        ranking = widget.ids;
        rankObservation = { source: 'naver-search-widget', collectedAt: widget.collectedAt,
          complete: false, stopReason: 'collection_failed', limit: 350, pages: 0,
          errorCode: err instanceof CollectionError ? err.code : 'UNKNOWN', items: [] };
      }
      if (!ranking || ranking.length === 0) {
        return c.json({ error: `"${keyword}" 키워드의 검색 결과를 찾을 수 없습니다.` }, 404);
      }

      const myRankIndex = ranking.indexOf(placeId);
      myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;
      rankObservation = { ...rankObservation, searched: ranking.length,
        status: myRank ? 'found' : rankObservation.stopReason === 'collection_failed' ? 'unconfirmed' : 'not_found_in_range' };

      const top10Ids = ranking.slice(0, TOP_N).filter(id => id !== placeId);
      if (top10Ids.length === 0) {
        return c.json({ error: '비교할 경쟁사가 없습니다.' }, 404);
      }
      competitors = await Promise.all(
        top10Ids.map(id => cachedPlace(c.env, id))
      );

      // TOP_N위 업체 = 1페이지 진입선. 본인이 TOP_N위면 그다음 순위를 진입선으로 사용.
      const boundaryId = ranking[TOP_N - 1] && ranking[TOP_N - 1] !== placeId ? ranking[TOP_N - 1] : ranking[TOP_N];
      boundaryStore = boundaryId
        ? (competitors.find(s => s.placeId === boundaryId)
          || await cachedPlace(c.env, boundaryId))
        : null;
      displayLabel = keyword!;
    }

    // 상위노출 영향 지표(질문4 B그룹) 파생 계산: 거리·키워드 포함 여부는 추가 요청 없이
    // 이미 수집한 좌표/상호명/카테고리만으로 계산 가능. myStore·경쟁사 전부에 부착.
    // 경쟁사 직접 지목 모드는 검색 키워드가 없으므로 키워드 매칭은 항상 false로 둔다.
    (myStore as any).rankFactors = {
      ...(competitorQuery ? { nameContainsKeyword: false, categoryMatchesKeyword: false } : keywordMatch(keyword!, myStore.name, myStore.category)),
      distanceFromMeKm: 0,
    };
    for (const comp of competitors) {
      (comp as any).rankFactors = {
        ...(competitorQuery ? { nameContainsKeyword: false, categoryMatchesKeyword: false } : keywordMatch(keyword!, comp.name, comp.category)),
        distanceFromMeKm: haversineKm(myStore.coordinates?.x, myStore.coordinates?.y, comp.coordinates?.x, comp.coordinates?.y),
      };
    }

    const metricKeys: Array<[string, boolean]> = [
      ['visitorReviewsTotal', false],
      ['cafeBlogReviewsTotal', false],
      ['totalVoteCount', false],
      ['photoCount', false],
      ['visitorReviewsScore', true],
    ];
    const stats: Record<string, { avg: number; median: number; boundary: number | null }> = {};
    for (const [key, isScore] of metricKeys) {
      const s = calcStats(competitors, key, isScore);
      stats[key] = {
        ...s,
        boundary: boundaryStore ? (Number(boundaryStore.seoMetrics[key]) || (isScore ? null : 0)) : null,
      };
    }

    // A/B/C 등급: 상위 평균(1위 단독 아님) 대비 방문자 리뷰 백분율
    const reviewRatio = myStore.seoMetrics.visitorReviewsTotal / Math.max(stats.visitorReviewsTotal.avg, 1);
    let grade = 'B';
    if (reviewRatio >= 0.8) grade = 'A';
    if (reviewRatio < 0.5) grade = 'C';

    const shareId = generateShareId();
    await upsertPlace(c.env.DB, myStore); // search_histories.place_id FK 충족 (place API를 거치지 않고 gap을 바로 호출하는 경우 대비)

    // 고객 화면에 내려보내는 건 **구간으로 뭉뚱그린 한 문장뿐**이다 (§6.5.9).
    // 실수치는 관리자 리포트에서만 본다 — 여기서 숫자를 실으면 정책이 깨진다.
    const keywordVolumeNote = competitorQuery
      ? null
      : describeVolume(displayLabel, (await getKeywordVolumes(c.env, [displayLabel], { context: 'gap-keyword' }))[displayLabel] ?? null);

    const responsePayload = {
      success: true,
      shareId,
      targetKeyword: displayLabel,
      keywordVolumeNote, // 구간 문장 | null — 실수치 없음
      isDirectCompare: !!competitorQuery, // 경쟁사 직접 지목 모드 여부 — 프론트가 "상위 N개" 문구 대신 1:1 비교 문구를 쓰도록 분기
      myStore,
      myRank,
      rankSearched: competitorQuery ? 1 : ranking.length,
      rankObservation,
      comparisonCount: competitors.length,
      top10Competitors: competitors,
      stats,
      grade,
    };

    const db = c.env.DB;
    if (db) {
      try {
        await db.prepare(`
          INSERT INTO search_histories (share_id, place_id, target_keyword, my_rank, top10_avg_reviews, top10_median_reviews, rank_boundary_reviews, my_reviews, grade_reviews, raw_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          shareId,
          myStore.placeId,
          displayLabel,
          myRank,
          stats.visitorReviewsTotal.avg,
          stats.visitorReviewsTotal.median,
          stats.visitorReviewsTotal.boundary,
          myStore.seoMetrics.visitorReviewsTotal,
          grade,
          JSON.stringify(responsePayload)
        ).run();
      } catch (dbErr) {
        console.error('DB Insert Error:', dbErr);
        return c.json({ error: '분석 결과 저장에 실패했습니다. 검색 횟수는 차감되지 않았습니다.' }, 503);
      }
    }

    // 신규 진단 완료 알림 + 콜드콜 리스트 적재 (§8.2-A). 응답 지연 없이 백그라운드 처리.
    const bgTasks: Promise<any>[] = [
      notify(c.env, `📊 [신규 진단] ${myStore.name} (${myStore.placeId})\n${competitorQuery ? '비교 대상' : '키워드'}: ${displayLabel}\n${competitorQuery ? '1:1 직접비교' : (myRank ? `수집 목록 위치: ${myRank} (${rankObservation?.source})` : `수집 ${ranking.length}곳 내 미발견`)} / 등급: ${grade}\n연락처: ${myStore.phone || '미등록'}`),
      logDiagnosisToSheet(c.env, {
        timestamp: new Date().toISOString(),
        placeName: myStore.name,
        placeId: myStore.placeId,
        phone: myStore.phone,
        category: myStore.category,
        roadAddress: myStore.roadAddress,
        targetKeyword: displayLabel,
        myRank,
        grade,
        visitorReviews: myStore.seoMetrics.visitorReviewsTotal,
        shareId,
      }),
    ];
    // 경쟁사 직접 지목 모드는 진짜 오가닉 순위가 아니라 rank_snapshots(§9 리버스엔지니어링 시계열)에는 안 남긴다.
    if (!competitorQuery) {
      // 상호 검색량도 함께 기록한다 (§6.5.10). "그 업체 상호가 월 몇 번 직접 검색되는가" =
      // 순위와 무관한 직접 검색 유입의 추정치라, 순위가 떨어졌는데 매출은 안 떨어진 경우 등을
      // 설명할 수 있는 축이 된다. KV 캐시는 끈다 — 상호 7개면 읽기/쓰기 14회로 subrequest
      // 한도(50)를 위협하지만, 캐시 없이 배치로 돌리면 fetch 2회로 끝난다.
      // 이미 개별 스크랩한 8곳의 텍스트를 남긴다(§9.13). 추가 요청 0회 — 지금까지 버리던 값이다.
      bgTasks.push((async () => {
        for (const s of [myStore, ...competitors]) await savePlaceTexts(c.env.DB, s);
      })());
      bgTasks.push((async () => {
        const names = [myStore.name, ...competitors.map((comp: any) => comp.name)].filter(Boolean);
        const nameVolumes = await getKeywordVolumes(c.env, names, { cache: false, context: 'gap-store-name', relatedTo: displayLabel });
        // Map observation (including the full ordered list) is saved in search_histories.raw_data.
        // Do not blend this different source into legacy widget-only rank snapshots.
        if (rankObservation?.source !== 'naver-map') await logRankSnapshots(c.env.DB, displayLabel, ranking, myStore, myRank, competitors, 'user', nameVolumes);
      })());
    }
    c.executionCtx.waitUntil(Promise.all(bgTasks));

    // Only successful complete analyses consume the daily allowance.
    if (!bypassed && (!rankObservation || rankObservation.stopReason !== 'collection_failed')) {
      await checkDailyGapLimit(c.env, c.req.header('CF-Connecting-IP') || 'unknown', true);
    }

    return c.json(responsePayload);
  } catch (err: any) {
    console.error('Gap 분석 중 오류:', err);
    c.executionCtx.waitUntil(notify(c.env, `⚠️ [Gap 분석 실패] placeId="${placeId}" keyword="${keyword || competitorQuery}"\n${err.message || err}\n(네이버 구조 변경 또는 차단 가능성 — §7 확인 요망)`));
    if (err instanceof CollectionError) return c.json({ error: err.message, code: err.code, stage: err.stage }, 503);
    return c.json({ error: err.message || 'Gap 분석에 실패했습니다.' }, 500);
  }
});

app.get('/api/history', async (c) => {
  const shareId = c.req.query('shareId');
  if (!shareId) {
    return c.json({ error: 'shareId가 필요합니다.' }, 400);
  }

  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database not configured.' }, 500);
  }

  try {
    const row = await db.prepare('SELECT raw_data FROM search_histories WHERE share_id = ?').bind(shareId).first();
    if (!row) {
      return c.json({ error: '해당 진단 결과를 찾을 수 없습니다.' }, 404);
    }
    return c.json(JSON.parse(row.raw_data as string));
  } catch (err) {
    console.error('히스토리 조회 중 오류:', err);
    return c.json({ error: '서버 오류가 발생했습니다.' }, 500);
  }
});

// 상담 문의 CTA 클릭 로그. 실제 연락은 카톡/문자로 사이트 밖에서 이뤄지므로(§9.9) 우리 쪽엔
// 아무 기록도 안 남는데, 이 한 줄이 "관심 보인 사람이 있었다"는 유일한 신호다.
// 응답은 항상 200 — 이 호출이 실패해도 사용자 흐름(전화 걸기)을 막으면 안 된다.
// 진단 결과에서 "지금 가장 부족한 것" 상위 3개를 사람이 읽는 문장으로 뽑는다 (§6.7).
// 메일 본문에 그대로 들어가므로 링크를 안 눌러도 값이 남게 하는 것이 목적이다.
const GAP_LABELS: Array<[string, string, string]> = [
  ['cafeBlogReviewsTotal', '블로그·카페 리뷰', '건'],
  ['visitorReviewsTotal', '방문자 리뷰', '건'],
  ['totalVoteCount', '키워드 투표수', '표'],
  ['photoCount', '등록 사진', '장'],
];
function summarizeGaps(data: any): string[] {
  const my = data?.myStore?.seoMetrics || {};
  const stats = data?.stats || {};
  return GAP_LABELS
    .map(([key, label, unit]) => {
      const mine = Number(my[key] ?? 0);
      const boundary = Number(stats[key]?.boundary ?? 0);
      if (!boundary || mine >= boundary) return null;
      return { label, unit, mine, boundary, short: boundary - mine };
    })
    .filter((g): g is NonNullable<typeof g> => !!g)
    // ⚠️ §2: 정렬은 "결핍이 큰 순"이 아니라 "싸고 빨리 되는 것" 순이다.
    // 진입선 대비 달성률이 높은 것 = 가장 가까운 것부터 올린다. 반대로 정렬하면
    // "18,842표 부족"이 첫 줄에 와서 사장님이 그 자리에서 포기한다(실제로 그렇게 나갔다).
    .sort((a, b) => a.short / (a.boundary || 1) - b.short / (b.boundary || 1))
    .slice(0, 3)
    .map((g, i) => `${i + 1}. ${g.label}  현재 ${g.mine.toLocaleString()}${g.unit} → 1페이지 진입선 ${g.boundary.toLocaleString()}${g.unit} (${g.short.toLocaleString()}${g.unit} 부족)`);
}

// 리포트 메일 신청 (§6.7). 기존 "카톡/문자 주세요" CTA가 전환 0건이라 이메일 수집으로 교체했다.
// 고객용 맞춤 개선 리포트 (§6.7). 메일로 보내는 링크가 이 주소다.
// 관리자용(/admin/:shareId/report)과 같은 화면을 쓰되 __REPORT_ADMIN__을 주입하지 않는다 —
// 검색량 표·실제 연락처는 관리자 전용이라 그 플래그로 갈린다.
// 인증을 걸지 않는 이유: shareId는 이미 공유링크로 쓰이는 값이고, 여기에 로그인을 붙이면
// "메일 열고 바로 확인"이라는 이 기능의 존재 이유가 사라진다.
app.get('/report/:shareId', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);

  const shareId = c.req.param('shareId');
  const exists = await db.prepare('SELECT 1 FROM search_histories WHERE share_id = ?').bind(shareId).first();
  if (!exists) {
    return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>리포트를 찾을 수 없습니다</title></head><body style="font-family:sans-serif;padding:32px;text-align:center;"><p>리포트를 찾을 수 없습니다. 링크가 오래됐을 수 있습니다.</p><a href="/">내 매장 다시 진단하기</a></body></html>`, 404);
  }

  const assetRes = await c.env.ASSETS.fetch(new URL('/', c.req.url));
  const html = (await assetRes.text()).replace(
    '<head>',
    `<head>\n<script>window.__REPORT_SHARE_ID__ = ${JSON.stringify(shareId)};</script>`
  );
  return c.html(html);
});

// 메일 제목·본문 생성. 발송 경로와 미리보기 경로가 같은 문구를 쓰도록 한 곳에 모아둔다.
function buildReportMail(data: any, shareId: string, origin: string): { subject: string; body: string } {
  const name = data?.myStore?.name || '내 매장';
  const keyword = data?.targetKeyword || '';
  const gaps = summarizeGaps(data);

  const body = [
    `${name} 사장님, 안녕하세요.`,
    '',
    `요청하신 '${keyword}' 키워드 기준 맞춤 개선 리포트를 보내드립니다.`,
    '',
    gaps.length ? '■ 1페이지 진입선에 가장 가까운 항목부터' : '■ 진입선을 이미 넘긴 항목이 많습니다',
    ...(gaps.length ? gaps : ['  주요 지표가 1페이지 진입선을 이미 넘겼습니다. 세부 항목은 리포트에서 확인해주세요.']),
    '',
    ...(gaps.length ? ['모두 한 번에 채울 필요는 없습니다. 1번부터 하나씩 올리면 됩니다.', ''] : []),
    // 숫자만 보면 격차가 커 보이는 매장이 많다. 그 자리에서 포기하지 않도록 "숫자가 전부가
    // 아니다"로 한 번 받아준 뒤 상담으로 연결한다 (§2 "절망 유발 숫자 금지"의 연장).
    '■ 다만, 숫자가 전부는 아닙니다',
    '사진·리뷰 지표가 평균보다 낮은 업체, 심지어 내 매장보다 낮은 업체가 상위에 노출되는 경우도 있습니다.',
    '겉으로 드러나지 않는 지표까지 함께 관리했다는 뜻입니다.',
    '내 매장도 진단과 개선을 거치면 같은 결과를 낼 수 있습니다.',
    '자세한 진단과 컨설팅은 아래 연락처로 편하게 문의해주세요.',
    '',
    '■ 항목별 개선 방법이 정리된 전체 리포트',
    `   ${origin}/report/${shareId}`,
    '',
    '위 링크에서 항목마다 무엇을 어떻게 고치면 되는지 확인하실 수 있습니다.',
    '페이지 우측 상단 버튼으로 PDF 저장도 됩니다.',
    '',
    '─────────────',
    '이 리포트는 무료이며, 요청하지 않으시면 영업 전화를 드리지 않습니다.',
    '',
    'interpiad@gmail.com',
    '상호 : 인터피아드 (124-35-56796)',
    '상담전화 : 조승일 010-2490-0555 (무료)',
    '',
    // 줄바꿈은 문장 끝에서만 한다. 문장 중간을 끊으면 메일 클라이언트 폭에 따라 어색하게
    // 접힌다 — 긴 줄은 클라이언트가 알아서 감싸도록 두는 편이 항상 낫다.
    '인터피아드는 상위노출 마케팅 전문 기업입니다.',
    '20년 경력의 시니어 컨설턴트는 물론 다년간의 컨설팅 경력을 가진 각 분야 전문가들이 여러분의 상위노출을 도와드리고 있습니다.',
    '',
    '* 주의 : 강의/컨설팅 중에는 전화를 받을 수 없습니다. 메시지 남겨주시면 순서대로 회신 드리고 있습니다.',
  ].join('\n');

  return { subject: `[동네비즈] ${name} 맞춤 개선 리포트`, body };
}

/**
 * 상호 변형 검색량 합산 (§6.8). 리포트 화면의 "정밀" 버튼이 매장 1곳씩 호출한다.
 *
 * 리포트를 열 때 7곳을 한꺼번에 돌리지 않는 이유: 매장당 자동완성 1 + 검색광고 3 = 4 subrequest라
 * 7곳이면 28회가 페이지 로드에 얹힌다. 기존 조회분까지 더하면 한도(50)를 넘긴다.
 * 그래서 **필요한 매장만 눌러서** 조회하도록 요청을 쪼갰다.
 */
app.get('/admin/brand-volume', async (c) => {
  const name = (c.req.query('name') || '').trim();
  const region = (c.req.query('region') || '').trim();
  if (!name) return c.json({ error: 'name이 필요합니다.' }, 400);

  const variants = brandVariants(name, region, await autocomplete(name));
  // relatedTo에 원 상호를 남긴다. 그러면 나중에 '이 매장의 변형 후보 전체'를 복원할 수 있어
  // 사람 판단(체크박스)을 저장하지 않아도 분석 시점에 다시 고를 수 있다(§9.12).
  const volumes = await getKeywordVolumes(c.env, variants, { context: 'brand-variant', relatedTo: name });

  // "< 10"은 상한을 더한 근사치라 합계에 넣으면 없는 숫자가 만들어진다(§6.6.1에서 겪음).
  // 합계에서 빼고 개수만 따로 알린다.
  const rows = variants
    .map(keyword => ({ keyword, volume: volumes[keyword] }))
    .filter((r): r is { keyword: string; volume: NonNullable<typeof r.volume> } => !!r.volume);
  const measured = rows.filter(r => !r.volume.isUnderTen);

  // ⚠️ 브랜드 토큰만 남긴 변형이 전국 체인 검색량을 물고 온다. 실측 예:
  // '고기굽는방앗간 상록수역점'은 월 50회인데 '고기굽는방앗간'은 29,420회 — 이건 전국 지점
  // 전체를 찾는 사람이지 이 지점 손님이 아니다. 정식 상호 대비 5배를 넘고 1,000회 이상이면
  // 이 매장 것으로 보지 않고 합계에서 뺀다(목록에는 남겨 사람이 판단할 수 있게 한다).
  const fullNameVolume = rows.find(r => r.keyword === name)?.volume.total ?? 0;
  const isTooBig = (total: number) => total > Math.max(1000, fullNameVolume * 5);

  // 브랜드 토큰 단독은 **기본 합산 제외**한다. 이게 매번 가장 큰 숫자를 물고 오는데,
  // 진짜 브랜드일 수도('이동고고갈비') 업종어일 수도('인형수선') 있고 자동으로는 못 가린다.
  // 켜고 끄는 판단은 화면에서 사람이 한다(§6.8.3).
  const core = normalizeKeyword(brandCore(name));
  const isCore = (keyword: string) => normalizeKeyword(keyword) === core && keyword !== name;

  const detailed = rows
    .map(r => ({
      keyword: r.keyword,
      total: r.volume.isUnderTen ? null : r.volume.total,
      core: isCore(r.keyword),
      excluded: !r.volume.isUnderTen && isTooBig(r.volume.total),
    }))
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0));

  return c.json({
    name,
    // 기본 합계 = 단독 토큰과 과대 추정 행을 뺀 보수적인 값
    total: detailed.filter(r => r.total != null && !r.core && !r.excluded).reduce((s, r) => s + (r.total ?? 0), 0),
    underTenCount: rows.length - measured.length,
    rows: detailed,
  });
});

// 발송하지 않고 실제 메일 본문만 확인한다. 문구를 고칠 때마다 메일함을 뒤지면 "고친 게
// 반영된 건지, 옛 메일을 보고 있는 건지"를 구분할 수 없어서 만들었다(실제로 겪음).
// /admin/* Basic Auth가 이미 걸려 있다.
app.get('/admin/:shareId/report-email-preview', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);
  const shareId = c.req.param('shareId');
  const row = await db.prepare('SELECT raw_data FROM search_histories WHERE share_id = ?').bind(shareId).first();
  if (!row) return c.text('진단 기록을 찾을 수 없습니다.', 404);
  const mail = buildReportMail(JSON.parse(row.raw_data as string), shareId, new URL(c.req.url).origin);
  return c.text(`(미리보기 · 발송 안 함)\n제목: ${mail.subject}\n${'─'.repeat(40)}\n${mail.body}`);
});

app.post('/api/report-email', async (c) => {
  const { shareId, email } = await c.req.json<{ shareId?: string; email?: string }>().catch(() => ({} as any));
  const addr = (email || '').trim();
  // 신뢰 경계다. 형식 검증 없이 넣으면 웹훅으로 아무 문자열이나 흘러간다.
  if (!shareId || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr) || addr.length > 254) {
    return c.json({ error: '이메일 주소를 다시 확인해주세요.' }, 400);
  }

  const db = c.env.DB;
  const row = db ? await db.prepare('SELECT raw_data FROM search_histories WHERE share_id = ?').bind(shareId).first() : null;
  if (!row) return c.json({ error: '진단 기록을 찾을 수 없습니다. 진단을 다시 실행해주세요.' }, 404);

  const data = JSON.parse(row.raw_data as string);
  const name = data?.myStore?.name || '내 매장';
  const keyword = data?.targetKeyword || '';
  const origin = new URL(c.req.url).origin;

  const { sent, quota, error } = await sendCustomerEmail(c.env, { to: addr, ...buildReportMail(data, shareId, origin) });

  // 하루 한도(일반 gmail 계정 100통)가 바닥나는 걸 사후에 알면 늦다. 남으면 미리 경고한다.
  const quotaLine = quota != null && quota <= 20 ? `\n⚠️ 오늘 남은 발송 한도 ${quota}통` : '';

  c.executionCtx.waitUntil(Promise.all([
    db ? db.prepare(`INSERT INTO report_leads (id, share_id, place_id, place_name, keyword, email, sent) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), shareId, data?.myStore?.placeId ?? null, name, keyword, addr, sent ? 1 : 0).run()
      .catch(err => console.error('report_leads 기록 실패:', err)) : Promise.resolve(),
    notify(c.env, `📧 [리포트 메일 신청] ${name}\n키워드: ${keyword}\n이메일: ${addr}\n발송: ${sent ? '성공' : `실패 — 수동 발송 필요 (${error})`}${quotaLine}\n관리자 리포트: ${origin}/admin/${shareId}/report`),
  ]));

  // 발송 실패해도 리드는 남고 텔레그램 알림이 갔으므로 수동 발송이 가능하다.
  // 다만 사장님에게 "보냈다"고 하면 거짓말이 되므로, 화면 문구는 sent 값으로 갈린다.
  return c.json({ success: true, sent });
});

app.get('/api/lead-click', async (c) => {
  const placeId = c.req.query('placeId') || '';
  const name = c.req.query('name') || '이름 미상';
  const keyword = c.req.query('keyword') || '';
  const shareId = c.req.query('shareId') || '';
  // 리포트 링크는 관리자만 열 수 있으면 됨 — /admin/* 기존 Basic Auth를 그대로 태운다.
  const reportLine = shareId ? `\nPDF 리포트: ${new URL(c.req.url).origin}/admin/${shareId}/report` : '';
  c.executionCtx.waitUntil(Promise.all([
    notify(c.env, `📞 [상담 CTA 클릭] ${name} (${placeId})${keyword ? `\n키워드: ${keyword}` : ''}${reportLine}\n카톡/문자로 연락할 가능성 있음 — 응답 준비.`),
    logDiagnosisToSheet(c.env, {
      type: 'lead_click',
      timestamp: new Date().toISOString(),
      placeName: name,
      placeId,
      targetKeyword: keyword,
    }),
  ]));
  return c.json({ success: true });
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 공유 링크 크롤러(카카오톡/페이스북 등)용 OG 메타 페이지. [assets]는 이 경로에 파일이 없으므로
// 자동으로 Worker까지 흘러들어온다. 사람이 열면 실제 앱(/?shareId=...)으로 즉시 리다이렉트된다.
app.get('/share/:shareId', async (c) => {
  const shareId = c.req.param('shareId');
  const db = c.env.DB;
  const appUrl = `/?shareId=${encodeURIComponent(shareId)}`;

  let title = '동네비즈 - 네이버 플레이스 상위노출 Gap 진단';
  let description = '전화번호 하나로 우리 매장의 상위노출 현주소를 진단합니다.';
  let image = '';

  if (db) {
    try {
      const row = await db.prepare('SELECT raw_data FROM search_histories WHERE share_id = ?').bind(shareId).first();
      if (row) {
        const data = JSON.parse(row.raw_data as string);
        const my = data.myStore;
        title = `${my.name} 상위노출 진단 결과 (${data.grade}등급)`;
        description = `'${data.targetKeyword}' 키워드 상위 ${TOP_N}개 업체와 비교한 ${my.name}의 실시간 Gap 분석 결과. 지금 확인해보세요.`;
        if (my.samplePhotos && my.samplePhotos.length > 0) image = my.samplePhotos[0];
      }
    } catch (err) {
      console.error('공유 페이지 OG 조회 오류:', err);
    }
  }

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<!-- §6.1.2b 2단: 개별 진단 결과는 공유는 되되 색인은 막는다(등급·결핍 판정이 특정 업체명과
     함께 검색에 노출되는 신용 리스크 차단). 공개 색인 자산은 /rank/:keyword 쪽이다. -->
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${appUrl}">
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head>
<body>
<p>결과 페이지로 이동 중입니다. 자동으로 이동하지 않으면 <a href="${appUrl}">여기를 클릭</a>하세요.</p>
</body>
</html>`;

  return c.html(html);
});

// ─────────────────────────────────────────────────────────────────────────────
// pSEO: 키워드 순위 페이지 (§6.1). 공개 범위는 §6.1.2b의 "1단"으로 엄격히 제한한다 —
// 순위표·집계·변동성만 싣고 해석/권고 문장과 개별 업체 시계열은 절대 넣지 않는다.
// 그게 곧 컨설팅 상품이라 공개하는 순간 경쟁사에 무료로 넘어간다.
// ─────────────────────────────────────────────────────────────────────────────

const RANK_PAGE_STYLE = `
${SITE_NAV_CSS}
  *{box-sizing:border-box} body{margin:0;padding:0;font-family:-apple-system,'Pretendard',sans-serif;color:#0F172A;background:#F8FAFC;line-height:1.6}
  .wrap{max-width:760px;margin:0 auto;padding:24px 16px 56px}
  h1{font-size:22px;margin:20px 0 6px;line-height:1.35}
  .meta{font-size:12px;color:#64748B;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  th,td{padding:10px 12px;font-size:13px;text-align:left;border-bottom:1px solid #E2E8F0}
  th{background:#F1F5F9;font-weight:700;color:#475569;font-size:12px}
  td.num,th.num{text-align:right}
  tr:last-child td{border-bottom:none}
  .rank{font-weight:800;color:#2563EB}
  h2{font-size:15px;margin:28px 0 10px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .card{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px}
  .card .k{font-size:11px;color:#64748B;display:block;margin-bottom:4px}
  .card .v{font-size:20px;font-weight:800}
  .cta{display:block;margin:28px 0 0;background:#0F172A;color:#fff;text-align:center;padding:16px;border-radius:14px;font-weight:800;text-decoration:none}
  footer{margin-top:32px;font-size:11px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:16px}
  .kwlist{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
  .kwlist a{background:#fff;border:1px solid #E2E8F0;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:#334155;text-decoration:none}
  .navcards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:22px}
  .navcards a{display:block;background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:14px 16px;text-decoration:none;color:#0F172A}
  .navcards .t{display:flex;justify-content:space-between;align-items:center;gap:10px;font-weight:800;font-size:14px}
  .navcards .arw{color:#94A3B8}
  .navcards .d{display:block;margin-top:4px;font-size:12px;color:#64748B;font-weight:500;line-height:1.5}
  @media(max-width:520px){.navcards{grid-template-columns:1fr}}
  .answer{background:#EFF6FF;border-left:4px solid #2563EB;border-radius:0 12px 12px 0;padding:15px 17px;font-size:14px;font-weight:600;color:#1E3A8A;margin:0 0 22px;line-height:1.75}
  p{font-size:14px;color:#334155;line-height:1.8;margin:0 0 12px}
  details{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:13px 15px;margin-bottom:8px}
  summary{font-weight:700;cursor:pointer;font-size:13px}
  details p{margin:9px 0 0;font-size:13px}
  .sources{background:#F1F5F9;border-radius:12px;padding:14px 14px 14px 30px;margin:0;font-size:12px;color:#475569;line-height:1.7}
  .sources li{margin-bottom:6px}
  .sources li:last-child{margin-bottom:0}
  .rise{margin-top:7px;font-size:11px;color:#B45309;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
  .riseBadge{background:#FEF3C7;color:#B45309;font-weight:800;padding:2px 8px;border-radius:999px;animation:riseUp 1.8s ease-in-out infinite}
  .riseBtn{background:#0F172A;color:#fff;font-weight:700;padding:4px 10px;border-radius:8px;text-decoration:none;white-space:nowrap}
  @keyframes riseUp{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
  @media (prefers-reduced-motion:reduce){.riseBadge{animation:none}}
`;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

// "안산 상록구맛집"과 "안산 상록구 맛집"은 사용자 입력만 다를 뿐 같은 검색이라 같은 페이지가
// 된다. 띄어쓰기를 지운 값을 동일성 기준으로 삼는다.
function normKeyword(k: string): string {
  return k.replace(/\s+/g, '');
}

// 공개 자격: 관측 2회 이상. 1회짜리는 집계·변동성이 성립하지 않아 껍데기 페이지가 된다(§6.1.2).
// 띄어쓰기만 다른 표기는 관측이 많은 쪽 하나만 대표로 공개한다 — 안 그러면 내용이 같은
// 페이지가 여러 장 색인되어 §6.1.3의 대량생성 리스크를 스스로 키운다.
async function eligibleRankKeywords(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(`
    SELECT keyword, COUNT(DISTINCT collected_at) AS obs, MAX(collected_at) AS last_at
    FROM rank_snapshots
    GROUP BY keyword HAVING obs >= 2
    ORDER BY last_at DESC
  `).all();
  const rep = new Map<string, any>();
  for (const r of results as any[]) {
    const key = normKeyword(r.keyword);
    const cur = rep.get(key);
    if (!cur || r.obs > cur.obs) rep.set(key, r);
  }
  return [...rep.values()].map(r => r.keyword);
}

// 매장 전용 미니홈피 (§6.11, 샘플 단계). 전 페이지 noindex — 결제 연동 전까지 색인되면 안 된다.
// 매장 데이터는 §3.4 캐시 정책(placeId 24h)을 그대로 타므로 반복 조회로 네이버를 때리지 않는다.
// Hono는 `:topic?` 옵셔널 파라미터를 받지 않는다(404가 난다). 라우트를 둘로 나눈다.
async function miniSite(c: any, slug?: string) {
  const placeId = c.req.param('placeId');
  if (!/^[1-9]\d{6,11}$/.test(placeId)) return c.text('잘못된 주소입니다.', 400);

  try {
    const store = await cachedPlace(c.env, placeId);
    const topics = await pickTopics(store);
    if (!slug) return c.html(renderMiniHome(store, topics));

    const topic = topics.find(t => t.slug === slug);
    // 데이터가 없어서 안 만든 주제는 존재하지 않는 페이지다. 빈 페이지를 내주면 그게 저품질이다.
    if (!topic) return c.redirect(`/p/${placeId}`, 302);
    return c.html(renderMiniTopic(store, topic, topics));
  } catch (err: any) {
    console.error('미니홈피 생성 실패:', err);
    return c.text('매장 정보를 불러오지 못했습니다.', 500);
  }
}
app.get('/p/:placeId', c => miniSite(c));
app.get('/p/:placeId/:topic', c => miniSite(c, c.req.param('topic')));

// 마케팅 랜딩 (§6.10). 상단 3메뉴: 플레이스분석(/) · 광고컨설팅(/ads) · 블로그배포(/blog)
app.get('/ads', (c) => c.html(renderAdsPage()));
app.get('/blog', (c) => c.html(renderBlogPage()));

app.get('/rank', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);
  const keywords = await eligibleRankKeywords(db);
  const items = keywords.map(k =>
    `<a href="/rank/${encodeURIComponent(k)}">${escapeHtml(k)}</a>`
  ).join('');
  return c.html(`<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>네이버 플레이스 키워드별 순위 현황 | 동네비즈</title>
<meta name="description" content="네이버 플레이스 키워드별 상위 노출 업체 순위와 리뷰·사진 등 지표 현황을 실측 데이터로 정리했습니다.">
<link rel="canonical" href="https://dongbiz.com/rank">
<style>${RANK_PAGE_STYLE}</style></head><body>${siteNav('place')}<div class="wrap">
<h1>키워드별 네이버 플레이스 순위 현황</h1>
<p class="meta">관측이 2회 이상 누적된 키워드만 공개합니다. 총 ${keywords.length}개.</p>
<div class="kwlist">${items || '<span class="meta">아직 공개 가능한 키워드가 없습니다.</span>'}</div>
<a class="cta" href="/">내 매장 순위 무료로 진단하기</a>
<footer>상호 : 인터피아드 · 사업자등록번호 : 124-35-56796 · 문의 : interpiad@gmail.com</footer>
</div></body></html>`);
});

// 형제 링크용 관련 키워드 선정(사양 §1.7 횡 연결). 허브에서만 링크되면 페이지가 늘수록
// 허브 한 곳에 링크가 몰려 개별 링크 가치가 희석된다. 글자 2-gram이 많이 겹치는 순으로
// 고르면 "안산 도배" 옆에 "안산 상록구맛집"처럼 같은 지역이 자연스럽게 붙는다.
function relatedKeywords(current: string, all: string[], limit = 8): string[] {
  const grams = (s: string) => {
    const t = normKeyword(s);
    const out = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  };
  const mine = grams(current);
  return all
    .filter(k => normKeyword(k) !== normKeyword(current))
    .map((k, i) => {
      const g = grams(k);
      let hit = 0;
      for (const x of g) if (mine.has(x)) hit++;
      return { k, hit, i };
    })
    .sort((a, b) => b.hit - a.hit || a.i - b.i) // 겹침 우선, 같으면 최근 관측 순서 유지
    .slice(0, limit)
    .map(r => r.k);
}

// 한 관측 배치 안에서 같은 업체가 두 번 이상 들어간 경우를 걷어낸다. 같은 초에 두 번
// 기록되면 같은 업체가 같은 순위로 두 줄 보인다(2026-09-09 실제 발생). 순위가 낮은 쪽(=상위)
// 하나만 남긴다.
function dedupeByPlace(list: any[]): any[] {
  const seen = new Set<string>();
  return list.filter(r => (seen.has(r.place_id) ? false : (seen.add(r.place_id), true)));
}

// 관측 시각을 KST 기준 주차로 묶는다. "몇째 주"는 사람마다 다르게 세므로 날짜 범위를 병기한다(§6.4.3).
function weekOf(utcStr: string): { key: string; label: string } {
  const d = toKST(new Date(utcStr.replace(' ', 'T') + 'Z'));
  const mon = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  const m = (x: Date) => x.getUTCMonth() + 1;
  return {
    key: mon.toISOString().slice(0, 10),
    label: `${m(mon)}월 ${Math.ceil(mon.getUTCDate() / 7)}주차 (${m(mon)}/${mon.getUTCDate()}~${m(sun)}/${sun.getUTCDate()})`,
  };
}

// 진입선 기준 키워드 유형(§6.4.5). 가이드 문서 '키워드 세 유형'과 같은 구분이다.
function keywordTier(boundary: number | null): { label: string; color: string; desc: string } {
  const b = Number(boundary) || 0;
  if (b < 10) return { label: '틈새형', color: '#059669;background:#ECFDF5', desc: '리뷰 개수만으로는 변별력이 크지 않은 구간입니다. 기본 정보를 채우는 쪽이 빠릅니다.' };
  if (b < 1000) return { label: '중간형', color: '#B45309;background:#FFFBEB', desc: '꾸준히 하면 닿는 구간입니다. 몇 달 단위의 시간이 필요합니다.' };
  return { label: '고경쟁형', color: '#B91C1C;background:#FEF2F2', desc: '리뷰만으로 따라잡기 어려운 구간입니다. 더 좁은 키워드를 먼저 잡는 편이 현실적입니다.' };
}

function renderRankPageHtml(keyword: string, rows: any[], repKeyword: string, siblings: string[] = []): string {
  const batches = [...new Set(rows.map(r => r.collected_at))].sort();
  const latest = batches[batches.length - 1];
  const top = dedupeByPlace(
    rows.filter(r => r.collected_at === latest && r.rank).sort((a, b) => a.rank - b.rank)
  ).slice(0, TOP_N);

  // 변동성: 연속한 관측 사이에 상위권 순서가 바뀐 횟수. 개별 업체의 궤적은 드러내지 않는
  // 집계 수치라 §6.1.2b의 1단에 해당한다.
  const recent = batches.slice(-10);
  const orderOf = (batch: string) => dedupeByPlace(
    rows.filter(r => r.collected_at === batch && r.rank).sort((a, b) => a.rank - b.rank))
    .slice(0, TOP_N).map(r => r.place_id).join(',');
  let changes = 0;
  for (let i = 1; i < recent.length; i++) if (orderOf(recent[i]) !== orderOf(recent[i - 1])) changes++;

  // 직전 관측 대비 순위 변동. **상승만** 표시한다 — 특정 업체명 옆에 "하락"이 검색에 노출되면
  // §6.1.3 리스크 2(신용훼손 시비)가 그대로 살아난다. 또한 "왜 올랐는지"(지표 델타)는 계속
  // 감춘다. 사실만 보여주고 해석은 진단으로 유도하는 게 §6.1.2b의 취지다.
  const prevBatch = batches[batches.length - 2];
  const prevRank = new Map<string, number>();
  for (const r of rows) if (r.collected_at === prevBatch && r.rank) prevRank.set(r.place_id, r.rank);

  const reviews = top.map(r => Number(r.visitor_reviews) || 0);
  const boundary = reviews[reviews.length - 1];
  const tableRows = top.map(r => {
    const before = prevRank.get(r.place_id);
    const up = before ? before - r.rank : 0;
    let riseBlock = '';
    if (!before) {
      riseBlock = `<div class="rise"><span class="riseBadge">▲ 신규</span> 최근 순위권에 새로 진입했습니다. <a class="riseBtn" href="/">내 매장 진단하기</a></div>`;
    } else if (up > 0) {
      riseBlock = `<div class="rise"><span class="riseBadge">▲ ${up}</span> 최근 순위 상승 이슈가 있었습니다. <a class="riseBtn" href="/">내 매장 진단하기</a></div>`;
    }
    return `<tr>
    <td class="rank">${r.rank}</td>
    <td>${escapeHtml(r.place_name || '-')}${riseBlock}</td>
    <td class="num">${Number(r.visitor_reviews || 0).toLocaleString()}</td>
    <td class="num">${Number(r.blog_reviews || 0).toLocaleString()}</td>
    <td class="num">${Number(r.vote_count || 0).toLocaleString()}</td>
    <td class="num">${Number(r.photo_count || 0).toLocaleString()}</td>
  </tr>`;
  }).join('');

  // ── 주차별 순위표(§6.4.3). 관측 주차가 3주 이상 쌓였을 때만 켠다. 빈칸투성이 표는
  // 부실해 보이므로 그 전에는 위의 단일 시점 표만 보여준다.
  // 화살표·하락 표기는 넣지 않는다(§6.4.4) — 순위 숫자만 두면 사실 나열이지만 화살표를
  // 붙이는 순간 평가가 되어 신용훼손 리스크가 생긴다.
  const byWeek = new Map<string, { label: string; batch: string }>();
  for (const b of batches) {
    const w = weekOf(b);
    byWeek.set(w.key, { label: w.label, batch: b }); // 같은 주에 여러 번이면 마지막 관측이 대표값
  }
  const weeks = [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-4);
  let weeklyBlock = '';
  if (weeks.length >= 3) {
    const rankAt = (batch: string) => {
      const m = new Map<string, number>();
      for (const r of dedupeByPlace(rows.filter(x => x.collected_at === batch && x.rank).sort((a, b) => a.rank - b.rank))) {
        m.set(r.place_id, r.rank);
      }
      return m;
    };
    const maps = weeks.map(([, v]) => rankAt(v.batch));
    const head = weeks.map(([, v]) => `<th class="num">${escapeHtml(v.label)}</th>`).join('');
    const body = top.map((r, i) => `<tr>
      <td>${escapeHtml(r.place_name || '-')}</td>
      ${maps.map(m => `<td class="num">${m.has(r.place_id) ? m.get(r.place_id) + '위' : '<span style="color:#CBD5E1">–</span>'}</td>`).join('')}
    </tr>`).join('');
    weeklyBlock = `
<h2>최근 ${weeks.length}주 순위 추이</h2>
<div style="overflow-x:auto"><table>
  <thead><tr><th>업체명</th>${head}</tr></thead>
  <tbody>${body}
    <tr><td colspan="${weeks.length + 1}" style="background:#F8FAFC"><b>내 매장은 이 표에 없나요?</b> 아래 무료로 진단하기 버튼을 클릭하시면 내 매장의 상황을 확인하실 수 있습니다.</td></tr>
  </tbody>
</table></div>
<p class="meta" style="margin-top:10px">각 주의 마지막 관측을 그 주의 순위로 표기했습니다. 관측이 없는 주는 –로 표시됩니다.</p>`;
  }

  // 순위표를 기계가 읽을 수 있게 ItemList로 노출. 사실(순위·상호명)만 담는다 —
  // 평가·등급을 구조화 데이터로 내보내면 §6.1.3의 신용 리스크가 그대로 따라온다.
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${keyword} 네이버 플레이스 순위`,
    numberOfItems: top.length,
    itemListElement: top.map(r => ({
      '@type': 'ListItem',
      position: r.rank,
      name: r.place_name || '',
    })),
  }).replace(/</g, '\\u003c');
  const faqLd = (list: { q: string; a: string }[]) => JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: list.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }).replace(/</g, '\\u003c');

  // 제목에 '플레이스·지표·상위노출' 같은 업계 용어를 반드시 넣는다(§6.4.2). "제주도 맛집 순위"로
  // 두면 맛집 찾는 소비자가 유입돼 이탈률만 오르고 전환은 0이다. 걸러낼 신호가 필요하다.
  const tier = keywordTier(boundary);
  const mid = median(reviews);

  // ── 문서 구조화(§6.4.5). 문구를 pool에서 고르는 것이 아니라 **데이터 조건이 어떤 문단을
  // 쓸지 결정**한다. 그래서 키워드마다 실제로 다른 글이 되고, 조건이 안 맞으면 그 문단은
  // 아예 생기지 않는다(빈 내용을 채우려 문장을 늘리지 않는다).
  const midBlog = median(top.map(r => Number(r.blog_reviews) || 0));
  const midPhoto = median(top.map(r => Number(r.photo_count) || 0));
  const midVote = median(top.map(r => Number(r.vote_count) || 0));
  const reviewLeader = [...top].sort((a, b) => (Number(b.visitor_reviews) || 0) - (Number(a.visitor_reviews) || 0))[0];
  const rankLeader = top[0];
  const leaderMismatch = reviewLeader && rankLeader && reviewLeader.place_id !== rankLeader.place_id;

  const tierAdvice = tier.label === '틈새형'
    ? `${keyword}는 상위권 리뷰 수가 낮아 리뷰 개수만으로는 순위가 갈리지 않는 구간입니다. 이런 키워드에서는 영업시간·찾아오는 길·상세설명처럼 등록만 하면 되는 항목을 채우는 쪽이 훨씬 빠릅니다. 다만 진입이 쉬운 만큼 검색량도 적으므로, 이 키워드 하나만으로는 방문자 수가 크게 늘지 않습니다.`
    : tier.label === '중간형'
      ? `${keyword}는 꾸준히 관리하면 닿는 구간입니다. 다만 몇 달 단위의 시간이 필요하고, 그동안 경쟁 업체도 움직이므로 진입선을 고정된 목표가 아니라 계속 올라가는 기준으로 봐야 합니다. 소상공인에게 가장 현실적인 목표가 대개 이 구간입니다.`
      : `${keyword}는 리뷰만으로 따라잡기 어려운 구간입니다. 진입선이 ${boundary.toLocaleString()}건이므로 하루 10건씩 모아도 계산상 ${Math.max(1, Math.round(boundary / 10 / 30))}개월이 걸립니다. 정면으로 붙기보다 같은 손님이 칠 법한 더 좁은 키워드를 먼저 잡아 실제 방문을 만드는 순서가 현실적입니다.`;

  const changeBlock = changes > 0
    ? `<p>최근 관측 ${recent.length}회 동안 이 키워드의 상위 ${top.length}위권에서 자리가 바뀐 것은 ${changes}회입니다. 순위가 고정되어 있지 않다는 뜻이며, 관리하지 않으면 밀리고 관리하면 올라갈 여지가 함께 있다는 신호입니다.</p>`
    : '';

  const leaderBlock = leaderMismatch
    ? `<p>눈여겨볼 점이 있습니다. 이 키워드에서 방문자 리뷰가 가장 많은 곳은 ${escapeHtml(reviewLeader.place_name || '-')}(${Number(reviewLeader.visitor_reviews || 0).toLocaleString()}건)인데, 실제 1위는 ${escapeHtml(rankLeader.place_name || '-')}(${Number(rankLeader.visitor_reviews || 0).toLocaleString()}건)입니다. 리뷰 수가 순위를 그대로 결정하지 않는다는 것을 이 키워드 안에서 바로 확인할 수 있습니다.</p>`
    : `<p>이 키워드에서는 방문자 리뷰가 가장 많은 곳이 1위이기도 합니다. 다만 이것이 리뷰가 순위를 결정한다는 뜻은 아닙니다. 저희가 관측한 다른 키워드에서는 리뷰가 더 적은데도 더 높은 자리에 있는 업체가 흔하게 확인됩니다.</p>`;

  // 자동 FAQ. 조건에 따라 **문항 구성 자체가 달라지게** 한다. 키워드명만 바뀌고 나머지가
  // 같은 문항이 전 페이지에 반복되면 그 자체가 중복 신호가 된다.
  const faqs: { q: string; a: string }[] = [
    {
      q: `${keyword} 1페이지에 들어가려면 방문자 리뷰가 몇 건 필요한가요?`,
      a: `관측 기준으로 이 키워드의 1페이지 마지막 자리 업체는 방문자 리뷰 ${boundary.toLocaleString()}건을 보유하고 있습니다. 이 값을 진입선으로 보며, ${tier.label}에 해당합니다. 다만 리뷰는 여러 축 중 하나여서 이 숫자를 넘겼다고 진입이 보장되지는 않습니다.`,
    },
    {
      q: `${keyword} 상위 업체들의 지표는 어느 정도인가요?`,
      a: `상위 ${top.length}곳의 중앙값은 방문자 리뷰 ${mid.toLocaleString()}건, 블로그·카페 리뷰 ${midBlog.toLocaleString()}건, 사진 ${midPhoto.toLocaleString()}장, 키워드 투표 ${midVote.toLocaleString()}표입니다.`,
    },
  ];
  if (changes > 0) {
    faqs.push({
      q: `${keyword} 순위는 자주 바뀌나요?`,
      a: `최근 관측 ${recent.length}회 중 ${changes}회 자리가 바뀌었습니다. 관측 기간이 길어질수록 이 수치의 신뢰도가 올라갑니다.`,
    });
  }
  if (leaderMismatch) {
    faqs.push({
      q: `리뷰가 가장 많은 업체가 1위인가요?`,
      a: `아닙니다. 이 키워드에서 리뷰가 가장 많은 곳과 실제 1위는 서로 다른 업체입니다. 방문자 수나 재방문률, 체류시간처럼 검색 화면에 표시되지 않는 지표가 함께 작용합니다.`,
    });
  }
  faqs.push({
    q: `내 매장의 ${keyword} 순위는 어떻게 확인하나요?`,
    a: `동네비즈에서 상호나 전화번호와 이 키워드를 넣으면 상위 ${top.length}곳을 실시간으로 수집해 내 매장의 위치와 지표 격차를 함께 보여줍니다. 무료이며 로그인이 필요 없습니다.`,
  });

  const title = `${keyword} 플레이스 순위 분석 · 상위 ${top.length}곳 지표 비교`;
  const desc = `'${keyword}' 플레이스 상위 ${top.length}곳의 순위와 방문자 리뷰·블로그 리뷰·사진 수 실측 데이터. 1페이지 진입선 ${boundary.toLocaleString()}건(${tier.label}). 기준일 ${fmtKST(latest).slice(0, 10)}.`;
  const canonical = `https://dongbiz.com/rank/${encodeURIComponent(repKeyword)}`;

  return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | 동네비즈</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="https://dongbiz.com/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${jsonLd}</script>
<script type="application/ld+json">${faqLd(faqs)}</script>
<style>${RANK_PAGE_STYLE}</style></head><body><div class="wrap">
<header><a href="/">동네비즈</a> · <a href="/rank">키워드 전체 목록</a> · <a href="/guide">상위노출 가이드</a></header>
<h1>${escapeHtml(title)}</h1>
<p class="meta">기준일 ${escapeHtml(fmtKST(latest))} · 관측 ${batches.length}회 누적 · 네이버 통합검색 플레이스 영역 기준</p>
<p class="answer" id="aeo-direct-answer">'${escapeHtml(keyword)}' 검색 시 1페이지에 노출되는 업체는 ${top.length}곳이며, 마지막 자리 업체의 방문자 리뷰는 ${boundary.toLocaleString()}건입니다. 상위권 리뷰 중앙값은 ${mid.toLocaleString()}건, 사진 중앙값은 ${midPhoto.toLocaleString()}장입니다. 진입에 필요한 수준으로 보면 <b>${tier.label}</b>에 해당합니다.</p>
<table>
  <thead><tr><th>순위</th><th>업체명</th><th class="num">방문자 리뷰</th><th class="num">블로그 리뷰</th><th class="num">키워드 투표</th><th class="num">사진</th></tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<h2>상위권 지표 요약</h2>
<div class="cards">
  <div class="card"><span class="k">방문자 리뷰 중앙값</span><span class="v">${median(reviews).toLocaleString()}</span></div>
  <div class="card"><span class="k">1페이지 진입선 (${top.length}위)</span><span class="v">${boundary.toLocaleString()}</span></div>
  <div class="card"><span class="k">최근 관측 ${recent.length}회 중 순위 변동</span><span class="v">${changes}회</span></div>
</div>
<p style="margin-top:14px">이 키워드는 <b>${tier.label}</b>입니다. ${escapeHtml(tier.desc)}</p>
${mid > 0 && boundary > 0 ? `<p>상위권 방문자 리뷰 중앙값은 ${mid.toLocaleString()}건인데 1페이지 진입선은 ${boundary.toLocaleString()}건입니다. ${
  boundary > mid * 1.5
    ? '진입선이 중앙값보다 높다는 것은 상위권 안에서도 아래쪽이 두껍다는 뜻이며, 중앙값만 보고 목표를 잡으면 실제보다 낮게 잡게 됩니다.'
    : boundary * 1.5 < mid
      ? '진입선이 중앙값보다 낮다는 것은 최상위 몇 곳이 평균을 끌어올리고 있다는 뜻이며, 평균을 목표로 삼으면 실제 필요보다 과하게 잡게 됩니다.'
      : '진입선과 중앙값이 비슷해 상위권 분포가 고른 편입니다.'
}</p>` : ''}
${leaderBlock}
${changeBlock}
<h2>이 키워드는 지금 도전할 만한가</h2>
<p>${escapeHtml(tierAdvice)}</p>
<p class="meta">유형별 접근법은 <a href="/guide/${encodeURIComponent(tier.label === '고경쟁형' ? '플레이스진입선리뷰' : '플레이스상위노출')}">${tier.label === '고경쟁형' ? '1페이지 진입에 리뷰가 몇 개 필요할까' : '플레이스 상위노출 방법 총정리'}</a>에서 더 자세히 다룹니다.</p>
${weeklyBlock}
<a class="cta" href="/">내 매장은 이 기준 대비 어디인지 무료로 진단하기</a>
<p class="meta" style="text-align:center;margin-top:14px">기존 관측 데이터를 포함한 분석과 내 매장의 순위 상승에 필요한 상위노출 컨설팅은 <a href="/#contact">상담 신청</a>에서 받아보실 수 있습니다.</p>
<h2>자주 묻는 질문</h2>
${faqs.map(f => `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`).join('')}
<h2>이 페이지 숫자의 출처</h2>
<ul class="sources">
  <li>동네비즈가 '${escapeHtml(keyword)}'를 직접 조회해 수집한 관측 기록입니다. 누적 ${batches.length}회 관측, 최근 기준일 ${escapeHtml(fmtKST(latest).slice(0, 10))}.</li>
  <li>네이버 통합검색 플레이스 영역에서 광고를 제외한 순서를 기준으로, 1페이지 상위 ${top.length}곳의 공개 지표를 집계했습니다.</li>
  <li>진입선은 1페이지 마지막 자리 업체의 방문자 리뷰 수를 뜻합니다. 방문자 리뷰는 영수증·예약 리뷰를 합산한 값이라 앱 화면의 후기 글 개수와 다를 수 있습니다.</li>
  ${batches.length < 4 ? '<li>관측 회차가 아직 적어 순위 변동 경향은 결론을 낼 수 있는 단계가 아닙니다. 관측이 쌓이면 이 페이지도 함께 갱신됩니다.</li>' : ''}
  <li>네이버 공식 자료가 아닌 공개 정보 기반의 자체 분석이며, 순위는 검색자의 위치에 따라 다르게 표시될 수 있습니다.</li>
</ul>
${siblings.length ? `<h2>다른 키워드 순위 현황</h2>
<div class="kwlist">${siblings.map(k => `<a href="/rank/${encodeURIComponent(k)}">${escapeHtml(k)}</a>`).join('')}</div>` : ''}
<div class="navcards">
  <a href="/rank"><span class="t">전체 키워드 순위 현황<span class="arw">→</span></span><span class="d">관측 중인 키워드를 한눈에 봅니다</span></a>
  <a href="/guide"><span class="t">플레이스 상위노출 가이드<span class="arw">→</span></span><span class="d">순위를 올리는 기준과 방법</span></a>
</div>
<footer>본 페이지는 네이버 통합검색 결과에서 수집한 공개 정보를 집계한 것이며, 순위는 검색자의 위치에 따라 다르게 표시될 수 있습니다.<br>상호 : 인터피아드 · 사업자등록번호 : 124-35-56796 · 문의 : interpiad@gmail.com</footer>
</div></body></html>`;
}

app.get('/rank/:keyword', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);
  const keyword = decodeURIComponent(c.req.param('keyword'));

  const { results } = await db.prepare(`
    SELECT place_id, place_name, rank, visitor_reviews, blog_reviews, vote_count, photo_count, collected_at
    FROM rank_snapshots WHERE keyword = ? ORDER BY collected_at ASC
  `).bind(keyword).all();
  const rows = results as any[];

  const batches = new Set(rows.map(r => r.collected_at));
  const hasRanked = rows.some(r => r.rank);
  if (batches.size < 2 || !hasRanked) {
    return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="robots" content="noindex"><title>준비 중 | 동네비즈</title><style>${RANK_PAGE_STYLE}</style></head>
<body>${siteNav('place')}<div class="wrap">
<h1>아직 공개 기준을 채우지 못한 키워드입니다</h1>
<p class="meta">관측이 2회 이상 누적되면 공개됩니다.</p>
<a class="cta" href="/">내 매장 순위 무료로 진단하기</a></div></body></html>`, 404);
  }

  // 띄어쓰기 변형으로 들어와도 대표 표기 한 곳으로 canonical을 모아 중복 색인을 막는다.
  const reps = await eligibleRankKeywords(db);
  const repKeyword = reps.find(k => normKeyword(k) === normKeyword(keyword)) || keyword;
  return c.html(renderRankPageHtml(keyword, rows, repKeyword, relatedKeywords(keyword, reps)));
});

// ─────────────────────────────────────────────────────────────────────────────
// 가이드 문서 (검색·AI 인용 유입용). 본문은 src/guides.ts.
// 첫 문단이 질문에 바로 답하는 Answer-First 구조이고, 전 페이지가 허브와 서로 링크된다.
// ─────────────────────────────────────────────────────────────────────────────

const GUIDE_STYLE = `
${SITE_NAV_CSS}
  *{box-sizing:border-box} body{margin:0;padding:0;font-family:-apple-system,'Pretendard',sans-serif;color:#0F172A;background:#F8FAFC;line-height:1.75}
  .wrap{max-width:760px;margin:0 auto;padding:24px 16px 56px}
  .crumb{font-size:12px;color:#94A3B8;margin:18px 0 6px}
  .crumb a{color:#64748B;text-decoration:none}
  h1{font-size:24px;margin:0 0 8px;line-height:1.35;letter-spacing:-0.02em}
  .meta{font-size:12px;color:#94A3B8;margin-bottom:22px}
  .answer{background:#EFF6FF;border-left:4px solid #2563EB;border-radius:0 12px 12px 0;padding:16px 18px;font-size:15px;font-weight:600;color:#1E3A8A;margin-bottom:28px}
  h2{font-size:17px;margin:32px 0 10px;letter-spacing:-0.01em}
  p{margin:0 0 12px;font-size:15px;color:#334155}
  details{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;margin-bottom:8px}
  summary{font-weight:700;cursor:pointer;font-size:14px}
  details p{margin:10px 0 0;font-size:14px}
  .cta{display:block;margin:32px 0 0;background:#0F172A;color:#fff;text-align:center;padding:16px;border-radius:14px;font-weight:800;text-decoration:none}
  .more{margin-top:36px;border-top:1px solid #E2E8F0;padding-top:18px}
  .more h2{font-size:14px;margin:0 0 10px}
  .more a{display:block;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:12px 14px;margin-bottom:8px;text-decoration:none;color:#0F172A;font-weight:700;font-size:14px}
  .sources{background:#F1F5F9;border-radius:12px;padding:14px 14px 14px 30px;margin:0;font-size:13px;color:#475569}
  .sources li{margin-bottom:7px}
  .sources li:last-child{margin-bottom:0}
  footer{margin-top:32px;font-size:11px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:16px}
`;

app.get('/guide', (c) => {
  const items = GUIDES.map(g =>
    `<a href="/guide/${encodeURIComponent(g.slug)}">${escapeHtml(g.title)}<span style="display:block;font-weight:500;color:#64748B;font-size:12px;margin-top:3px">${escapeHtml(g.desc)}</span></a>`
  ).join('');
  return c.html(`<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>네이버 플레이스 상위노출 가이드 | 동네비즈</title>
<meta name="description" content="네이버 플레이스 순위 조회, 순위 하락 원인, 대표키워드 설정, 상위노출 방법을 실측 데이터를 근거로 정리한 가이드입니다.">
<link rel="canonical" href="https://dongbiz.com/guide">
<style>${GUIDE_STYLE}</style></head><body>${siteNav('place')}<div class="wrap">
<h1>네이버 플레이스 상위노출 가이드</h1>
<p class="meta">실제로 수집한 순위·지표 데이터를 근거로 씁니다.</p>
<div class="more" style="border:none;padding:0;margin-top:8px">${items}</div>
<a class="cta" href="/">내 매장 순위 무료로 진단하기</a>
<footer>상호 : 인터피아드 · 사업자등록번호 : 124-35-56796 · 문의 : interpiad@gmail.com</footer>
</div></body></html>`);
});

app.get('/guide/:slug', (c) => {
  const slug = decodeURIComponent(c.req.param('slug'));
  const g = GUIDE_BY_SLUG.get(slug);
  if (!g) return c.notFound();

  const canonical = `https://dongbiz.com/guide/${encodeURIComponent(g.slug)}`;
  const body = g.sections.map(s =>
    `<h2>${escapeHtml(s.h)}</h2>` +
    (s.img ? `<img src="${escapeHtml(s.img)}" alt="${escapeHtml(s.h)}" loading="lazy" decoding="async" style="max-width:100%;height:auto;margin:1.5rem 0;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);" />` : '') +
    s.p.map(t => `<p>${escapeHtml(t)}</p>`).join('')
  ).join('');
  const faqs = g.faqs.map(f =>
    `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`
  ).join('');
  const others = GUIDES.filter(x => x.slug !== g.slug).map(x =>
    `<a href="/guide/${encodeURIComponent(x.slug)}">${escapeHtml(x.title)}</a>`
  ).join('');

  const org = {
    '@type': 'Organization',
    name: '동네비즈',
    url: 'https://dongbiz.com/',
    logo: 'https://dongbiz.com/og-image.png',
  };
  const jsonLd = JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: g.title,
      description: g.desc,
      datePublished: g.updated,
      dateModified: g.updated,
      publisher: org,
      mainEntityOfPage: canonical,
    },
    { '@context': 'https://schema.org', ...org },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '홈', item: 'https://dongbiz.com/' },
        { '@type': 'ListItem', position: 2, name: '가이드', item: 'https://dongbiz.com/guide' },
        { '@type': 'ListItem', position: 3, name: g.title, item: canonical },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: g.faqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ]).replace(/</g, '\\u003c');

  return c.html(`<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(g.title)} | 동네비즈</title>
<meta name="description" content="${escapeHtml(g.desc)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(g.title)}">
<meta property="og:description" content="${escapeHtml(g.desc)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="https://dongbiz.com/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${jsonLd}</script>
<style>${GUIDE_STYLE}</style></head><body>${siteNav('place')}<div class="wrap">
<p class="crumb"><a href="/">홈</a> › <a href="/guide">가이드</a></p>
<h1>${escapeHtml(g.title)}</h1>
<p class="meta">최종 수정 ${escapeHtml(g.updated)}</p>
<p class="answer" id="aeo-direct-answer">${escapeHtml(g.answer)}</p>
${body}
${g.sources?.length ? `<h2>이 글에 쓰인 숫자의 출처</h2>
<ul class="sources">${g.sources.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
<h2>자주 묻는 질문</h2>
${faqs}
<a class="cta" href="/">내 매장은 지금 몇 위인지 무료로 진단하기</a>
<div class="more"><h2>함께 보면 좋은 글</h2>${others}
<a href="/rank">키워드별 네이버 플레이스 순위 현황</a></div>
<footer>본 문서는 네이버 공개 정보를 수집·집계한 자체 분석에 근거하며, 네이버 공식 자료가 아닙니다.<br>상호 : 인터피아드 · 사업자등록번호 : 124-35-56796 · 문의 : interpiad@gmail.com</footer>
</div></body></html>`);
});

app.get('/sitemap.xml', async (c) => {
  const db = c.env.DB;
  const keywords = db ? await eligibleRankKeywords(db) : [];
  const urls = [
    '  <url><loc>https://dongbiz.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>',
    '  <url><loc>https://dongbiz.com/guide</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>',
    ...GUIDES.map(g =>
      `  <url><loc>https://dongbiz.com/guide/${encodeURIComponent(g.slug)}</loc><lastmod>${g.updated}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`
    ),
    '  <url><loc>https://dongbiz.com/rank</loc><changefreq>daily</changefreq><priority>0.8</priority></url>',
    ...keywords.map(k =>
      `  <url><loc>https://dongbiz.com/rank/${encodeURIComponent(k)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`
    ),
  ].join('\n');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
});

const ADMIN_STYLE = `
  body { font-family: -apple-system, 'Pretendard', sans-serif; background: #F8FAFC; color: #0F172A; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  a { color: #2563EB; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  th, td { padding: 10px 12px; text-align: left; font-size: 13px; border-bottom: 1px solid #E2E8F0; }
  th { background: #F1F5F9; font-weight: 700; color: #475569; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .grade-A { background: #ECFDF5; color: #047857; }
  .grade-B { background: #FFFBEB; color: #B45309; }
  .grade-C { background: #FEF2F2; color: #B91C1C; }
  pre { background: #1E293B; color: #CBD5E1; padding: 16px; border-radius: 12px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
  .card { background: #fff; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .back { display: inline-block; margin-bottom: 16px; font-size: 13px; }
  .nav { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; background: #fff; border-radius: 12px; padding: 10px 12px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); font-size: 13px; }
  .nav a { font-weight: 700; padding: 5px 10px; border-radius: 8px; }
  .nav a:hover { background: #EFF6FF; text-decoration: none; }
  /* 메뉴 이름 옆 설명 아이콘. title 속성이라 마우스를 올리면 브라우저 기본 툴팁이 뜬다. */
  .nav .tip { margin-left: 3px; color: #94A3B8; font-weight: 400; cursor: help; }
  .nav a:hover .tip { color: #2563EB; }
  .nav .sep { color: #94A3B8; font-size: 11px; font-weight: 700; margin: 0 4px 0 10px; border-left: 1px solid #E2E8F0; padding-left: 12px; }
  .nav .sep.first { margin-left: 0; border-left: none; padding-left: 0; }
`;

// 관리자 페이지 공통 상단 메뉴. 페이지마다 흩어져 있던 이동 링크를 한 줄로 모은다.
// 메뉴 이름만으로는 뭘 하는지 알 수 없다는 지적(2026-09-09). 특히 수동 수집 버튼은
// 눌러야만 동작을 알 수 있어 위험하다 — 누르면 즉시 네이버를 긁는다.
// 이름 옆 ⓘ에 마우스를 올리면 목적·주기·비용이 뜬다.
const navItem = (href: string, label: string, tip: string, blank = false) =>
  `<a href="${href}"${blank ? ' target="_blank"' : ''}>${label}<span class="tip" title="${tip}">ⓘ</span></a>`;

const ADMIN_NAV = `<nav class="nav">
  <span class="sep first">진단</span>
  ${navItem('/admin', '진단 리스트', '사장님들이 실제로 돌린 진단 최신 100건. 원본 데이터 검증용.')}
  ${navItem('/admin?view=report', '개선리포트', '같은 목록을 "고객에게 보낼 리포트 찾기" 관점으로 본다. 매장명을 누르면 주석 달린 리포트가 열리고, 인쇄로 PDF 저장.')}
  <span class="sep">분석</span>
  ${navItem('/admin/analytics', '지표 분석', '키워드별 순위 시계열. 순위가 바뀐 시점에 어떤 지표가 함께 움직였는지 대조한다. 리버스엔지니어링의 핵심 화면.')}
  ${navItem('/admin/analytics/market', '시장 통계', '고정 리서치 키워드 8개의 상위권 평균/중앙값. "이 시장이 얼마나 경쟁적인가"를 본다. 의료 업종은 분리 표기.')}
  ${navItem('/admin/text-match', '키워드 매칭', '검색 키워드가 상위권 업체의 대표키워드·상세설명·메뉴명·투표키워드에 들어 있는지 대조한다. 단면 비교라 인과가 아니다 — 화면 안의 경고를 읽을 것.')}
  <span class="sep">공개</span>
  ${navItem('/rank', '순위 페이지', '고객에게 공개되는 키워드별 순위 문서. 검색 유입용.', true)}
  <span class="sep">수동 수집</span>
  ${navItem('/admin/cron/run/fixed-a', '고정A', '누르면 즉시 실행 · 고정 리서치 키워드 앞 4개(강남맛집·명동맛집·부산맛집·해운대맛집)를 개별 스크랩. 자동으로는 매일 13:00 KST. 같은 job을 연타하면 네이버 일시 제한에 걸린다.')}
  ${navItem('/admin/cron/run/fixed-b', '고정B', '누르면 즉시 실행 · 고정 리서치 키워드 뒤 4개(제주도맛집·강남미용실·홍대미용실·강남성형외과)를 개별 스크랩. 자동으로는 매일 21:00 KST. 앞뒤로 나눈 이유는 8개를 한 번에 돌리면 요청 한도를 넘기 때문.')}
  ${navItem('/admin/cron/run/user-driven', '사용자 키워드', '누르면 즉시 실행 · 사장님들이 검색했던 키워드를 최근순으로 최대 3개 재수집해 시계열을 잇는다. 자동으로는 매일 17:00 KST.')}
  ${navItem('/admin/cron/run/place-lists', '목록수집', '누르면 즉시 실행 · pcmap 목록에서 키워드당 최대 50곳을 정렬 3축(관련도·저장순·요즘뜨는)으로 수집 + 워치리스트 개별 추적. 저장수가 여기서만 나온다. 자동으로는 매일 15:00 KST. 약 75초 걸린다.')}
  ${navItem('/admin/cron/run/place-texts', '텍스트수집', '누르면 즉시 실행 · 키워드별 상위 10곳의 개별 페이지에서 대표키워드·상세설명·메뉴명·투표키워드를 받아온다. 목록수집에는 이 4개가 없다. 최근 30일 안에 받아둔 업체는 건너뛰므로 두 번째부터는 거의 즉시 끝난다. 자동으로는 매일 17:00 KST.')}
</nav>`;

// 관리자: 진단 리스트 (최신 100건). §6 Phase C 신규 요청 — 관리자 자신이 raw데이터를 검증할 수 있어야 함.
app.get("/api/test-graphql2", async (c) => {
  try {
    const res = await fetch("https://m.place.naver.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{"operationName":"getPlaceDetail","variables":{"id":"1994640103"},"query":"query getPlaceDetail($id:String!){placeDetail(input:{id:$id,isNx:false}){id}}" }])
    });
    return c.json({ status: res.status, body: await res.text() });
  } catch(e:any){ return c.json({error: e.message}); }
});

  app.get("/api/test-html", async (c) => {
  const res = await fetch("https://m.place.naver.com/place/1994640103/home", {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15" }
  });
  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if(!apolloMatch) return c.json({ error: "No apollo match", length: html.length });
  const state = JSON.parse(apolloMatch[1]);
  return c.json({
    baseKeyCount: Object.keys(state).filter(k => k.startsWith("PlaceDetailBase:")).length,
    rootQueryKeys: Object.keys(state.ROOT_QUERY || {})
  });
});

  app.get("/api/test-list", async (c) => {
  const keyword = encodeURIComponent("안산 삼계탕");
  const url = `https://pcmap.place.naver.com/restaurant/list?query=${keyword}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Referer": "https://map.naver.com/" }});
  const html = await res.text();
  const start = html.indexOf("window.__APOLLO_STATE__ = ");
  if (start < 0) return c.json({ error: "no apollo state" });
  const from = html.indexOf("{", start);
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === "{") depth++; else if (ch === "}") depth--;
    if (depth === 0) { end = i + 1; break; }
  }
  const state = JSON.parse(html.slice(from, end));
  const placeKey = Object.keys(state).find(k => k.startsWith("PlaceSearchItem:"));
  return c.json(state[placeKey]);
});

  app.get("/api/test-graphql", async (c) => {
  const placeId = c.req.query("id") || "1994640103";
  const query = `query getPlaceDetail($id: String!) { placeDetail(input: {id: $id, isNx: false, deviceType: "mobile", checkRedirect: true}) { id name businessType base { visitorReviewsTotal cafeBlogReviewsTotal saveCount bookmarkCount } reviewStats { visitorReviewsTotal blogReviewsTotal } } }`;
  
  try {
    const res = await fetch("https://m.place.naver.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Referer": `https://m.place.naver.com/place/${placeId}/home`,
        "Accept": "application/json"
      },
      body: JSON.stringify([{"operationName":"getPlaceDetail","variables":{"id":placeId},"query":query}])
    });
    
    const text = await res.text();
    return c.json({
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: text.substring(0, 500)
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

  app.get('/admin', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);

  const { results } = await db.prepare(`
    SELECT sh.share_id, sh.place_id, sh.target_keyword, sh.my_rank, sh.grade_reviews, sh.my_reviews,
           sh.top10_avg_reviews, sh.created_at, p.name, p.category, p.road_address
    FROM search_histories sh
    LEFT JOIN places p ON p.id = sh.place_id
    ORDER BY sh.created_at DESC
    LIMIT 100
  `).all();

  // ?view=report — 같은 목록을 "PDF로 저장할 리포트 찾기" 관점으로 보여준다. 별도 목록
  // 페이지를 새로 만들면 진단 리스트와 내용이 같은 화면이 둘로 갈라진다.
  const isReport = c.req.query('view') === 'report';

  const rows = (results as any[]).map(r => `
    <tr>
      <td>${escapeHtml(fmtKST(r.created_at))}</td>
      <td>${isReport
        ? `<a href="/admin/${escapeHtml(r.share_id)}/report" target="_blank"><b>${escapeHtml(r.name || r.place_id)}</b></a>`
        : `<b>${escapeHtml(r.name || r.place_id)}</b>`}<br><span style="color:#94A3B8">${escapeHtml(r.category || '')}</span></td>
      <td>${escapeHtml(r.target_keyword)}</td>
      <td>${r.my_rank ? r.my_rank + '위' : '미발견/미확인'}</td>
      <td><span class="badge grade-${escapeHtml(r.grade_reviews || 'B')}">${escapeHtml(r.grade_reviews || '-')}</span></td>
      <td>${r.my_reviews ?? '-'} / 평균 ${r.top10_avg_reviews ?? '-'}</td>
      <td><a href="/admin/${escapeHtml(r.share_id)}/report" target="_blank"><b>개선리포트</b></a> · <a href="/admin/${escapeHtml(r.share_id)}">원본데이터</a> · <a href="/share/${escapeHtml(r.share_id)}" target="_blank">공유링크</a></td>
    </tr>`).join('');

  const bypassUrl = c.env.RATE_LIMIT_BYPASS_TOKEN ? `/?bypass=${c.env.RATE_LIMIT_BYPASS_TOKEN}` : null;

  return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>동네비즈 관리자 - 진단 리스트</title><style>${ADMIN_STYLE}</style></head>
<body>
  ${ADMIN_NAV}
  ${bypassUrl ? `<div style="background:#0F172A;color:#fff;padding:10px 14px;border-radius:10px;margin-bottom:16px;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
    <span>🔓 일일 검색한도 우회 링크 (본인 테스트용, 외부 공유 금지)</span>
    <a href="${bypassUrl}" style="color:#93C5FD;font-weight:700;" target="_blank">${escapeHtml(bypassUrl)}</a>
  </div>` : ''}
  <h1>${isReport ? '개선리포트' : '진단 리스트'} (최신 ${(results as any[]).length}건)</h1>
  ${isReport ? '<p style="font-size:13px;color:#64748B;margin:8px 0 16px;">매장명을 누르면 주석이 달린 개선리포트가 열린다. 그 화면 우측 상단의 인쇄 버튼으로 PDF 저장 후 고객에게 전달한다.</p>' : ''}
  <table>
    <thead><tr><th>일시</th><th>매장</th><th>키워드</th><th>내 순위</th><th>등급</th><th>리뷰(내/평균)</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">아직 진단 기록이 없습니다.</td></tr>'}</tbody>
  </table>
</body></html>`);
});

// 관리자: 상위노출 지표 분석 — 키워드 목록. §질문2 리버스엔지니어링 대시보드 1단계(개요).
app.get('/admin/analytics', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);

  const { results } = await db.prepare(`
    SELECT keyword, COUNT(*) as snapshot_count, COUNT(DISTINCT place_id) as place_count,
           MIN(collected_at) as first_seen, MAX(collected_at) as last_seen,
           SUM(CASE WHEN source='cron' THEN 1 ELSE 0 END) as cron_count
    FROM rank_snapshots
    GROUP BY keyword
    ORDER BY last_seen DESC
  `).all();

  const rows = (results as any[]).map(r => `
    <tr>
      <td><b>${escapeHtml(r.keyword)}</b></td>
      <td>${r.snapshot_count}건 (업체 ${r.place_count}개)</td>
      <td>${escapeHtml(fmtKST(r.first_seen))} ~ ${escapeHtml(fmtKST(r.last_seen))}</td>
      <td>${r.cron_count > 0 ? `✅ ${r.cron_count}건` : '<span style="color:#94A3B8">아직 없음</span>'}</td>
      <td><a href="/admin/analytics/${encodeURIComponent(r.keyword)}">순위 추이 보기</a> <button onclick="if(confirm('이 키워드의 모든 관측 데이터를 삭제하시겠습니까?')) fetch('/admin/analytics/${encodeURIComponent(r.keyword)}', {method:'DELETE'}).then(()=>location.reload())" style="margin-left:8px;color:#EF4444;background:none;border:1px solid #EF4444;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;">삭제</button></td>
    </tr>`).join('');

  return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>동네비즈 관리자 - 지표 분석</title><style>${ADMIN_STYLE}</style></head>
<body>
  ${ADMIN_NAV}
  <h1>상위노출 지표 분석 — 키워드별 관측 현황</h1>
  <p style="font-size:13px;color:#64748B;margin:8px 0 16px;">업체별 순위 추이(순위가 바뀔 때 어떤 지표가 같이 움직였는지). 사용자가 직접 진단한 키워드는 한 번 검색하면 매일 자동 재수집되고(cron, 최대 ${CRON_KEYWORD_BATCH_LIMIT}개/일), 강남맛집 등 고정 리서치 키워드 8개도 매일 상위 7곳씩 여기 함께 쌓인다. 위 "시장 통계"는 같은 고정 키워드의 평균/중앙값 집계만 따로 본다.</p>
  <table>
    <thead><tr><th>키워드</th><th>스냅샷</th><th>관측 기간</th><th>자동수집</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">아직 수집된 데이터가 없습니다.</td></tr>'}</tbody>
  </table>
</body></html>`);
});

// 관리자: cron 작업 수동 트리거. 배포판엔 로컬 dev의 /__scheduled 같은 게 없어서,
// "다음 정기 실행까지 안 기다리고 지금 바로 씨앗 심고 싶다" 같은 경우에 쓴다.
// 고정 키워드는 원래 크론과 동일하게 앞/뒤 4개씩 나눠서 호출해야 한다 — 8개를 한 번에
// 부르면 이것도 똑같이 subrequest 한도(50)를 넘는다.
app.get('/admin/cron/run/:job', async (c) => {
  const job = c.req.param('job');
  if (job === 'fixed-a') {
    await runFixedKeywordCollection(c.env, FIXED_RESEARCH_KEYWORDS.slice(0, 4));
    return c.text(`완료: 고정 키워드 앞 4개(${FIXED_RESEARCH_KEYWORDS.slice(0, 4).map(k => k.keyword).join(', ')}) 수집됨.`);
  }
  if (job === 'fixed-b') {
    await runFixedKeywordCollection(c.env, FIXED_RESEARCH_KEYWORDS.slice(4));
    return c.text(`완료: 고정 키워드 뒤 4개(${FIXED_RESEARCH_KEYWORDS.slice(4).map(k => k.keyword).join(', ')}) 수집됨.`);
  }
  if (job === 'user-driven') {
    await runDailyKeywordCollection(c.env);
    return c.text('완료: 사용자 검색 키워드 자동 재수집 실행됨.');
  }
  if (job === 'healthcheck') {
    await runHealthcheck(c.env);
    return c.text('완료: 헬스체크 실행됨(실패 시에만 텔레그램 옴).');
  }
  if (job === 'place-lists') {
    // 키워드 1개만 돌리고 싶을 때: ?keyword=강남맛집 (429 실측 이후 테스트는 좁게 하는 게 안전하다)
    const only = c.req.query('keyword');
    const targets = only ? [only] : [...FIXED_RESEARCH_KEYWORDS.map(f => f.keyword), ...LIST_ONLY_KEYWORDS];
    // 키워드 1개면 결과를 바로 보여준다(검증용). 전체는 5초 스로틀 × 24회라 2분이 넘어
    // 브라우저가 먼저 끊고, 그러면 실행도 같이 죽는다 — 백그라운드로 돌리고 즉시 응답한다.
    if (only) return c.text((await collectPlaceLists(c.env, targets)).join(String.fromCharCode(10)));
    c.executionCtx.waitUntil((async () => {
      await collectPlaceLists(c.env, targets);
      await collectWatchlist(c.env);
    })());
    return c.text(`백그라운드 시작: ${targets.length}개 키워드 + 워치리스트 ${WATCH_PLACE_IDS.length}곳.
약 ${Math.round(targets.length * 3 * PCMAP_THROTTLE_MS / 1000)}초 뒤 지표 분석에서 확인. 실패 시 텔레그램으로 알림이 온다.`);
  }
  if (job === 'place-texts') {
    const only = c.req.query('keyword');
    const targets = only ? [only] : [...FIXED_RESEARCH_KEYWORDS.map(f => f.keyword), ...LIST_ONLY_KEYWORDS];
    if (only) return c.text((await collectPlaceTexts(c.env, targets)).join(String.fromCharCode(10)));
    c.executionCtx.waitUntil(collectPlaceTexts(c.env, targets));
    return c.text(`백그라운드 시작: ${targets.length}개 키워드 × 상위 ${PLACE_TEXTS_TOP_N}곳.
최근 ${PLACE_TEXTS_STALE_DAYS}일 안에 받아둔 업체는 건너뛰므로 두 번째 실행부터는 빨리 끝난다.
결과는 지표 분석 > 키워드 매칭에서 확인.`);
  }
  return c.text('알 수 없는 job. fixed-a | fixed-b | user-driven | healthcheck | place-lists | place-texts 중 하나.', 400);
});

/**
 * "관련도순으로 매겨진 순위 행"의 조건. 두 경로가 이 축에 해당한다:
 *   sort_mode='popular' — pcmap 목록 수집(§9.10)
 *   sort_mode IS NULL   — 통합검색 오가닉 순위(진단 /api/gap, 고정 키워드 배치)
 * 저장순·요즘뜨는·재방문(saved/trendy/revisit)은 **다른 축**이라 섞으면 안 된다 — 한 번
 * 섞어놨다가 그래프가 통째로 거짓말을 한 적이 있다(§9.10 sort_mode 회귀).
 * is_ad는 목록 경로에만 있어서 NULL(통합검색 경로)은 광고 아님으로 본다.
 */
const RELEVANCE_ROWS = `(rs.sort_mode = 'popular' OR rs.sort_mode IS NULL) AND (rs.is_ad = 0 OR rs.is_ad IS NULL)`;

// 관리자: 키워드 텍스트 매칭 분석 (§9.13) — "검색 키워드가 상위권 업체의 대표키워드/상세설명/
// 메뉴명/투표키워드에 들어 있나". 매칭은 저장하지 않고 여기서 매번 계산한다(규칙을 고치면
// 과거 데이터까지 새 규칙으로 다시 읽히게 하기 위해서다).
app.get('/admin/text-match', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);

  const { results } = await db.prepare(`
    SELECT rs.keyword, COUNT(DISTINCT rs.place_id) AS ranked,
           COUNT(DISTINCT pt.place_id) AS with_text
    FROM rank_snapshots rs
    LEFT JOIN place_texts pt ON pt.place_id = rs.place_id
    WHERE ${RELEVANCE_ROWS} AND rs.rank IS NOT NULL AND rs.rank <= 20 AND rs.keyword != '__watch__'
    GROUP BY rs.keyword
    ORDER BY with_text DESC, ranked DESC
  `).all();

  const rows = (results as any[]).map(r => `
    <tr>
      <td><b>${escapeHtml(r.keyword)}</b></td>
      <td>${r.ranked}곳</td>
      <td>${r.with_text > 0 ? `${r.with_text}곳` : '<span style="color:#94A3B8">없음</span>'}</td>
      <td>${r.with_text > 0 ? `<a href="/admin/text-match/${encodeURIComponent(r.keyword)}">매칭 분석 →</a>`
        : `<a href="/admin/cron/run/place-texts?keyword=${encodeURIComponent(r.keyword)}">텍스트 수집하기</a>`}</td>
    </tr>`).join('');

  return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>동네비즈 관리자 - 키워드 매칭</title><style>${ADMIN_STYLE}</style></head>
<body>
  ${ADMIN_NAV}
  <h1>키워드 매칭 분석</h1>
  <div class="card" style="font-size:13px;color:#475569;line-height:1.7">
    검색 키워드가 상위권 업체의 <b>대표키워드 · 상세설명 · 메뉴명 · 투표키워드</b>에 들어 있는지 본다.<br>
    텍스트는 개별 페이지를 긁어야 나오므로(목록 수집에는 없다) 키워드별로 <b>상위 ${PLACE_TEXTS_TOP_N}곳</b>만 받아둔다.
    진단(/api/gap)을 거친 업체는 자동으로 쌓인다.
  </div>
  <table>
    <thead><tr><th>키워드</th><th>상위 20위 내 업체</th><th>텍스트 확보</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">아직 순위 데이터가 없습니다.</td></tr>'}</tbody>
  </table>
</body></html>`);
});

app.get('/admin/text-match/:keyword', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);
  const keyword = decodeURIComponent(c.req.param('keyword'));

  const { results } = await db.prepare(`
    SELECT r.place_id, r.rank, pt.place_name, pt.category,
           pt.keyword_list, pt.description, pt.menu_names, pt.rep_keywords, pt.updated_at
    FROM (
      -- SQLite는 bare column을 max()가 고른 행에서 가져온다 — 업체별 **가장 최근 순위** 한 개.
      SELECT rs.place_id, rs.rank, MAX(rs.collected_at) AS last_seen
      FROM rank_snapshots rs
      WHERE rs.keyword = ? AND ${RELEVANCE_ROWS} AND rs.rank IS NOT NULL
      GROUP BY rs.place_id
    ) r
    JOIN place_texts pt ON pt.place_id = r.place_id
    ORDER BY r.rank
    LIMIT 30
  `).bind(keyword).all();

  const parts = keywordParts(keyword);
  const nk = normText(keyword);
  const parse = (s: any, fallback: any) => { try { return JSON.parse(s || ''); } catch { return fallback; } };

  const rows = (results as any[]).map(r => {
    const list: string[] = parse(r.keyword_list, []);
    const menus: string[] = parse(r.menu_names, []);
    const votes: Array<{ keyword: string; count: number }> = parse(r.rep_keywords, []);

    const rep = repKeywordLevel(keyword, list);
    const desc = matchLevel(keyword, r.description);
    // 상세설명은 "들어 있나"보다 "몇 번 넣었나"가 키워드 스터핑 여부까지 보여준다.
    const descHits = nk ? normText(r.description).split(nk).length - 1 : 0;
    const menuHit = menus.filter(m => matchLevel(keyword, m) === 2);
    const menuPart = menus.filter(m => matchLevel(keyword, m) === 1);
    const voteHit = votes.filter(v => matchLevel(keyword, v.keyword) >= 1);

    const badge = (lv: number, label: string) =>
      `<span class="badge ${lv >= 2 ? 'grade-A' : lv === 1 ? 'grade-B' : 'grade-C'}">${label}</span>`;

    return {
      rank: r.rank, repLevel: rep.level, descLevel: desc,
      html: `<tr>
        <td><b>${r.rank}위</b></td>
        <td><b>${escapeHtml(r.place_name || r.place_id)}</b><br><span style="color:#94A3B8">${escapeHtml(r.category || '')}</span></td>
        <td>${badge(rep.level, rep.level === 3 ? `정확 ${rep.at}번째` : rep.level === 2 ? `정확 ${rep.at}번째` : rep.level === 1 ? `부분 ${rep.at}번째` : '없음')}
            <div style="color:#64748B;font-size:11px;margin-top:4px">${escapeHtml(list.join(' · ') || '대표키워드 미등록')}</div></td>
        <td>${badge(desc, desc === 2 ? `정확 ${descHits}회` : desc === 1 ? '부분' : '없음')}
            <div style="color:#94A3B8;font-size:11px;margin-top:4px">${r.description ? `${normText(r.description).length}자` : '설명 없음'}</div></td>
        <td>${badge(menuHit.length ? 2 : menuPart.length ? 1 : 0, menuHit.length ? `정확 ${menuHit.length}개` : menuPart.length ? `부분 ${menuPart.length}개` : '없음')}
            <div style="color:#64748B;font-size:11px;margin-top:4px">${escapeHtml([...menuHit, ...menuPart].slice(0, 3).join(' · ') || `메뉴 ${menus.length}개`)}</div></td>
        <td>${badge(voteHit.length ? 2 : 0, voteHit.length ? `${voteHit.length}개` : '없음')}
            <div style="color:#64748B;font-size:11px;margin-top:4px">${escapeHtml(voteHit.slice(0, 3).map(v => `${v.keyword}(${v.count})`).join(' · ') || '-')}</div></td>
        <td style="color:#94A3B8;font-size:11px">${escapeHtml(fmtKST(r.updated_at))}</td>
      </tr>`
    };
  });

  // 등급별 평균 순위. 상관계수까지 가지 않는다 — n이 10 남짓이라 계수는 소수점 장난이 된다.
  const avgRank = (pick: (x: typeof rows[number]) => boolean) => {
    const hit = rows.filter(pick);
    return hit.length ? `${(hit.reduce((a, b) => a + b.rank, 0) / hit.length).toFixed(1)}위 (n=${hit.length})` : '-';
  };
  const summary = [
    ['대표키워드 정확일치 1~2번째', avgRank(r => r.repLevel === 3)],
    ['대표키워드 정확일치 3번째 이후', avgRank(r => r.repLevel === 2)],
    ['대표키워드 부분일치만', avgRank(r => r.repLevel === 1)],
    ['대표키워드 없음', avgRank(r => r.repLevel === 0)],
    ['상세설명 정확일치', avgRank(r => r.descLevel === 2)],
    ['상세설명 정확일치 아님', avgRank(r => r.descLevel < 2)],
  ].map(([label, v]) => `<tr><td>${label}</td><td><b>${v}</b></td></tr>`).join('');

  return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${escapeHtml(keyword)} 키워드 매칭</title><style>${ADMIN_STYLE}</style></head>
<body>
  ${ADMIN_NAV}
  <a class="back" href="/admin/text-match">← 키워드 목록</a>
  <h1>"${escapeHtml(keyword)}" 텍스트 매칭 (${rows.length}곳)</h1>
  <div class="card" style="font-size:13px;color:#475569;line-height:1.7">
    매칭 기준: 공백·대소문자를 지우고 비교한다 — "강남 맛집"과 "강남맛집"을 같게 본다.<br>
    <b>정확</b> = 키워드 전체가 들어 있음 · <b>부분</b> = 조각(${escapeHtml(parts.join(' / ') || keyword)})만 들어 있음.<br>
    <b>대표키워드</b>는 업체가 직접 입력한 값이라 조작할 수 있고, <b>투표키워드</b>는 네이버가 방문자 리뷰에서 뽑은 값이라 조작이 어렵다 — 같은 칸으로 읽지 말 것.
  </div>
  <div class="card">
    <b style="font-size:14px">항목별 평균 순위</b>
    <table style="box-shadow:none;margin-top:10px"><tbody>${summary}</tbody></table>
    <p style="font-size:12px;color:#B45309;margin:12px 0 0;line-height:1.7">
      ⚠️ 이건 단면 비교라 인과가 아니다. 상위권은 대부분 이미 키워드를 넣어두기 때문에 "없음" 칸의 n이
      0~2로 나오는 게 정상이고, 그럴 땐 아무 결론도 못 낸다. 또 대표키워드를 잘 넣는 업체는 마케팅에
      돈을 쓰는 업체라 리뷰·사진도 많다 — 그 효과와 구분되지 않는다.<br>
      인과를 보려면 워치리스트 매장 하나의 대표키워드를 바꾼 뒤 순위를 추적하는 수밖에 없다.
    </p>
  </div>
  <table>
    <thead><tr><th>순위</th><th>매장</th><th>대표키워드</th><th>상세설명</th><th>메뉴명</th><th>투표키워드</th><th>수집</th></tr></thead>
    <tbody>${rows.map(r => r.html).join('') || `<tr><td colspan="7">텍스트가 없습니다. <a href="/admin/cron/run/place-texts?keyword=${encodeURIComponent(keyword)}">지금 수집</a></td></tr>`}</tbody>
  </table>
</body></html>`);
});

// 관리자: 리서치 고정 키워드 시장 통계 — 업체 식별 없이 상위 10곳 평균/중앙값/비율만.
// medical(성형외과 등)은 의료광고법상 랭킹 로직이 다를 수 있어 표를 분리한다.
app.get('/admin/analytics/market', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);

  const { results } = await db.prepare(`
    SELECT k.* FROM keyword_rank_stats k
    INNER JOIN (SELECT keyword, MAX(collected_at) as max_c FROM keyword_rank_stats GROUP BY keyword) m
      ON k.keyword = m.keyword AND k.collected_at = m.max_c
    ORDER BY k.category, k.keyword
  `).all();

  const rowsFor = (rows: any[]) => rows.map(r => `
    <tr>
      <td><b>${escapeHtml(r.keyword)}</b></td>
      <td>${r.organic_count}곳</td>
      <td>${r.avg_visitor_reviews} / ${r.median_visitor_reviews}</td>
      <td>${r.avg_blog_reviews} / ${r.median_blog_reviews}</td>
      <td>${r.avg_vote_count}</td>
      <td>${r.avg_photo_count}</td>
      <td>${r.avg_review_score ?? '-'}</td>
      <td>${Math.round((r.booking_rate ?? 0) * 100)}%</td>
      <td>${Math.round((r.new_opening_rate ?? 0) * 100)}%</td>
      <td style="color:#94A3B8;font-size:11px;">${escapeHtml(fmtKST(r.collected_at))}</td>
    </tr>`).join('');

  const general = (results as any[]).filter(r => r.category !== 'medical');
  const medical = (results as any[]).filter(r => r.category === 'medical');
  const thead = `<thead><tr><th>키워드</th><th>오가닉수</th><th>방문자리뷰(평균/중앙)</th><th>블로그리뷰(평균/중앙)</th><th>투표수(평균)</th><th>사진수(평균)</th><th>평점(평균)</th><th>예약연동율</th><th>신규오픈율</th><th>최근수집</th></tr></thead>`;

  return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>동네비즈 관리자 - 리서치 시장 통계</title><style>${ADMIN_STYLE}</style></head>
<body>
  ${ADMIN_NAV}
  <h1>리서치 고정 키워드 — 시장 통계</h1>
  <p style="font-size:13px;color:#64748B;margin:-8px 0 16px;">경쟁이 치열해 순위 변동이 잦은 유명 키워드를 매일 고정 관측한다. 업체 식별 없이 상위 10곳의 평균/중앙값/비율만 남긴다.</p>

  <h2 style="font-size:15px;">일반 업종</h2>
  <table>${thead}<tbody>${rowsFor(general) || '<tr><td colspan="10">아직 수집된 데이터가 없습니다. cron이 하루 한 번 자동 수집합니다.</td></tr>'}</tbody></table>

  <h2 style="font-size:15px;margin-top:24px;">⚕️ 의료 업종 (분석 시 반드시 분리 — 의료광고법상 랭킹 로직이 다를 수 있음)</h2>
  <table>${thead}<tbody>${rowsFor(medical) || '<tr><td colspan="10">아직 수집된 데이터가 없습니다.</td></tr>'}</tbody></table>
</body></html>`);
});

// 관리자: 키워드 1개의 순위 추이 + 순위변동 이벤트(지표 델타). 리버스엔지니어링의 핵심 화면.
app.get('/admin/analytics/:keyword', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);

  const keyword = decodeURIComponent(c.req.param('keyword'));

  // ⚠️ §9.10 이후 한 키워드에 정렬 3축(popular/saved/trendy)이 함께 쌓인다. 섞어서 그리면
  // 저장순 순위와 관련도순 순위가 같은 선에 얹혀 완전히 잘못된 추이가 된다.
  // 반드시 축 하나만 골라서 본다. 구버전 행은 sort_mode가 NULL이고 관련도순에 해당한다.
  const sortMode = c.req.query('sort') || 'popular';
  const { results } = await db.prepare(`
    SELECT * FROM rank_snapshots
    WHERE keyword = ? AND (sort_mode = ? OR (sort_mode IS NULL AND ? = 'popular'))
    ORDER BY collected_at ASC
  `).bind(keyword, sortMode, sortMode).all();

  const snapshots = results as any[];
  if (snapshots.length === 0) {
    return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;"><a href="/admin/analytics">&larr; 목록으로</a><p>데이터가 없습니다.</p></body></html>`, 404);
  }

  // place_id별로 그룹화. 진단을 유발한 내 매장이 그 키워드 순위권 밖이면 rank가 NULL로
  // 기록되는데(logRankSnapshots), 그대로 두면 선은 안 그려지고 범례에만 남아 오해를 준다.
  // 한 번도 순위에 든 적 없는 업체는 차트에서 제외한다.
  const byPlace = new Map<string, any[]>();
  for (const s of snapshots) {
    if (!byPlace.has(s.place_id)) byPlace.set(s.place_id, []);
    byPlace.get(s.place_id)!.push(s);
  }
  for (const [id, rows] of byPlace) {
    if (!rows.some(r => Number(r.rank) > 0)) byPlace.delete(id);
  }

  // Chart.js용 순위 추이 데이터 (순위는 낮을수록 좋으므로 y축 반전)
  const placeNames = [...byPlace.keys()].map(id => byPlace.get(id)![0].place_name || id);
  const timestamps = [...new Set(snapshots.map(s => s.collected_at))].sort();

  // 차트 오른쪽 축에 "현재 그 순위에 있는 업체명"을 같은 높이로 붙인다. 범위는 전체 관측의
  // 순위 최소~최대로 잡아야 과거에만 하위권이던 업체의 선이 잘리지 않는다.
  const allRanks = snapshots.map(s => Number(s.rank)).filter(n => n > 0);
  const minRank = allRanks.length ? Math.min(...allRanks) : 1;
  const maxRank = allRanks.length ? Math.max(...allRanks) : 1;
  const lastTs = timestamps[timestamps.length - 1];
  const nameAtRank: Record<number, string> = {};
  for (const s of snapshots) {
    if (s.collected_at === lastTs && s.rank) nameAtRank[s.rank] = s.place_name || s.place_id;
  }
  // §9.10 이후 한 키워드에 업체가 50~95곳까지 잡힌다. 전부 그리면 선이 겹치고 범례가
  // 화면 절반을 먹어 아무것도 안 보인다(실제로 그렇게 나왔다). **상위권만 그린다.**
  // 하위권은 표에 그대로 남아 있으므로 정보가 사라지는 게 아니라 화면에서만 걷어내는 것이다.
  // 15 / 30 / 50 버튼으로 조절한다. 차트와 아래 표가 **같은 집합**을 쓴다 —
  // 차트엔 없는 업체가 표에만 있으면 두 화면을 대조할 수 없다.
  const CHART_TOP_N = Math.min(50, Math.max(5, Number(c.req.query('top')) || 15));
  // 순위가 늘수록 세로로 길어져야 한다. 50위를 90px에 그리면 선이 전부 겹친다.
  const chartHeight = Math.max(320, CHART_TOP_N * 15);
  const bestRankOf = (rows: any[]) => Math.min(...rows.map(r => Number(r.rank) || 999));
  const charted = [...byPlace.entries()]
    .filter(([, rows]) => bestRankOf(rows) <= CHART_TOP_N)
    .sort((a, b) => bestRankOf(a[1]) - bestRankOf(b[1]));

  const datasets = charted.map(([id, rows], i) => {
    const byTime = new Map(rows.map(r => [r.collected_at, r.rank]));
    const hue = (i * 67) % 360;
    return {
      label: rows[0].place_name || id,
      data: timestamps.map(t => byTime.get(t) ?? null),
      borderColor: `hsl(${hue}, 65%, 45%)`,
      backgroundColor: `hsl(${hue}, 65%, 45%)`,
      spanGaps: true,
      tension: 0.2,
    };
  });
  // y축도 그린 범위에 맞춘다. 50위까지 늘려놓으면 상위권 변동이 한 줄로 뭉개진다.
  const chartMaxRank = Math.min(maxRank, CHART_TOP_N + 2);

  // 지표 변화표: 순위가 바뀐 시점마다 **그 시점의 모든 업체**를 한 표에 늘어놓는다.
  // 한 업체만 떨어져도 원인은 그 업체가 아니라 "그 사이 다른 업체가 뭘 했는가"에 있는 경우가
  // 많아서, 변동한 업체만 보여주면 원인 추적이 불가능하다(2026-09-09 사용자 지적).
  const METRIC_COLUMNS: Array<[string, string]> = [
    ['visitor_reviews', '방문자리뷰'], ['blog_reviews', '블로그리뷰'], ['vote_count', '투표수'],
    ['photo_count', '사진수'], ['review_medias_total', '사진첨부리뷰'], ['coupon_count', '쿠폰수'],
  ];

  // 상호 검색량은 스냅샷마다 다시 재지 않으므로(§6.5.10) 업체별 최신 관측값을 쓴다.
  // "< 10"은 상한을 더한 근사치라 숫자로 찍으면 안 된다 — 그대로 "< 10"으로 표기한다.
  const nameVolumeByPlace = new Map<string, string>();
  for (const s of snapshots) {
    if (s.name_search_volume == null) continue;
    nameVolumeByPlace.set(s.place_id, s.name_volume_under_ten ? '&lt; 10' : Number(s.name_search_volume).toLocaleString());
  }

  const MAX_TRANSITIONS = 20; // 최신 20개 시점만 — 더 필요하면 SQL로 직접 볼 것
  // 현재값과 증감을 같이 찍는다 — `1504(+4)`. 증감만 보면 "4건 늘어난 게 큰 건가"를
  // 판단할 기준이 없다(1504 중 4건과 12 중 4건은 의미가 다르다).
  const deltaCell = (prev: any, cur: any, col: string) => {
    const now = cur[col];
    const nowTxt = now == null ? '<span style="color:#CBD5E1">–</span>' : Number(now).toLocaleString();
    if (!prev) return nowTxt;
    const d = (now ?? 0) - (prev[col] ?? 0);
    if (d === 0) return nowTxt;
    return `${nowTxt}<b style="color:${d > 0 ? '#059669' : '#DC2626'}">(${d > 0 ? '+' : ''}${d})</b>`;
  };

  const transitions: string[] = [];
  for (let ti = 1; ti < timestamps.length; ti++) {
    const prevTs = timestamps[ti - 1], curTs = timestamps[ti];
    const entries = charted
      .map(([id, rows]) => ({
        id,
        prev: rows.find(r => r.collected_at === prevTs),
        cur: rows.find(r => r.collected_at === curTs),
      }))
      .filter(e => e.cur);
    if (!entries.some(e => e.prev && e.prev.rank !== e.cur.rank)) continue; // 아무도 안 움직인 시점은 생략

    entries.sort((a, b) => (Number(a.cur.rank) || 999) - (Number(b.cur.rank) || 999));
    const rows = entries.map(({ id, prev, cur }) => {
      const moved = prev && prev.rank !== cur.rank;
      const arrow = !moved ? '' : (prev.rank ?? 999) > (cur.rank ?? 999) ? ' 📈' : ' 📉';
      const rankTxt = prev
        ? `${prev.rank ?? '밖'} → <b>${cur.rank ?? '밖'}</b>${arrow}`
        : `<b>${cur.rank ?? '밖'}</b> <span style="color:#94A3B8">(신규)</span>`;
      const vol = nameVolumeByPlace.get(id);
      return `<tr${moved ? ' style="background:#FEF9C3"' : ''}>
        <td>${escapeHtml(cur.place_name || id)}</td>
        <td>${rankTxt}</td>
        ${METRIC_COLUMNS.map(([col]) => `<td style="text-align:right">${deltaCell(prev, cur, col)}</td>`).join('')}
        <td style="text-align:right">${vol ?? '<span style="color:#CBD5E1">–</span>'}</td>
      </tr>`;
    }).join('');

    transitions.push(`
      <h3 style="font-size:13px;margin:20px 0 6px;color:#334155;">${escapeHtml(fmtKST(prevTs))} → <b>${escapeHtml(fmtKST(curTs))}</b></h3>
      <table>
        <thead><tr><th>업체</th><th>순위</th>${METRIC_COLUMNS.map(([, label]) => `<th style="text-align:right">${label}</th>`).join('')}<th style="text-align:right">월간 상호 검색량</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }
  transitions.reverse(); // 최신순
  const events = transitions.slice(0, MAX_TRANSITIONS);

  return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${escapeHtml(keyword)} - 순위 추이</title><style>${ADMIN_STYLE}</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head>
<body>
  ${ADMIN_NAV}
  <h1>'${escapeHtml(keyword)}' 순위 추이</h1>
  <p style="font-size:13px;color:#64748B;margin:-8px 0 6px;">스냅샷 ${snapshots.length}건 · 업체 ${byPlace.size}곳 · ${escapeHtml(fmtKST(timestamps[0]))} ~ ${escapeHtml(fmtKST(timestamps[timestamps.length - 1]))}</p>
  <p style="font-size:12px;color:#64748B;margin:0 0 14px;">
    정렬축:
    ${['popular', 'saved', 'trendy', 'revisit'].map(m => m === sortMode
      ? `<b style="color:#0F172A">${m}</b>`
      : `<a href="/admin/analytics/${encodeURIComponent(keyword)}?sort=${m}" style="color:#2563EB">${m}</a>`).join(' · ')}
    <span style="color:#94A3B8">— 축을 섞어서 보면 안 된다(§9.10).</span>
  </p>
  <p style="font-size:12px;color:#64748B;margin:0 0 14px;">
    표시 범위:
    ${[15, 30, 50].map(n => n === CHART_TOP_N
      ? `<b style="color:#0F172A">상위 ${n}위</b>`
      : `<a href="/admin/analytics/${encodeURIComponent(keyword)}?sort=${sortMode}&top=${n}" style="color:#2563EB">상위 ${n}위</a>`).join(' · ')}
    <span style="color:#94A3B8">— 차트와 아래 표에 함께 적용된다. 관측된 업체는 ${byPlace.size}곳.</span>
  </p>

  <div class="card">
    <div style="height:${chartHeight}px"><canvas id="rankChart"></canvas></div>
  </div>

  <h2 style="font-size:15px;">순위 변동 시점별 지표 변화 (전 업체)</h2>
  <p style="font-size:12px;color:#64748B;margin:-4px 0 0;">순위가 바뀐 시점마다 그때 관측된 <b>모든 업체</b>를 보여준다. 한 업체만 떨어졌어도 원인은 대개 다른 업체가 그 사이 뭘 했는지에 있다. 노란 줄 = 순위가 실제로 바뀐 업체. 지표 칸은 <b>현재값(증감)</b> 형태 — 괄호가 없으면 직전 관측 대비 변화 없음, <b>–</b>는 값 자체가 없음.</p>
  ${events.join('') || '<p style="font-size:13px;color:#94A3B8;">아직 순위 변동이 관측되지 않았습니다(스냅샷이 더 쌓이면 나타남).</p>'}

  <script>
    new Chart(document.getElementById('rankChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps.map(fmtKST))},
        datasets: ${JSON.stringify(datasets)}
      },
      options: {
        // 컨테이너 높이를 그대로 쓴다. 기본 비율 유지 모드면 세로를 아무리 키워도 안 늘어난다.
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { reverse: true, min: ${minRank}, max: ${chartMaxRank}, ticks: { stepSize: 1 } },
          yNames: {
            position: 'right', reverse: true, min: ${minRank}, max: ${chartMaxRank},
            grid: { drawOnChartArea: false },
            ticks: { stepSize: 1, autoSkip: false, font: { size: ${CHART_TOP_N > 30 ? 9 : 11} }, callback: v => (${JSON.stringify(nameAtRank)})[v] || '' }
          }
        },
        // 범례는 끈다. 오른쪽 축이 이미 "지금 그 순위에 있는 업체명"을 같은 높이에 보여주므로
        // 범례는 중복이고, 업체가 많아지면 화면 절반을 먹는다. 개별 확인은 툴팁으로 한다.
        plugins: { legend: { display: false }, tooltip: { mode: 'nearest', intersect: false } }
      }
    });
  </script>
</body></html>`);
});

app.delete('/admin/analytics/:keyword', async (c) => {
  const keyword = c.req.param('keyword');
  const db = c.env.DB;
  if (!db) return c.text('DB missing', 500);
  await db.prepare('DELETE FROM rank_snapshots WHERE keyword = ?').bind(keyword).run();
  return c.json({ success: true });
});

// 관리자: 진단 1건 상세 — 내 매장 + 경쟁사(top10) raw 데이터 전체를 검증용으로 노출.
app.get('/admin/:shareId', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);

  const shareId = c.req.param('shareId');
  const row = await db.prepare('SELECT raw_data, created_at FROM search_histories WHERE share_id = ?').bind(shareId).first();
  if (!row) return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;"><a href="/admin">&larr; 목록으로</a><p>해당 진단 기록을 찾을 수 없습니다.</p></body></html>`, 404);

  const data = JSON.parse(row.raw_data as string);
  const my = data.myStore;
  const competitors = data.top10Competitors || [];

  const competitorBlocks = competitors.map((comp: any, i: number) => `
    <div class="card">
      <h3 style="margin:0 0 8px;font-size:14px;">${i + 1}. ${escapeHtml(comp.name || comp.placeId)} <span style="font-weight:400;color:#94A3B8;font-size:12px;">${escapeHtml(comp.placeId)}</span></h3>
      <pre>${escapeHtml(JSON.stringify(comp, null, 2))}</pre>
    </div>`).join('');

  return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${escapeHtml(my.name)} - 진단 상세</title><style>${ADMIN_STYLE}</style></head>
<body>
  ${ADMIN_NAV}
  <div class="card">
    <h1 style="margin:0 0 8px;">${escapeHtml(my.name)} <span class="badge grade-${escapeHtml(data.grade || 'B')}">${escapeHtml(data.grade || '-')}</span></h1>
    <p style="font-size:13px;color:#475569;margin:4px 0;">키워드: <b>${escapeHtml(data.targetKeyword)}</b> · 순위: <b>${data.myRank ? data.myRank + '위 (수집 목록)' : '수집 ' + data.rankSearched + '곳 내 미발견/미확인'}</b> · 진단일시: ${escapeHtml(fmtKST(String(row.created_at || '')))}</p>
    <p style="font-size:13px;color:#475569;margin:4px 0;">연락처: <b>${escapeHtml(my.phone || '미등록')}</b> · 주소: ${escapeHtml(my.roadAddress || '미등록')}</p>
    <p style="font-size:13px;margin:8px 0 0;"><a href="/share/${escapeHtml(shareId)}" target="_blank">공유링크</a></p>
  </div>

  <h2 style="font-size:15px;">내 매장 원본 데이터 (Raw)</h2>
  <div class="card"><pre>${escapeHtml(JSON.stringify(my, null, 2))}</pre></div>

  <h2 style="font-size:15px;">경쟁사 원본 데이터 (Top ${competitors.length})</h2>
  ${competitorBlocks || '<div class="card">경쟁사 데이터가 없습니다.</div>'}

  <h2 style="font-size:15px;">지표별 통계 (avg/median/boundary)</h2>
  <div class="card"><pre>${escapeHtml(JSON.stringify(data.stats, null, 2))}</pre></div>
</body></html>`);
});

// 관리자 전용 맞춤개선 리포트. 요약 카드만 따로 만들지 않고, 고객이 실제로 보는 그 진단
// 페이지(index.html) 그대로에 항목별 주석만 덧붙여서 보여준다 — 판정 로직·수치는 전부
// 프론트 렌더링을 재사용(중복 구현 없음), report=true 플래그만 스크립트로 주입한다.
// PDF는 별도 라이브러리 없이 인쇄 친화 CSS로 처리 → 브라우저 "인쇄 → PDF로 저장".
app.get('/admin/:shareId/report', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);

  const shareId = c.req.param('shareId');
  const row = await db.prepare('SELECT raw_data FROM search_histories WHERE share_id = ?').bind(shareId).first();
  if (!row) return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;"><a href="/admin">&larr; 목록으로</a><p>해당 진단 기록을 찾을 수 없습니다.</p></body></html>`, 404);

  // 검색량은 관리자 리포트에서만 숫자로 노출한다 (§6.5.9). 고객 화면(/api/gap)은 이 값을
  // 아예 받지 않으므로 "월 10회 미만" 같은 숫자가 사장님 눈에 띌 일이 없다.
  // 조회 대상: 진단 키워드 + 상호명 + 대표키워드 5개 → 최대 7개(KV 캐시 후 API 호출 2회 이하).
  let volumes: Record<string, any> = {};
  let competitorNames: string[] = [];
  // 상호 변형 조회는 **그 매장 자신의 주소**로 지역 조합을 만들어야 한다. 내 매장 주소를
  // 전 업체에 돌려쓰면 서울 업체에 '안산○○' 같은 엉뚱한 변형이 붙는다(실제로 겪음).
  let competitorRegions: Record<string, string> = {};
  try {
    const data = JSON.parse(row.raw_data as string);
    // 경쟁사 상호 검색량까지 뽑는다 (§6.5.10) — 순위와 별개로 그 업체가 얼마나 직접 검색되는지.
    competitorNames = (data.top10Competitors || []).map((comp: any) => comp?.name).filter(Boolean);
    for (const comp of data.top10Competitors || []) {
      if (comp?.name) competitorRegions[comp.name] = comp.roadAddress || '';
    }
    if (data.myStore?.name) competitorRegions[data.myStore.name] = data.myStore.roadAddress || '';
    const targets = [
      data.targetKeyword,
      data.myStore?.name,
      ...(data.myStore?.keywordList || []).slice(0, 5),
      ...competitorNames,
    ];
    volumes = await getKeywordVolumes(c.env, targets.filter((t: unknown): t is string => typeof t === 'string' && !!t.trim()), { context: 'report', relatedTo: data.myStore?.name });
  } catch (err) {
    console.error('리포트 검색량 조회 실패:', err); // 검색량 없이도 리포트는 그대로 열린다
  }

  const assetRes = await c.env.ASSETS.fetch(new URL('/', c.req.url));
  const html = (await assetRes.text()).replace(
    '<head>',
    `<head>\n<script>window.__REPORT_SHARE_ID__ = ${JSON.stringify(shareId)};\nwindow.__REPORT_ADMIN__ = true;\nwindow.__REPORT_VOLUMES__ = ${JSON.stringify(volumes)};\nwindow.__REPORT_COMPETITOR_NAMES__ = ${JSON.stringify(competitorNames)};\nwindow.__REPORT_REGIONS__ = ${JSON.stringify(competitorRegions)};</script>`
  );
  return c.html(html);
});

// 매일 헬스체크 (§6 Phase B): 고정 매장 1건을 스크랩해 네이버 구조 변경/차단을 조기 감지.
// 성공 시 조용, 실패 시에만 텔레그램 알림 (평소엔 알림 없음이 정상).
async function runHealthcheck(env: Env) {
  try {
    await scrapeFullPlaceMetrics(HEALTHCHECK_PLACE_ID);
  } catch (err: any) {
    console.error('헬스체크 실패:', err);
    await notify(env, `🚨 [헬스체크 실패] 고정 매장(${HEALTHCHECK_PLACE_ID}) 스크랩 불가\n${err.message || err}\n네이버 페이지 구조 변경 또는 IP 차단 가능성 — 즉시 확인 요망`);
  }
}

// 자동 시계열 수집 (질문2·Phase D): 사용자가 검색해줘야만 스냅샷이 쌓이던 걸,
// 한 번이라도 검색된 키워드는 매일 자동으로 재수집하게 한다. 그래야 "순위가 바뀔 때
// 어떤 지표가 움직였는가"를 나중에 물어볼 수 있는 시계열이 저절로 쌓인다.
// ⚠️ 키워드 여러 개가 "같은 Worker 호출 안에서" 순차 누적된다는 걸 실측으로 확인했다
// (수동 트리거 중 "Too many subrequests" 실제로 발생 — 미용실 키워드처럼 오가닉 10곳이
// 꽉 찬 게 섞이면 4개만 돌려도 한도(50)를 넘음, D1 쓰기도 subrequest로 잡힌다). 키워드당
// 검색 1회 + 업체 최대 10회 + D1 기록 1회 = 최대 12로 보고, 넉넉하게 3개로 제한한다.
const CRON_KEYWORD_BATCH_LIMIT = 3;

// 리서치용 고정 키워드(사용자 지정) — 경쟁이 치열해 순위 변동이 잦은 유명 키워드를 매일
// 고정으로 관측한다. 특정 업체를 추적할 필요는 없다고 판단해 개별 지표 대신 상위 10곳의
// 평균/중앙값/비율만 keyword_rank_stats에 한 행으로 남긴다.
// medical은 의료광고법상 네이버 랭킹 로직이 다를 수 있어 일반 분석에서 반드시 분리할 것.
const FIXED_RESEARCH_KEYWORDS: Array<{ keyword: string; category: 'general' | 'medical' }> = [
  { keyword: '강남맛집', category: 'general' },
  { keyword: '명동맛집', category: 'general' },
  { keyword: '부산맛집', category: 'general' },
  { keyword: '해운대맛집', category: 'general' },
  { keyword: '제주도맛집', category: 'general' },
  { keyword: '강남미용실', category: 'general' },
  { keyword: '홍대미용실', category: 'general' },
  { keyword: '강남성형외과', category: 'medical' },
];

async function collectKeywordSnapshot(env: Env, keyword: string) {
  try {
    const ranking = await getOrganicRanking(keyword, 14);
    if (ranking.length === 0) return;
    const topIds = ranking.slice(0, 10);
    const stores = await Promise.all(topIds.map(id => scrapeFullPlaceMetrics(id)));
    stores.forEach((s: any) => {
      s.rankFactors = { ...keywordMatch(keyword, s.name, s.category), distanceFromMeKm: null };
    });
    const entries: SnapshotEntry[] = stores.map((s: any, i: number) => ({ id: s.placeId, name: s.name, rank: i + 1, s }));
    await insertRankSnapshotRows(env.DB, keyword, entries, 'cron');
  } catch (err) {
    console.error(`키워드 자동수집 실패("${keyword}"):`, err);
  }
}

// 리서치용 고정 키워드 수집: 상위권의 평균/중앙값/비율 집계 한 행 + 업체별 세부 스냅샷.
// 4개씩 한 Worker 호출에서 순차 처리하므로(§CRON_KEYWORD_BATCH_LIMIT 주석 참조) 10곳
// 전부 긁으면 한도를 넘길 수 있어 7곳으로 낮췄다 — 집계 통계 용도라 정밀도 손실은 적다.
async function collectKeywordAggregateStats(env: Env, keyword: string, category: 'general' | 'medical') {
  const db = env.DB;
  if (!db) return;
  try {
    const ranking = await getOrganicRanking(keyword, 14);
    if (ranking.length === 0) return;
    const topIds = ranking.slice(0, 7);
    const stores = await Promise.all(topIds.map(id => scrapeFullPlaceMetrics(id)));
    if (stores.length === 0) return;

    // 집계만으로는 "순위가 바뀔 때 뭐가 같이 바뀌었나"를 못 본다(§9.1 리버스엔지니어링 취지).
    // 어차피 위에서 다 긁어온 데이터라 batch 쓰기 1회(subrequest +1)만 추가하면 된다.
    stores.forEach((s: any) => {
      s.rankFactors = { ...keywordMatch(keyword, s.name, s.category), distanceFromMeKm: null };
    });
    await insertRankSnapshotRows(
      db,
      keyword,
      stores.map((s: any, i: number) => ({ id: s.placeId, name: s.name, rank: i + 1, s })),
      'cron'
    );

    const metricKeys: Array<[string, boolean]> = [
      ['visitorReviewsTotal', false], ['cafeBlogReviewsTotal', false],
      ['totalVoteCount', false], ['photoCount', false], ['visitorReviewsScore', true],
    ];
    const stats: Record<string, { avg: number; median: number }> = {};
    for (const [key, isScore] of metricKeys) stats[key] = calcStats(stores, key, isScore);

    const avgOf = (key: string) => {
      const vals = stores.map((s: any) => Number(s.seoMetrics[key]) || 0);
      return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
    };
    const rateOf = (key: string) => Math.round((stores.filter((s: any) => s.seoMetrics[key]).length / stores.length) * 100) / 100;

    await db.prepare(`
      INSERT INTO keyword_rank_stats (
        id, keyword, category, organic_count,
        avg_visitor_reviews, median_visitor_reviews, avg_blog_reviews, median_blog_reviews,
        avg_vote_count, median_vote_count, avg_photo_count, median_photo_count,
        avg_review_score, median_review_score, avg_review_medias_total, avg_coupon_count,
        booking_rate, smart_order_rate, review_penalty_rate, new_opening_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), keyword, category, stores.length,
      stats.visitorReviewsTotal.avg, stats.visitorReviewsTotal.median,
      stats.cafeBlogReviewsTotal.avg, stats.cafeBlogReviewsTotal.median,
      stats.totalVoteCount.avg, stats.totalVoteCount.median,
      stats.photoCount.avg, stats.photoCount.median,
      stats.visitorReviewsScore.avg, stats.visitorReviewsScore.median,
      avgOf('reviewMediasTotal'), avgOf('couponCount'),
      rateOf('hasNaverBooking'), rateOf('hasSmartOrder'), rateOf('hasReviewPenalty'), rateOf('isNewOpening')
    ).run();
  } catch (err) {
    console.error(`고정 키워드 통계 수집 실패("${keyword}"):`, err);
  }
}

async function runFixedKeywordCollection(env: Env, list: typeof FIXED_RESEARCH_KEYWORDS) {
  for (const { keyword, category } of list) {
    await collectKeywordAggregateStats(env, keyword, category);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// pcmap 목록 기반 "너비" 수집 (§9.10)
//
// 기존 수집은 키워드당 8회 요청(검색 1 + 개별 스크랩 7)으로 7곳을 얻었다. 이건 1회 요청으로
// 50곳을 얻는다. 표본이 7배가 되면서 요청은 1/8이 된다.
// ⚠️ 6회 연속 호출에 429를 실측했다. 반드시 간격을 두고 부른다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pcmap 목록만 돌리는 키워드 (§9.11). FIXED_RESEARCH_KEYWORDS에는 넣지 않는다 —
 * 거기 넣으면 fixed-a/fixed-b의 비싼 개별 스크랩 배치까지 늘어나 subrequest 한도를 넘긴다.
 * '봉명동 미용실': 시장이 작아 지표가 단순하고, revisit 정렬이 있어 재방문 가설 검증에 쓴다.
 */
const LIST_ONLY_KEYWORDS = ['봉명동 미용실'];

/**
 * 개별 추적 대상 (§9.11). "신규 오픈 부스트" 같은 자연실험은 **한 매장을 끝까지 따라가야**
 * 답이 나온다. 목록 수집에는 is_new_opening·투표수·사진수가 없어서 개별 스크랩이 따로 필요하다.
 * 부스트가 꺼지는 시점이 곧 지속기간의 답이므로, 플래그가 내려간 뒤에도 한동안 더 본다.
 */
const WATCH_PLACE_IDS: Array<{ placeId: string; note: string }> = [
  { placeId: '2019121430', note: '기운 (강남맛집 3위, 2026-09-09 신규오픈 플래그 확인)' },
];

const PCMAP_THROTTLE_MS = 5000; // 요청 간 최소 간격. 3초로는 4번째 요청부터 429가 났다(실측).
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 업종별로 지원하는 정렬 축이 다르다 — restaurant만 saved, hairshop은 revisit이 있다. */
const LIST_TARGETS: Record<string, { path: string; sorts: SortMode[] }> = {
  restaurant: { path: 'restaurant', sorts: ['popular', 'saved', 'trendy'] },
  hairshop: { path: 'hairshop', sorts: ['popular', 'revisit', 'trendy'] },
};

/** 키워드에서 pcmap 경로를 고른다. 모르면 restaurant로 두지 않고 건너뛴다(잘못된 경로는 302). */
function listTargetFor(keyword: string): { path: string; sorts: SortMode[] } | null {
  if (/맛집|밥집|식당|고기|횟집|카페/.test(keyword)) return LIST_TARGETS.restaurant;
  if (/미용실|헤어|살롱/.test(keyword)) return LIST_TARGETS.hairshop;
  return null;
}

async function collectPlaceLists(env: Env, keywords: string[]): Promise<string[]> {
  const db = env.DB;
  if (!db) return ['DB 미설정'];
  const report: string[] = [];

  const insert = (keyword: string, sort: SortMode, item: PlaceListItem) => db.prepare(`
    INSERT INTO rank_snapshots (
      id, keyword, place_id, place_name, rank, sort_mode,
      visitor_reviews, blog_reviews, total_review_count, image_count,
      save_count_raw, save_count_min, is_ad, has_booking, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cron')
  `).bind(
    crypto.randomUUID(), keyword, item.placeId, item.name, item.rank, sort,
    item.visitorReviewCount, item.blogCafeReviewCount, item.totalReviewCount, item.imageCount,
    item.saveCountRaw, item.saveCountMin, item.isAd ? 1 : 0, item.hasBooking ? 1 : 0,
  );

  for (const keyword of keywords) {
    const target = listTargetFor(keyword);
    if (!target) continue;

    // 정렬 3축을 모아 **키워드당 D1 쓰기 1회**로 끝낸다. 축마다 쓰면 subrequest가 2배가 된다.
    const stmts = [];
    const done: string[] = [];
    for (const sort of target.sorts) {
      try {
        await sleep(PCMAP_THROTTLE_MS);
        // 정렬 축마다 같은 매장이 다른 순위를 갖는다. 그 잔차가 지표별 기여도의 단서다(§9.10).
        const items = await getPlaceList(keyword, { category: target.path, sort });
        for (const item of items) stmts.push(insert(keyword, sort, item));
        done.push(`${sort} ${items.length}`);
      } catch (err: any) {
        // ⚠️ 실패를 여기서 삼키면 화면엔 "완료"가 뜨고 데이터만 빈다. 실제로 그렇게
        // 7개 키워드가 통째로 누락됐다(2026-09-09). 반드시 호출부까지 올려보낸다.
        console.error(`pcmap 목록 수집 실패("${keyword}" / ${sort}):`, err);
        done.push(`${sort} ❌ ${err?.message || err}`);
      }
    }
    if (stmts.length > 0) {
      await db.batch(stmts).catch(err => {
        console.error(`pcmap 기록 실패("${keyword}"):`, err);
        done.push(`DB 쓰기 실패 ${err?.message || err}`);
      });
    }
    report.push(`${keyword}: ${done.join(' / ')}`);
  }

  // 실패가 하나라도 있으면 알린다. 조용한 실패가 이 파이프라인의 가장 큰 위험이다.
  const failed = report.filter(line => line.includes('❌') || line.includes('실패'));
  if (failed.length > 0) {
    await notify(env, ['⚠️ [목록수집 일부 실패]', ...failed].join(String.fromCharCode(10)));
  }
  return report;
}

/**
 * 워치리스트 개별 추적 (§9.11). 목록 수집에 없는 필드(is_new_opening·투표수·사진수·설명분량)를
 * 매일 남긴다. rank는 목록 쪽 행이 이미 갖고 있으므로 여기선 NULL로 두고 지표만 기록한다.
 */
async function collectWatchlist(env: Env) {
  const db = env.DB;
  if (!db || WATCH_PLACE_IDS.length === 0) return;

  for (const { placeId, note } of WATCH_PLACE_IDS) {
    try {
      await sleep(PCMAP_THROTTLE_MS);
      const s = await scrapeFullPlaceMetrics(placeId);
      await db.prepare(`
        INSERT INTO rank_snapshots (
          id, keyword, place_id, place_name, rank, sort_mode,
          visitor_reviews, blog_reviews, vote_count, photo_count, review_score,
          review_medias_total, coupon_count, is_new_opening, is_good_store,
          has_review_penalty, description_length, source
        ) VALUES (?, ?, ?, ?, NULL, 'watch', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cron')
      `).bind(
        crypto.randomUUID(), `__watch__`, placeId, s.name,
        s.seoMetrics.visitorReviewsTotal ?? null, s.seoMetrics.cafeBlogReviewsTotal ?? null,
        s.seoMetrics.totalVoteCount ?? null, s.seoMetrics.photoCount ?? null,
        s.seoMetrics.visitorReviewsScore ?? null, s.seoMetrics.reviewMediasTotal ?? null,
        s.seoMetrics.couponCount ?? null,
        s.seoMetrics.isNewOpening ? 1 : 0, s.seoMetrics.isGoodStore ? 1 : 0,
        s.seoMetrics.hasReviewPenalty ? 1 : 0, s.seoMetrics.descriptionLength ?? null,
      ).run();
      await savePlaceTexts(db, s);
    } catch (err) {
      console.error(`워치리스트 수집 실패(${placeId} · ${note}):`, err);
    }
  }
}

/**
 * 상위권 업체 텍스트 수집 (§9.13). 목록 수집(pcmap)에는 대표키워드·상세설명·메뉴명이 아예
 * 없어서, 그 업체들의 개별 페이지를 따로 긁어야 한다.
 *
 * 50곳 전부는 못 한다 — 스로틀 5초 × 50 = 250초에 subrequest도 50 한도에 정면으로 걸린다.
 * 상위 N곳만 본다. 어차피 순위 회귀에서 의미 있는 구간은 상위권이다.
 *
 * 텍스트는 몇 달에 한 번 바뀌므로 STALE_DAYS 안에 받아둔 업체는 건너뛴다. 그래서 매일 돌려도
 * 정상 상태에서는 요청이 0이 되고, 순위권에 새 업체가 들어왔을 때만 움직인다.
 */
const PLACE_TEXTS_TOP_N = 10;
const PLACE_TEXTS_STALE_DAYS = 30;

async function collectPlaceTexts(env: Env, keywords: string[], topN = PLACE_TEXTS_TOP_N): Promise<string[]> {
  const db = env.DB;
  if (!db) return ['DB 미설정'];
  const report: string[] = [];

  for (const keyword of keywords) {
    // 가장 최근 수집분의 popular(관련도) 순위 상위 N곳. 정렬 축을 안 고르면 저장순·요즘뜨는
    // 행까지 섞여 같은 업체가 세 번 나온다(§9.10 sort_mode 회귀와 같은 함정).
    const { results } = await db.prepare(`
      SELECT rs.place_id, rs.rank, MAX(rs.collected_at) AS last_seen
      FROM rank_snapshots rs
      WHERE rs.keyword = ? AND ${RELEVANCE_ROWS} AND rs.rank IS NOT NULL
        AND rs.collected_at >= datetime('now', '-7 days')
      GROUP BY rs.place_id
      ORDER BY rs.rank
      LIMIT ?
    `).bind(keyword, topN).all();

    const targets = results as any[];
    if (targets.length === 0) { report.push(`${keyword}: 최근 7일 순위 데이터 없음 — 목록수집을 먼저 돌릴 것`); continue; }

    const fresh = new Set((((await db.prepare(
      `SELECT place_id FROM place_texts WHERE updated_at >= datetime('now', ?)`
    ).bind(`-${PLACE_TEXTS_STALE_DAYS} days`).all()).results) as any[]).map(r => r.place_id));

    let done = 0, skipped = 0, failed = 0;
    for (const t of targets) {
      if (fresh.has(t.place_id)) { skipped++; continue; }
      try {
        await sleep(PCMAP_THROTTLE_MS);
        await savePlaceTexts(db, await scrapeFullPlaceMetrics(t.place_id));
        done++;
      } catch (err: any) {
        console.error(`텍스트 수집 실패(${keyword} / ${t.place_id}):`, err);
        failed++;
      }
    }
    report.push(`${keyword}: 신규 ${done} / 최신이라 건너뜀 ${skipped}${failed ? ` / ❌ 실패 ${failed}` : ''}`);
  }

  const failedLines = report.filter(l => l.includes('❌'));
  if (failedLines.length > 0) await notify(env, ['⚠️ [텍스트수집 일부 실패]', ...failedLines].join(String.fromCharCode(10)));
  return report;
}

async function runDailyKeywordCollection(env: Env) {
  const db = env.DB;
  if (!db) return;
  try {
    const fixedSet = new Set(FIXED_RESEARCH_KEYWORDS.map(f => f.keyword));
    const { results } = await db.prepare(`
      SELECT keyword, MAX(collected_at) as last_seen
      FROM rank_snapshots
      GROUP BY keyword
      ORDER BY last_seen DESC
      LIMIT ?
    `).bind(CRON_KEYWORD_BATCH_LIMIT + FIXED_RESEARCH_KEYWORDS.length).all();
    const keywords = (results as any[]).map(r => r.keyword).filter(k => !fixedSet.has(k)).slice(0, CRON_KEYWORD_BATCH_LIMIT);
    for (const kw of keywords) {
      await collectKeywordSnapshot(env, kw);
    }
  } catch (err) {
    console.error('일일 키워드 자동수집 조회 실패:', err);
  }
}

// 고정 키워드 8개(키워드당 최대 11 subrequest)를 하루 한 번에 다 돌리면 88개로 Worker
// subrequest 한도(50)를 넘는다. 그래서 cron 트리거 3개로 나눠서 시간대별로 분산한다.
// 네이버 순위는 매일 10~12시(KST) 사이에 변동되므로 셋 다 그 이후로 잡는다 — 12시 전에
// 돌리면 어제 순위를 또 재는 꼴이 된다. wrangler.toml의 [triggers] crons와 반드시 맞출 것.
//   04:00 UTC(13:00 KST) — 헬스체크 + 고정 키워드 앞 4개
//   08:00 UTC(17:00 KST) — 사용자 검색 키워드 자동수집 (CRON_KEYWORD_BATCH_LIMIT개)
//   12:00 UTC(21:00 KST) — 고정 키워드 뒤 4개
const CRON_TIMES = {
  HEALTHCHECK_AND_FIXED_A: '0 4 * * *',
  PLACE_LISTS: '0 6 * * *', // 15:00 KST — pcmap 목록 수집(§9.10). 단독 슬롯이어야 한다.
  USER_DRIVEN: '0 8 * * *',
  FIXED_B: '0 12 * * *',
};

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    if (event.cron === CRON_TIMES.HEALTHCHECK_AND_FIXED_A) {
      ctx.waitUntil(runHealthcheck(env));
      ctx.waitUntil(runFixedKeywordCollection(env, FIXED_RESEARCH_KEYWORDS.slice(0, 4)));
    } else if (event.cron === CRON_TIMES.PLACE_LISTS) {
      // 다른 작업과 같은 슬롯에 넣지 않는다 — 스로틀 대기가 길고 subrequest도 따로 쓴다.
      ctx.waitUntil((async () => {
        await collectPlaceLists(env, [...FIXED_RESEARCH_KEYWORDS.map(f => f.keyword), ...LIST_ONLY_KEYWORDS]);
        await collectWatchlist(env);
      })());
    } else if (event.cron === CRON_TIMES.FIXED_B) {
      ctx.waitUntil(runFixedKeywordCollection(env, FIXED_RESEARCH_KEYWORDS.slice(4)));
      // 순위 하락은 3일에 걸쳐 쿠션을 주며 진행된다(§9.11.4). 하루 1점으로는 그 램프가
      // 3점으로 뭉개진다. 크론 트리거가 4개 상한이라 전용 슬롯을 못 만들므로,
      // 여유 있는 슬롯(15·17·21시)에 얹어 하루 3점을 만든다. 워치 1곳당 2 subrequest.
      ctx.waitUntil(collectWatchlist(env));
    } else {
      ctx.waitUntil(runDailyKeywordCollection(env));
      ctx.waitUntil(collectWatchlist(env));
      // 텍스트 수집(§9.13). 정상 상태에서는 요청이 0이다 — 최근 30일 안에 받아둔 업체를
      // 건너뛰므로, 순위권에 못 보던 업체가 들어왔을 때만 실제로 네이버를 부른다.
      ctx.waitUntil(collectPlaceTexts(env, FIXED_RESEARCH_KEYWORDS.map(f => f.keyword)));
    }
  },
};









