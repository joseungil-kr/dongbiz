// 현재 네이버 지도 PC/Mobile 통합 검색 API 테스트
const query = process.argv[2] || '0314070103';

async function testNaverSearch() {
  console.log(`[TEST] 네이버 플레이스 검색 조회: "${query}"`);

  // 네이버 지도 v5 GraphQL/API 또는 Search API
  const url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(query)}&type=all&searchCoord=126.83%3B37.31`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://map.naver.com/',
    'Accept': 'application/json, text/plain, */*'
  };

  try {
    const res = await fetch(url, { headers });
    console.log(`응답 상태 코드: ${res.status}`);
    const json = await res.json();
    
    const place = json?.result?.place?.list?.[0];
    if (place) {
      console.log('\n========================================');
      console.log('✅ 네이버 플레이스 API v5 스크래핑 성공!');
      console.log('========================================');
      console.log(`• 상호명:      ${place.name}`);
      console.log(`• 전화번호:    ${place.tel}`);
      console.log(`• 도로명 주소: ${place.roadAddress}`);
      console.log(`• 지번 주소:   ${place.address}`);
      console.log(`• 업종 분류:   ${place.category?.join(' > ') || place.category}`);
      console.log(`• 썸네일:      ${place.thumUrl || '없음'}`);
      console.log(`• 고유 ID:     ${place.id}`);
      console.log(`• 링크:        https://map.naver.com/p/entry/place/${place.id}`);
      console.log('========================================\n');
      return;
    }

    console.log('플레이스 검색 결과 없음. 응답 키:', Object.keys(json?.result || {}));
  } catch (err) {
    console.error('호출 실패:', err.message);
  }
}

testNaverSearch();
