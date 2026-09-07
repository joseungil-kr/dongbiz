/**
 * 네이버 플레이스 원스톱 스크래퍼 (전화번호 or 상호명 ➔ 기본정보 즉시 추출)
 */
async function scrapeNaverPlace(query) {
  console.log(`[SCRAPER] 검색어: "${query}"`);

  // 1단계: 네이버 통합검색에서 플레이스 ID 추출
  const searchUrl = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(query)}`;
  const searchRes = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    }
  });
  const searchHtml = await searchRes.text();

  const placeIdMatch = searchHtml.match(/https?:\/\/map\.naver\.com\/p\/entry\/place\/(\d+)/i) || 
                       searchHtml.match(/https?:\/\/map\.naver\.com\/v5\/entry\/place\/(\d+)/i) ||
                       searchHtml.match(/data-cid="(\d+)"/i);

  if (!placeIdMatch) {
    console.log('❌ 등록된 네이버 스마트플레이스를 찾지 못했습니다.');
    return null;
  }

  const placeId = placeIdMatch[1];

  // 2단계: 플레이스 상세 페이지에서 데이터 추출
  const detailUrl = `https://m.place.naver.com/place/${placeId}/home`;
  const detailRes = await fetch(detailUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  const detailHtml = await detailRes.text();

  const apolloMatch = detailHtml.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if (!apolloMatch) {
    console.log('❌ 상세 데이터를 파싱할 수 없습니다.');
    return null;
  }

  const state = JSON.parse(apolloMatch[1]);
  const baseData = state[`PlaceDetailBase:${placeId}`];

  if (!baseData) {
    console.log('❌ PlaceDetailBase 데이터를 찾을 수 없습니다.');
    return null;
  }

  // 3단계: 표준화된 업체 정보 객체 반환
  const result = {
    placeId: placeId,
    name: baseData.name,
    category: baseData.category,
    phone: baseData.phone || baseData.virtualPhone || query,
    roadAddress: baseData.roadAddress,
    address: baseData.address,
    conveniences: baseData.conveniences || [],
    talktalkUrl: baseData.talktalkUrl || null,
    placeUrl: `https://map.naver.com/p/entry/place/${placeId}`,
    coordinates: {
      x: baseData.coordinate?.x,
      y: baseData.coordinate?.y
    }
  };

  return result;
}

// 실전 테스트 실행
async function run() {
  const query = process.argv[2] || '0314070103';
  const info = await scrapeNaverPlace(query);

  if (info) {
    console.log('\n========================================================');
    console.log('🎉 [서버사이드 스크래핑 100% 성공 실증 결과]');
    console.log('========================================================');
    console.log(`• 상호명 (name):          ${info.name}`);
    console.log(`• 전화번호 (phone):       ${info.phone}`);
    console.log(`• 도로명 주소:            ${info.roadAddress}`);
    console.log(`• 지번 주소:              ${info.address}`);
    console.log(`• 업종 카테고리:          ${info.category}`);
    console.log(`• 편의시설 및 태그:       ${info.conveniences.slice(0, 5).join(', ')}...`);
    console.log(`• 네이버 스마트플레이스:   ${info.placeUrl}`);
    console.log('========================================================\n');
  }
}

run();
