import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { basicAuth } from 'hono/basic-auth';
import { scrapeFullPlaceMetrics, getOrganicRanking } from './scraper';
import { notify, logDiagnosisToSheet, NotifyEnv } from './notify';

export interface Env extends NotifyEnv {
  DB: D1Database;
  CACHE?: KVNamespace; // 미바인딩 시 캐시 없이 동작 (§6 Phase A)
  ADMIN_USER?: string;
  ADMIN_PASS?: string;
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
const CACHE_VERSION = 'v3';

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
    const myStore = await cached(c.env, `place:${query}`, PLACE_TTL, () => scrapeFullPlaceMetrics(query, true));
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
    const myStore = await cached(c.env, `place:${placeId}`, PLACE_TTL, () => scrapeFullPlaceMetrics(placeId, true));

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
`;

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

  const rows = (results as any[]).map(r => `
    <tr>
      <td>${escapeHtml(r.created_at || '')}</td>
      <td><b>${escapeHtml(r.name || r.place_id)}</b><br><span style="color:#94A3B8">${escapeHtml(r.category || '')}</span></td>
      <td>${escapeHtml(r.target_keyword)}</td>
      <td>${r.my_rank ? r.my_rank + '위' : '순위밖'}</td>
      <td><span class="badge grade-${escapeHtml(r.grade_reviews || 'B')}">${escapeHtml(r.grade_reviews || '-')}</span></td>
      <td>${r.my_reviews ?? '-'} / 평균 ${r.top10_avg_reviews ?? '-'}</td>
      <td><a href="/admin/${escapeHtml(r.share_id)}">상세보기</a> · <a href="/share/${escapeHtml(r.share_id)}" target="_blank">공유링크</a></td>
    </tr>`).join('');

  return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>동네비즈 관리자 - 진단 리스트</title><style>${ADMIN_STYLE}</style></head>
<body>
  <h1>진단 리스트 (최신 ${(results as any[]).length}건)</h1>
  <table>
    <thead><tr><th>일시</th><th>매장</th><th>키워드</th><th>내 순위</th><th>등급</th><th>리뷰(내/평균)</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">아직 진단 기록이 없습니다.</td></tr>'}</tbody>
  </table>
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
  <a class="back" href="/admin">&larr; 목록으로</a>
  <div class="card">
    <h1 style="margin:0 0 8px;">${escapeHtml(my.name)} <span class="badge grade-${escapeHtml(data.grade || 'B')}">${escapeHtml(data.grade || '-')}</span></h1>
    <p style="font-size:13px;color:#475569;margin:4px 0;">키워드: <b>${escapeHtml(data.targetKeyword)}</b> · 순위: <b>${data.myRank ? data.myRank + '위' : '순위밖(' + data.rankSearched + '위 밖)'}</b> · 진단일시: ${escapeHtml(String(row.created_at || ''))}</p>
    <p style="font-size:13px;color:#475569;margin:4px 0;">연락처: <b>${escapeHtml(my.phone || '미등록')}</b> · 주소: ${escapeHtml(my.roadAddress || '미등록')}</p>
    <p style="font-size:13px;margin:8px 0 0;"><a href="/share/${escapeHtml(shareId)}" target="_blank">공유 링크(고객용)</a> · <a href="/?shareId=${escapeHtml(shareId)}" target="_blank">실제 앱 화면으로 보기</a></p>
  </div>

  <h2 style="font-size:15px;">내 매장 원본 데이터 (Raw)</h2>
  <div class="card"><pre>${escapeHtml(JSON.stringify(my, null, 2))}</pre></div>

  <h2 style="font-size:15px;">경쟁사 원본 데이터 (Top ${competitors.length})</h2>
  ${competitorBlocks || '<div class="card">경쟁사 데이터가 없습니다.</div>'}

  <h2 style="font-size:15px;">지표별 통계 (avg/median/boundary)</h2>
  <div class="card"><pre>${escapeHtml(JSON.stringify(data.stats, null, 2))}</pre></div>
</body></html>`);
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
