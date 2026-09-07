import https from 'https';

// 테스트할 검색어: 사용자가 예시로 주신 전화번호 '0314070103'
const query = process.argv[2] || '0314070103';

console.log(`[TEST] 네이버 플레이스 검색 조회 시작: "${query}"`);

// 1. 네이버 지도 모바일 검색 엔드포인트
const searchUrl = `https://m.map.naver.com/search2/searchMore.naver?query=${encodeURIComponent(query)}&sm=clk&style=v5&page=1&displayCount=1`;

const options = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://m.map.naver.com/',
    'Accept': 'application/json, text/javascript, */*; q=0.01'
  }
};

https.get(searchUrl, options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      const siteList = parsed?.result?.site?.list;
      if (siteList && siteList.length > 0) {
        const item = siteList[0];
        console.log('\n========================================');
        console.log('✅ 네이버 플레이스 서버사이드 스크래핑 성공!');
        console.log('========================================');
        console.log(`• 상호명 (name):       ${item.name}`);
        console.log(`• 전화번호 (tel):      ${item.tel}`);
        console.log(`• 지번 주소 (address):  ${item.address}`);
        console.log(`• 도로명 (roadAddress): ${item.roadAddress}`);
        console.log(`• 업종 카테고리:       ${item.category}`);
        console.log(`• 대표 썸네일 URL:     ${item.thumUrl || '없음'}`);
        console.log(`• 플레이스 고유 ID:    ${item.id}`);
        console.log(`• 플레이스 링크:       https://map.naver.com/p/entry/place/${item.id}`);
        console.log('========================================\n');
      } else {
        console.log('\n❌ 검색 결과가 없습니다.');
        console.log('응답 요약:', JSON.stringify(parsed).slice(0, 300));
      }
    } catch (e) {
      console.error('파싱 에러:', e.message);
      console.log('원본 응답:', data.slice(0, 300));
    }
  });
}).on('error', (err) => {
  console.error('HTTP 요청 실패:', err.message);
});
