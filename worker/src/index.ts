import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { basicAuth } from 'hono/basic-auth';
import { scrapeFullPlaceMetrics, getOrganicRanking } from './scraper';
import { notify, logDiagnosisToSheet, NotifyEnv } from './notify';
import { GUIDES, GUIDE_BY_SLUG } from './guides';

export interface Env extends NotifyEnv {
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
  if (hit !== null) return hit as T;
  const fresh = await fetcher();
  await env.CACHE.put(versionedKey, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
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
async function checkDailyGapLimit(env: Env, ip: string): Promise<boolean> {
  if (!env.CACHE) return true; // 캐시 미바인딩 시 제한 없이 통과(§6 패턴과 일관: 기능은 항상 동작)
  const today = toKST().toISOString().slice(0, 10); // KST 자정(24:00) 기준 날짜 경계
  const key = `gaplimit:${today}:${ip}`;
  const count = Number(await env.CACHE.get(key)) || 0;
  if (count >= DAILY_GAP_LIMIT) return false;
  await env.CACHE.put(key, String(count + 1), { expirationTtl: 60 * 60 * 25 });
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

type SnapshotEntry = { id: string; name: string | null; rank: number | null; s: any };

// 순위 스냅샷 배치 기록. /api/gap(source='user')과 cron 자동수집(source='cron') 둘 다 이걸 쓴다.
async function insertRankSnapshotRows(
  db: D1Database | undefined,
  keyword: string,
  entries: SnapshotEntry[],
  source: 'user' | 'cron'
) {
  if (!db || entries.length === 0) return;
  try {
    const stmts = entries.map(({ id, name, rank, s }) => db.prepare(`
      INSERT INTO rank_snapshots (
        id, keyword, place_id, place_name, rank,
        visitor_reviews, blog_reviews, vote_count, photo_count, review_score,
        review_medias_total, coupon_count, has_booking, has_smart_order, has_review_penalty,
        is_new_opening, is_good_store, is_open_now, is_biz_hour_missing, description_length,
        name_contains_keyword, category_matches_keyword, distance_from_me_km, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), keyword, id, name, rank,
      s.seoMetrics.visitorReviewsTotal ?? null, s.seoMetrics.cafeBlogReviewsTotal ?? null,
      s.seoMetrics.totalVoteCount ?? null, s.seoMetrics.photoCount ?? null, s.seoMetrics.visitorReviewsScore ?? null,
      s.seoMetrics.reviewMediasTotal ?? null, s.seoMetrics.couponCount ?? null,
      s.seoMetrics.hasNaverBooking ? 1 : 0, s.seoMetrics.hasSmartOrder ? 1 : 0, s.seoMetrics.hasReviewPenalty ? 1 : 0,
      s.seoMetrics.isNewOpening ? 1 : 0, s.seoMetrics.isGoodStore ? 1 : 0, s.seoMetrics.isOpenNow ? 1 : 0,
      s.seoMetrics.isBizHourMissing ? 1 : 0, s.seoMetrics.descriptionLength ?? null,
      s.rankFactors?.nameContainsKeyword ? 1 : 0, s.rankFactors?.categoryMatchesKeyword ? 1 : 0,
      s.rankFactors?.distanceFromMeKm ?? null, source
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
  source: 'user' | 'cron' = 'user'
) {
  const entries: SnapshotEntry[] = [
    { id: myStore.placeId, name: myStore.name, rank: myRank, s: myStore },
    ...competitors.map((c: any) => {
      const idx = ranking.indexOf(c.placeId);
      return { id: c.placeId, name: c.name, rank: idx >= 0 ? idx + 1 : null, s: c };
    }),
  ];
  await insertRankSnapshotRows(db, keyword, entries, source);
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
  const query = c.req.query('query');
  if (!query) {
    return c.json({ error: '전화번호나 상호를 입력해주세요.' }, 400);
  }

  try {
    const myStore = await cached(c.env, `place:${query}`, PLACE_TTL, () => scrapeFullPlaceMetrics(query, true));
    await upsertPlace(c.env.DB, myStore);

    return c.json({ success: true, myStore });
  } catch (err: any) {
    console.error('진단 처리 중 오류:', err);
    c.executionCtx.waitUntil(notify(c.env, `⚠️ [진단 실패] query="${query}"\n${err.message || err}`));
    return c.json({ error: err.message || '매장 정보를 찾을 수 없습니다.' }, 500);
  }
});

// [2·3단계] 키워드 기반 Gap 분석 — 사용자가 직접 입력한 키워드로 상위 14위 수집.
// competitorId가 있으면(키워드 대신/추가로) 순위 자동수집을 건너뛰고 그 업체 1곳과 바로 비교한다
// (경쟁사 직접 지목, §2 3단계 확정). 만능 리졸버(scrapeFullPlaceMetrics)를 그대로 재사용하므로
// 상호명/전화번호/naver.me 링크 뭘 넣어도 동작한다.
app.get('/api/gap', async (c) => {
  const placeId = c.req.query('placeId');
  const keyword = c.req.query('keyword');
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
    const myStore = await cached(c.env, `place:${placeId}`, PLACE_TTL, () => scrapeFullPlaceMetrics(placeId, true));

    let ranking: string[];
    let myRank: number | null;
    let competitors: any[];
    let boundaryStore: any;
    let displayLabel: string; // targetKeyword 자리에 들어가는 표시용 문자열 (raw_data·화면 제목 등에 재사용)

    if (competitorQuery) {
      // 경쟁사 직접 지목 모드: 순위 자동수집 없이 지목한 업체 1곳만 비교
      const competitor = await cached(c.env, `place:${competitorQuery}`, PLACE_TTL, () => scrapeFullPlaceMetrics(competitorQuery));
      if (competitor.placeId === placeId) {
        return c.json({ error: '내 매장과 같은 곳입니다. 다른 업체를 입력해주세요.' }, 400);
      }
      ranking = [placeId, competitor.placeId];
      myRank = null; // 자동순위 개념이 없는 모드
      competitors = [competitor];
      boundaryStore = competitor; // "진입선" = 지목한 그 업체의 실측값
      displayLabel = `'${competitor.name}'와 직접 비교`;
    } else {
      // 오가닉 1~14위 (키워드 단위 캐시)
      ranking = await cached(c.env, `rank:${keyword}`, KEYWORD_TTL, () => getOrganicRanking(keyword!, 14));
      if (!ranking || ranking.length === 0) {
        return c.json({ error: `"${keyword}" 키워드의 검색 결과를 찾을 수 없습니다.` }, 404);
      }

      const myRankIndex = ranking.indexOf(placeId);
      myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;

      const top10Ids = ranking.slice(0, TOP_N).filter(id => id !== placeId);
      if (top10Ids.length === 0) {
        return c.json({ error: '비교할 경쟁사가 없습니다.' }, 404);
      }
      competitors = await Promise.all(
        top10Ids.map(id => cached(c.env, `place:${id}`, PLACE_TTL, () => scrapeFullPlaceMetrics(id)))
      );

      // TOP_N위 업체 = 1페이지 진입선. 본인이 TOP_N위면 그다음 순위를 진입선으로 사용.
      const boundaryId = ranking[TOP_N - 1] && ranking[TOP_N - 1] !== placeId ? ranking[TOP_N - 1] : ranking[TOP_N];
      boundaryStore = boundaryId
        ? (competitors.find(s => s.placeId === boundaryId)
          || await cached(c.env, `place:${boundaryId}`, PLACE_TTL, () => scrapeFullPlaceMetrics(boundaryId)))
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

    const responsePayload = {
      success: true,
      shareId,
      targetKeyword: displayLabel,
      isDirectCompare: !!competitorQuery, // 경쟁사 직접 지목 모드 여부 — 프론트가 "상위 N개" 문구 대신 1:1 비교 문구를 쓰도록 분기
      myStore,
      myRank,
      rankSearched: competitorQuery ? 1 : ranking.length,
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
      }
    }

    // 신규 진단 완료 알림 + 콜드콜 리스트 적재 (§8.2-A). 응답 지연 없이 백그라운드 처리.
    const bgTasks: Promise<any>[] = [
      notify(c.env, `📊 [신규 진단] ${myStore.name} (${myStore.placeId})\n${competitorQuery ? '비교 대상' : '키워드'}: ${displayLabel}\n${competitorQuery ? '1:1 직접비교' : (myRank ? `순위: ${myRank}위` : `순위: ${ranking.length}위 밖`)} / 등급: ${grade}\n연락처: ${myStore.phone || '미등록'}`),
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
      bgTasks.push(logRankSnapshots(c.env.DB, displayLabel, ranking, myStore, myRank, competitors, 'user'));
    }
    c.executionCtx.waitUntil(Promise.all(bgTasks));

    return c.json(responsePayload);
  } catch (err: any) {
    console.error('Gap 분석 중 오류:', err);
    c.executionCtx.waitUntil(notify(c.env, `⚠️ [Gap 분석 실패] placeId="${placeId}" keyword="${keyword || competitorQuery}"\n${err.message || err}\n(네이버 구조 변경 또는 차단 가능성 — §7 확인 요망)`));
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
  *{box-sizing:border-box} body{margin:0;padding:0;font-family:-apple-system,'Pretendard',sans-serif;color:#0F172A;background:#F8FAFC;line-height:1.6}
  .wrap{max-width:760px;margin:0 auto;padding:24px 16px 56px}
  header a{font-weight:800;color:#2563EB;text-decoration:none;font-size:15px}
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
<style>${RANK_PAGE_STYLE}</style></head><body><div class="wrap">
<header><a href="/">동네비즈</a></header>
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
<div class="kwlist">${siblings.map(k => `<a href="/rank/${encodeURIComponent(k)}">${escapeHtml(k)}</a>`).join('')}</div>
<p class="meta" style="margin-top:12px"><a href="/rank">전체 키워드 목록 보기</a> · <a href="/guide">플레이스 상위노출 가이드</a></p>` : ''}
<footer>본 페이지는 네이버 통합검색 결과에서 수집한 공개 정보를 집계한 것이며, 순위는 검색자의 위치에 따라 다르게 표시될 수 있습니다.<br>상호 : 인터피아드 · 사업자등록번호 : 124-35-56796 · 문의 : interpiad@gmail.com</footer>
</div></body></html>`;
}

// ⚠️ 임시 확인용 라우트. 주차별 표는 관측 3주가 쌓여야 켜지므로 실제 데이터로는 아직 볼 수
// 없다. '상록구 삼계탕'의 최신 관측을 4주치로 복제해 화면만 미리 확인한다.
// DB에는 아무것도 쓰지 않는다 — 가짜 관측을 실제 데이터에 섞으면 통계가 오염된다.
// 확인이 끝나면 이 라우트를 통째로 지울 것.
app.get('/rank/__preview', async (c) => {
  const db = c.env.DB;
  if (!db) return c.text('DB 미설정', 500);
  const keyword = '상록구 삼계탕';
  const { results } = await db.prepare(`
    SELECT place_id, place_name, rank, visitor_reviews, blog_reviews, vote_count, photo_count, collected_at
    FROM rank_snapshots WHERE keyword = ? ORDER BY collected_at DESC
  `).bind(keyword).all();
  const src = dedupeByPlace((results as any[]).filter(r => r.rank));
  if (src.length === 0) return c.text('원본 데이터 없음', 404);

  const rows: any[] = [];
  for (let w = 3; w >= 0; w--) {
    const at = new Date(Date.now() - w * 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    for (const r of src) rows.push({ ...r, collected_at: at });
  }
  const html = renderRankPageHtml(keyword + ' (미리보기)', rows, keyword, [])
    .replace('<head>', '<head><meta name="robots" content="noindex">');
  return c.html(html);
});

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
<body><div class="wrap"><header><a href="/">동네비즈</a></header>
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
  *{box-sizing:border-box} body{margin:0;padding:0;font-family:-apple-system,'Pretendard',sans-serif;color:#0F172A;background:#F8FAFC;line-height:1.75}
  .wrap{max-width:760px;margin:0 auto;padding:24px 16px 56px}
  header a{font-weight:800;color:#2563EB;text-decoration:none;font-size:15px}
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
<style>${GUIDE_STYLE}</style></head><body><div class="wrap">
<header><a href="/">동네비즈</a></header>
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
<style>${GUIDE_STYLE}</style></head><body><div class="wrap">
<header><a href="/">동네비즈</a></header>
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
  .nav .sep { color: #94A3B8; font-size: 11px; font-weight: 700; margin: 0 4px 0 10px; border-left: 1px solid #E2E8F0; padding-left: 12px; }
  .nav .sep.first { margin-left: 0; border-left: none; padding-left: 0; }
`;

// 관리자 페이지 공통 상단 메뉴. 페이지마다 흩어져 있던 이동 링크를 한 줄로 모은다.
const ADMIN_NAV = `<nav class="nav">
  <span class="sep first">진단</span>
  <a href="/admin">진단 리스트</a>
  <a href="/admin?view=report">개선리포트</a>
  <span class="sep">분석</span>
  <a href="/admin/analytics">지표 분석</a>
  <a href="/admin/analytics/market">시장 통계</a>
  <span class="sep">공개</span>
  <a href="/rank" target="_blank">순위 페이지</a>
  <span class="sep">수동 수집</span>
  <a href="/admin/cron/run/fixed-a">고정A</a>
  <a href="/admin/cron/run/fixed-b">고정B</a>
  <a href="/admin/cron/run/user-driven">사용자 키워드</a>
</nav>`;

// 관리자: 진단 리스트 (최신 100건). §6 Phase C 신규 요청 — 관리자 자신이 raw데이터를 검증할 수 있어야 함.
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
      <td>${r.my_rank ? r.my_rank + '위' : '순위밖'}</td>
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
      <td><a href="/admin/analytics/${encodeURIComponent(r.keyword)}">순위 추이 보기 →</a></td>
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
  return c.text('알 수 없는 job. fixed-a | fixed-b | user-driven | healthcheck 중 하나.', 400);
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
  const { results } = await db.prepare(`
    SELECT * FROM rank_snapshots WHERE keyword = ? ORDER BY collected_at ASC
  `).bind(keyword).all();

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
  const datasets = [...byPlace.entries()].map(([id, rows], i) => {
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

  // 순위변동 이벤트: 같은 업체의 연속된 두 스냅샷 사이 순위가 바뀐 구간마다, 그 사이 지표 델타를 함께 표시.
  const METRIC_LABELS: Record<string, string> = {
    visitor_reviews: '방문자리뷰', blog_reviews: '블로그리뷰', vote_count: '투표수',
    photo_count: '사진수', review_medias_total: '사진첨부리뷰', coupon_count: '쿠폰수',
  };
  const events: string[] = [];
  for (const [id, rows] of byPlace) {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1], cur = rows[i];
      if (prev.rank === cur.rank) continue;
      const deltas = Object.entries(METRIC_LABELS)
        .map(([col, label]) => {
          const d = (cur[col] ?? 0) - (prev[col] ?? 0);
          return d !== 0 ? `${label} ${d > 0 ? '+' : ''}${d}` : null;
        })
        .filter(Boolean)
        .join(', ');
      const rankTxt = `${prev.rank ?? '순위밖'} → ${cur.rank ?? '순위밖'}`;
      const arrow = (prev.rank ?? 999) > (cur.rank ?? 999) ? '📈' : '📉';
      events.push(`
        <tr>
          <td>${escapeHtml(fmtKST(cur.collected_at))}</td>
          <td><b>${escapeHtml(cur.place_name || id)}</b></td>
          <td>${arrow} ${rankTxt}</td>
          <td>${deltas ? escapeHtml(deltas) : '<span style="color:#94A3B8">변동 없음(외부 요인 추정)</span>'}</td>
        </tr>`);
    }
  }
  events.reverse(); // 최신순

  return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${escapeHtml(keyword)} - 순위 추이</title><style>${ADMIN_STYLE}</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head>
<body>
  ${ADMIN_NAV}
  <h1>'${escapeHtml(keyword)}' 순위 추이</h1>
  <p style="font-size:13px;color:#64748B;margin:-8px 0 16px;">스냅샷 ${snapshots.length}건 · 업체 ${byPlace.size}곳 · ${escapeHtml(fmtKST(timestamps[0]))} ~ ${escapeHtml(fmtKST(timestamps[timestamps.length - 1]))}</p>

  <div class="card">
    <canvas id="rankChart" height="90"></canvas>
  </div>

  <h2 style="font-size:15px;">순위 변동 이벤트 (그 사이 지표가 얼마나 움직였는지)</h2>
  <table>
    <thead><tr><th>일시</th><th>업체</th><th>순위 변동</th><th>지표 변화</th></tr></thead>
    <tbody>${events.join('') || '<tr><td colspan="4">아직 순위 변동이 관측되지 않았습니다(스냅샷이 더 쌓이면 나타남).</td></tr>'}</tbody>
  </table>

  <script>
    new Chart(document.getElementById('rankChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps.map(fmtKST))},
        datasets: ${JSON.stringify(datasets)}
      },
      options: {
        scales: {
          y: { reverse: true, min: ${minRank}, max: ${maxRank}, ticks: { stepSize: 1 } },
          yNames: {
            position: 'right', reverse: true, min: ${minRank}, max: ${maxRank},
            grid: { drawOnChartArea: false },
            ticks: { stepSize: 1, autoSkip: false, callback: v => (${JSON.stringify(nameAtRank)})[v] || '' }
          }
        },
        plugins: { legend: { position: 'bottom' } }
      }
    });
  </script>
</body></html>`);
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
    <p style="font-size:13px;color:#475569;margin:4px 0;">키워드: <b>${escapeHtml(data.targetKeyword)}</b> · 순위: <b>${data.myRank ? data.myRank + '위' : '순위밖(' + data.rankSearched + '위 밖)'}</b> · 진단일시: ${escapeHtml(fmtKST(String(row.created_at || '')))}</p>
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
  const exists = await db.prepare('SELECT 1 FROM search_histories WHERE share_id = ?').bind(shareId).first();
  if (!exists) return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;"><a href="/admin">&larr; 목록으로</a><p>해당 진단 기록을 찾을 수 없습니다.</p></body></html>`, 404);

  const assetRes = await c.env.ASSETS.fetch(new URL('/', c.req.url));
  const html = (await assetRes.text()).replace(
    '<head>',
    `<head>\n<script>window.__REPORT_SHARE_ID__ = ${JSON.stringify(shareId)};</script>`
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
  USER_DRIVEN: '0 8 * * *',
  FIXED_B: '0 12 * * *',
};

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    if (event.cron === CRON_TIMES.HEALTHCHECK_AND_FIXED_A) {
      ctx.waitUntil(runHealthcheck(env));
      ctx.waitUntil(runFixedKeywordCollection(env, FIXED_RESEARCH_KEYWORDS.slice(0, 4)));
    } else if (event.cron === CRON_TIMES.FIXED_B) {
      ctx.waitUntil(runFixedKeywordCollection(env, FIXED_RESEARCH_KEYWORDS.slice(4)));
    } else {
      ctx.waitUntil(runDailyKeywordCollection(env));
    }
  },
};
