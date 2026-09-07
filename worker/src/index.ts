import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { scrapeFullPlaceMetrics, getOrganicRanking } from './scraper';
import { notify, logDiagnosisToSheet, NotifyEnv } from './notify';

export interface Env extends NotifyEnv {
  DB: D1Database;
  CACHE?: KVNamespace; // 미바인딩 시 캐시 없이 동작 (§6 Phase A)
}

// 매일 헬스체크에 쓰는 고정 매장 (§6 Phase B). wrangler dev 테스트로 실제 동작 확인된 매장.
const HEALTHCHECK_PLACE_ID = '1785101394';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

function generateShareId() {
  return Math.random().toString(36).substring(2, 10);
}

// KV 캐시 래퍼. CACHE 바인딩이 없으면 매번 새로 조회한다 (기능은 동작, 속도/원가만 손해).
async function cached<T>(env: Env, key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
  if (!env.CACHE) return fetcher();
  const hit = await env.CACHE.get(key, 'json');
  if (hit !== null) return hit as T;
  const fresh = await fetcher();
  await env.CACHE.put(key, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
  return fresh;
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
    const myStore = await cached(c.env, `place:${query}`, PLACE_TTL, () => scrapeFullPlaceMetrics(query));
    await upsertPlace(c.env.DB, myStore);

    return c.json({ success: true, myStore });
  } catch (err: any) {
    console.error('진단 처리 중 오류:', err);
    c.executionCtx.waitUntil(notify(c.env, `⚠️ [진단 실패] query="${query}"\n${err.message || err}`));
    return c.json({ error: err.message || '매장 정보를 찾을 수 없습니다.' }, 500);
  }
});

// [2·3단계] 키워드 기반 Gap 분석 — 사용자가 직접 입력한 키워드로 상위 14위 수집
app.get('/api/gap', async (c) => {
  const placeId = c.req.query('placeId');
  const keyword = c.req.query('keyword');
  if (!placeId || !keyword) {
    return c.json({ error: 'placeId와 keyword가 필요합니다.' }, 400);
  }

  try {
    // 내 매장 (1단계에서 이미 캐시됐다면 재스크랩 없음)
    const myStore = await cached(c.env, `place:${placeId}`, PLACE_TTL, () => scrapeFullPlaceMetrics(placeId));

    // 오가닉 1~14위 (키워드 단위 캐시)
    const ranking = await cached(c.env, `rank:${keyword}`, KEYWORD_TTL, () => getOrganicRanking(keyword, 14));

    if (!ranking || ranking.length === 0) {
      return c.json({ error: `"${keyword}" 키워드의 검색 결과를 찾을 수 없습니다.` }, 404);
    }

    // 내 순위: 1~14위 또는 14위 밖(null)
    const myRankIndex = ranking.indexOf(placeId);
    const myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;

    // 상위 10위 중 본인 제외 → 비교 모수
    const top10Ids = ranking.slice(0, 10).filter(id => id !== placeId);
    if (top10Ids.length === 0) {
      return c.json({ error: '비교할 경쟁사가 없습니다.' }, 404);
    }

    const competitors = await Promise.all(
      top10Ids.map(id => cached(c.env, `place:${id}`, PLACE_TTL, () => scrapeFullPlaceMetrics(id)))
    );

    // 10위 업체 = 1페이지 진입선. 본인이 10위면 11위를 진입선으로 사용.
    const boundaryId = ranking[9] && ranking[9] !== placeId ? ranking[9] : ranking[10];
    const boundaryStore = boundaryId
      ? (competitors.find(s => s.placeId === boundaryId)
        || await cached(c.env, `place:${boundaryId}`, PLACE_TTL, () => scrapeFullPlaceMetrics(boundaryId)))
      : null;

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
      targetKeyword: keyword,
      myStore,
      myRank,
      rankSearched: ranking.length,
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
          keyword,
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
    c.executionCtx.waitUntil(Promise.all([
      notify(c.env, `📊 [신규 진단] ${myStore.name} (${myStore.placeId})\n키워드: ${keyword}\n순위: ${myRank ? `${myRank}위` : `${ranking.length}위 밖`} / 등급: ${grade}\n연락처: ${myStore.phone || '미등록'}`),
      logDiagnosisToSheet(c.env, {
        timestamp: new Date().toISOString(),
        placeName: myStore.name,
        placeId: myStore.placeId,
        phone: myStore.phone,
        category: myStore.category,
        roadAddress: myStore.roadAddress,
        targetKeyword: keyword,
        myRank,
        grade,
        visitorReviews: myStore.seoMetrics.visitorReviewsTotal,
        shareId,
      }),
    ]));

    return c.json(responsePayload);
  } catch (err: any) {
    console.error('Gap 분석 중 오류:', err);
    c.executionCtx.waitUntil(notify(c.env, `⚠️ [Gap 분석 실패] placeId="${placeId}" keyword="${keyword}"\n${err.message || err}\n(네이버 구조 변경 또는 차단 가능성 — §7 확인 요망)`));
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
        description = `'${data.targetKeyword}' 키워드 상위 10개 업체와 비교한 ${my.name}의 실시간 Gap 분석 결과. 지금 확인해보세요.`;
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
<meta http-equiv="refresh" content="0;url=${appUrl}">
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head>
<body>
<p>결과 페이지로 이동 중입니다. 자동으로 이동하지 않으면 <a href="${appUrl}">여기를 클릭</a>하세요.</p>
</body>
</html>`;

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

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runHealthcheck(env));
  },
};
