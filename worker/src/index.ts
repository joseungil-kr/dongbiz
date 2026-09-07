import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { scrapeFullPlaceMetrics, getTopRankerPlace } from './scraper';

// D1 Database Interface
export interface Env {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all routes
app.use('/api/*', cors());

// Generate an 8-character ID
function generateShareId() {
  return Math.random().toString(36).substring(2, 10);
}

app.get('/api/diagnose', async (c) => {
  const query = c.req.query('query');
  if (!query) {
    return c.json({ error: '전화번호나 상호를 입력해주세요.' }, 400);
  }

  try {
    // 1) 내 매장 데이터 실시간 수집
    const myStore = await scrapeFullPlaceMetrics(query);

    // 2) 경쟁 분석 타겟 키워드 선정 (업종별 지능형 매칭)
    let city = '안산';
    if (myStore.roadAddress) {
      const parts = myStore.roadAddress.split(' ');
      if (parts.length >= 2) city = `${parts[0].replace(/특별시|광역시|특별자치시|도/, '')} ${parts[1]}`.trim();
    }

    let targetKeyword = `${city} 맛집`;
    const cat = myStore.category || '';
    if (cat.includes('중장비') || myStore.name.includes('스카이') || myStore.name.includes('사다리')) {
      targetKeyword = `${city} 스카이차`;
    } else if (cat.includes('설비') || cat.includes('누수') || myStore.name.includes('누수')) {
      targetKeyword = `${city} 누수`;
    } else if (cat.includes('인테리어') || cat.includes('도배')) {
      targetKeyword = `${city} 인테리어`;
    } else if (cat && !cat.includes('음식') && !cat.includes('식당') && !cat.includes('요리')) {
      targetKeyword = `${city} ${cat.split(',')[0]}`;
    }

    // 3) 1위 오가닉 경쟁사 추출 및 데이터 수집
    let comp1Id = await getTopRankerPlace(targetKeyword);
    if (!comp1Id || comp1Id === myStore.placeId) {
      comp1Id = '1605910967'; // Fallback
    }
    const comp1 = await scrapeFullPlaceMetrics(comp1Id);

    // 4) Gap 분석 계산
    const visitorDiff = comp1.seoMetrics.visitorReviewsTotal - myStore.seoMetrics.visitorReviewsTotal;
    const blogDiff = comp1.seoMetrics.cafeBlogReviewsTotal - myStore.seoMetrics.cafeBlogReviewsTotal;
    const voteDiff = comp1.seoMetrics.totalVoteCount - myStore.seoMetrics.totalVoteCount;
    const scoreDiff = (Number(myStore.seoMetrics.visitorReviewsScore || 0) - Number(comp1.seoMetrics.visitorReviewsScore || 0)).toFixed(2);

    // 5) A/B/C 등급 산정
    const reviewRatio = myStore.seoMetrics.visitorReviewsTotal / Math.max(comp1.seoMetrics.visitorReviewsTotal, 1);
    let grade = 'B';
    if (reviewRatio >= 0.8) grade = 'A';
    if (reviewRatio < 0.5) grade = 'C';

    const shareId = generateShareId();

    const responsePayload = {
      success: true,
      shareId,
      targetKeyword,
      myStore,
      comp1,
      gap: {
        visitorDiff,
        blogDiff,
        voteDiff,
        scoreDiff
      }
    };

    // 6) 데이터베이스 저장 (Cloudflare D1)
    const db = c.env.DB;
    if (db) {
      try {
        await db.prepare(`
          INSERT OR IGNORE INTO places (id, name, category, road_address, talktalk_active)
          VALUES (?, ?, ?, ?, ?)
        `).bind(myStore.placeId, myStore.name, myStore.category, myStore.roadAddress, myStore.seoMetrics.hasTalktalk ? 1 : 0).run();

        await db.prepare(`
          INSERT INTO search_histories (share_id, place_id, target_keyword, top10_avg_reviews, my_reviews, grade_reviews, raw_data)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          shareId,
          myStore.placeId,
          targetKeyword,
          comp1.seoMetrics.visitorReviewsTotal,
          myStore.seoMetrics.visitorReviewsTotal,
          grade,
          JSON.stringify(responsePayload)
        ).run();
      } catch (dbErr) {
        console.error('DB Insert Error:', dbErr);
        // DB 에러가 나도 응답은 내려보냄
      }
    }

    return c.json(responsePayload);
  } catch (err: any) {
    console.error('진단 처리 중 오류:', err);
    return c.json({ error: err.message || '매장 정보를 찾을 수 없습니다.' }, 500);
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

export default app;
