import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeFullPlaceMetrics } from './full_place_scraper.mjs';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

// Initialize SQLite Database (Mocking Cloudflare D1)
const dbPath = path.join(__dirname, 'dongbiz.db');
const db = new Database(dbPath);
const schemaPath = path.join(__dirname, 'db_schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schemaSql);


// 네이버 통합검색에서 해당 키워드 1위 오가닉 플레이스 ID 추출 함수
async function getTopRankerPlace(keyword) {
  try {
    const searchUrl = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(keyword)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    const regex = /href="(https?:\/\/map\.naver\.com\/p\/(?:search\/[^/]+\/place|entry\/place)\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const id = match[2];
      const surrounding = html.slice(Math.max(0, match.index - 300), match.index + 300);
      const isAd = surrounding.includes('ico_ad') || surrounding.includes('광고') || surrounding.includes('sp_ad');
      if (!isAd) {
        return id; // 첫 번째 오가닉 1위
      }
    }
  } catch (err) {
    console.error('1위 추출 에러:', err);
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // 1. 실시간 진단 API (/api/diagnose?query=0314070103)
  if (reqUrl.pathname === '/api/diagnose') {
    const query = reqUrl.searchParams.get('query');
    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '전화번호나 상호를 입력해주세요.' }));
      return;
    }

    try {
      console.log(`\n🔍 [실시간 진단 요청 접수]: ${query}`);
      // 1) 내 매장 데이터 실시간 수집
      const myStore = await scrapeFullPlaceMetrics(query);
      console.log(`✅ 내 매장 확인: ${myStore.name} (${myStore.category}) - ${myStore.roadAddress}`);

      // 2) 경쟁 분석 타겟 키워드 선정 (업종별 지능형 매칭)
      let city = '안산';
      if (myStore.roadAddress) {
        const parts = myStore.roadAddress.split(' ');
        if (parts.length >= 2) city = `${parts[0].replace(/특별시|광역시|특별자치시|도/, '')} ${parts[1]}`.trim();
      }

      // 업종 카테고리가 맛집/식당 계열인지, 특수 서비스(스카이차/설비/누수/학원 등)인지에 따라 타겟 검색어 최적화
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
      console.log(`🎯 타겟 키워드: "${targetKeyword}" 1위 경쟁사 탐색 중...`);
      let comp1Id = await getTopRankerPlace(targetKeyword);
      
      // 만약 1위가 내 매장과 같거나 없으면 기본 매장 활용
      if (!comp1Id || comp1Id === myStore.placeId) {
        comp1Id = '1605910967'; // 안산스카이차 1위 등
      }

      const comp1 = await scrapeFullPlaceMetrics(comp1Id);
      console.log(`🏆 1위 경쟁사 확인: ${comp1.name} (리뷰: ${comp1.seoMetrics.visitorReviewsTotal}건)`);

      // 4) Gap 분석 계산
      const visitorDiff = comp1.seoMetrics.visitorReviewsTotal - myStore.seoMetrics.visitorReviewsTotal;
      const blogDiff = comp1.seoMetrics.cafeBlogReviewsTotal - myStore.seoMetrics.cafeBlogReviewsTotal;
      const voteDiff = comp1.seoMetrics.totalVoteCount - myStore.seoMetrics.totalVoteCount;

      // 5) A/B/C 등급 산정 (단순화: 1위 평균 대비 50% 이하면 C, 80% 이상 A)
      const reviewRatio = myStore.seoMetrics.visitorReviewsTotal / Math.max(comp1.seoMetrics.visitorReviewsTotal, 1);
      let grade = 'B';
      if (reviewRatio >= 0.8) grade = 'A';
      if (reviewRatio < 0.5) grade = 'C';

      // 6) 데이터베이스 저장 (Cloudflare D1 시뮬레이션)
      const shareId = uuidv4().substring(0, 8);
      
      // 내 매장 정보 Insert or Ignore
      const insertPlace = db.prepare(`
        INSERT OR IGNORE INTO places (id, name, category, road_address, talktalk_active)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertPlace.run(myStore.placeId, myStore.name, myStore.category, myStore.roadAddress, myStore.seoMetrics.talktalkUrl ? 1 : 0);

      // 검색 히스토리 Insert
      const insertHistory = db.prepare(`
        INSERT INTO search_histories (share_id, place_id, target_keyword, my_rank, top10_avg_reviews, my_reviews, grade_reviews, raw_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
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
          scoreDiff: (Number(myStore.seoMetrics.visitorReviewsScore || 0) - Number(comp1.seoMetrics.visitorReviewsScore || 0)).toFixed(2)
        }
      };

      insertHistory.run(
        shareId, 
        myStore.placeId, 
        targetKeyword, 
        null, // my_rank (추후 보강)
        comp1.seoMetrics.visitorReviewsTotal, // 단순비교를 위해 1위값 사용 
        myStore.seoMetrics.visitorReviewsTotal, 
        grade, 
        JSON.stringify(responsePayload) // 스냅샷 백업
      );

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(responsePayload));
    } catch (err) {
      console.error('진단 처리 중 오류:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message || '매장 정보를 찾을 수 없습니다.' }));
    }
    return;
  }

  // 1.5 진단 결과 공유 링크 API (/api/history?shareId=xxxx)
  if (reqUrl.pathname === '/api/history') {
    const shareId = reqUrl.searchParams.get('shareId');
    if (!shareId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'shareId가 필요합니다.' }));
      return;
    }

    try {
      const stmt = db.prepare('SELECT raw_data FROM search_histories WHERE share_id = ?');
      const row = stmt.get(shareId);

      if (!row) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '해당 진단 결과를 찾을 수 없습니다.' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(row.raw_data);
    } catch (err) {
      console.error('히스토리 조회 중 오류:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '서버 오류가 발생했습니다.' }));
    }
    return;
  }

  // 2. 프리뷰 HTML 서빙 (루트 접속 시)
  if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
    const htmlPath = path.join(__dirname, '..', 'dongbiz_hero_preview.html');
    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(`🚀 [동네비즈 실시간 라이브 진단 서버 구동 완료!]`);
  console.log(`🌐 접속 주소: http://localhost:${PORT}`);
  console.log(`========================================================`);
});
