const keyword = process.argv[2] || '안산맛집';

async function getTopOrganicPlaces(kw) {
  console.log(`\n[SEARCH] 키워드: "${kw}" 네이버 통합검색 순위 분석 시작...`);

  const searchUrl = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(kw)}`;
  const res = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    }
  });

  const html = await res.text();

  // 플레이스 리스트 파싱 (JSON-LD 또는 HTML 텍스트 정규식)
  // 네이버 플레이스 블록에서 각 업체의 placeId 및 광고(AD) 여부 탐색
  const placeRegex = /https?:\/\/map\.naver\.com\/p\/entry\/place\/(\d+)/g;
  const ids = [];
  let m;
  while ((m = placeRegex.exec(html)) !== null) {
    if (!ids.includes(m[1])) {
      ids.push(m[1]);
    }
  }

  console.log(`발견된 플레이스 ID 목록 (${ids.length}개):`, ids.slice(0, 10));

  // 또는 네이버 모바일 플레이스 랭킹 API 다이렉트 호출
  const mSearchUrl = `https://m.map.naver.com/search2/searchMore.naver?query=${encodeURIComponent(kw)}&sm=clk&style=v5&page=1&displayCount=10`;
  const mRes = await fetch(mSearchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      'Referer': 'https://m.map.naver.com/',
      'Accept': 'application/json, text/plain, */*'
    }
  });

  const mJson = await mRes.json();
  const list = mJson?.result?.site?.list || [];

  console.log(`모바일 랭킹 API 검색 결과 (${list.length}개 발견):`);
  list.forEach((item, idx) => {
    console.log(`   #${idx + 1} [ID: ${item.id}] ${item.name} (${item.category}) - 광고여부: ${item.isAd || 'N'}`);
  });
}

getTopOrganicPlaces(keyword);
