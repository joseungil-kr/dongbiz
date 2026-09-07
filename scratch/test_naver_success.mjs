const query = process.argv[2] || '0314070103';

async function testNaverSearch() {
  // searchCoord=127.027610;37.498095 (기본 좌표값 전달)
  const url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(query)}&type=all&searchCoord=127.027610%3B37.498095`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://map.naver.com/p/search/' + encodeURIComponent(query),
    'Accept': 'application/json, text/plain, */*'
  };

  const res = await fetch(url, { headers });
  const json = await res.json();
  
  // result 분석
  const placeResult = json.result?.place;
  console.log('Place Result Status:', placeResult ? 'Found' : 'Not Found');
  if (placeResult) {
    const list = placeResult.list;
    console.log('List count:', list?.length);
    if (list && list.length > 0) {
      const item = list[0];
      console.log('\n========================================');
      console.log('🎉 [검증 성공] 네이버 플레이스 데이터 추출 완료!');
      console.log('========================================');
      console.log(`• 상호명 (name):       ${item.name}`);
      console.log(`• 전화번호 (tel):      ${item.tel}`);
      console.log(`• 지번 주소 (address):  ${item.address}`);
      console.log(`• 도로명 (roadAddress): ${item.roadAddress}`);
      console.log(`• 업종 카테고리:       ${item.category?.join(' > ') || item.category}`);
      console.log(`• 대표 썸네일 이미지:  ${item.thumUrl || '없음'}`);
      console.log(`• 플레이스 고유 ID:    ${item.id}`);
      console.log(`• 플레이스 바로가기:   https://map.naver.com/p/entry/place/${item.id}`);
      console.log('========================================\n');
      return;
    }
  }

  console.log('전체 응답 요약:', JSON.stringify(json, null, 2).slice(0, 1000));
}

testNaverSearch();
