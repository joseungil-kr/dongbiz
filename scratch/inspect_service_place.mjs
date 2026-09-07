// 누수탐지 업체 샘플로 플레이스 소개글(description), 대표키워드, 블로그 링크 등 테스트
const query = '안산 누수';

async function testNonRestaurant(q) {
  const searchUrl = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(q)}`;
  const searchRes = await fetch(searchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const searchHtml = await searchRes.text();
  const match = searchHtml.match(/https?:\/\/map\.naver\.com\/p\/entry\/place\/(\d+)/i) || 
                searchHtml.match(/data-cid="(\d+)"/i);
  
  if (!match) {
    console.log('검색결과 없음');
    return;
  }

  const id = match[1];
  console.log(`선택된 누수 업체 ID: ${id}`);

  const homeUrl = `https://m.place.naver.com/place/${id}/home`;
  const res = await fetch(homeUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);

  if (apolloMatch) {
    const state = JSON.parse(apolloMatch[1]);
    const baseKey = Object.keys(state).find(k => k.startsWith(`PlaceDetailBase:${id}`));
    const base = state[baseKey] || {};
    
    console.log('\n--- 비식당(기술/설비) 카테고리 추출 데이터 ---');
    console.log(`• 상호: ${base.name}`);
    console.log(`• 소개글 (description): ${base.description || '없음'}`);
    console.log(`• 블로그 링크 (naverBlog): ${base.naverBlog || '없음'}`);
    console.log(`• 스마트콜 (virtualPhone): ${base.virtualPhone || '없음'}`);
    console.log(`• 홈페이지: ${base.homepage || '없음'}`);
    console.log(`• 대표 한줄평 (microReviews): ${base.microReviews?.join(', ') || '없음'}`);
    console.log(`• 편의시설 (conveniences): ${base.conveniences?.join(', ') || '없음'}`);
    console.log(`• 찾아오는 길: ${base.road || '없음'}`);
  }
}

testNonRestaurant(query);
