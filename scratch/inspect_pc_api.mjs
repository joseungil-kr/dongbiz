const placeId = '2058645213';

async function checkPCWeb(id) {
  const pcUrl = `https://map.naver.com/p/entry/place/${id}?c=15.00,0,0,0,dh`;
  const res = await fetch(pcUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    }
  });

  const html = await res.text();
  console.log('PC HTML Length:', html.length);

  // 저장수, 북마크, 블로그 등 검색
  const matches = html.match(/"bookmarkCount":(\d+)/i) || 
                  html.match(/"saveCount":(\d+)/i) || 
                  html.match(/저장\s*(\d[\d,]*)/i);

  console.log('Bookmark/Save count match:', matches);

  // 소개글(description), 대표키워드, 홈페이지 등 검색
  const descMatch = html.match(/"description":"([^"]+)"/i);
  console.log('Description match:', descMatch ? descMatch[1].slice(0, 100) : 'none');

  // window.__APOLLO_STATE__ 또는 __NEXT_DATA__ 확인
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    console.log('NEXT_DATA Found! length:', nextDataMatch[1].length);
  }

  // 플레이스 API 직접 호출 확인 (GraphQL 또는 summary API)
  const summaryApiUrl = `https://map.naver.com/p/api/place/summary/${id}`;
  const resSummary = await fetch(summaryApiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': 'https://map.naver.com/',
      'Accept': 'application/json, text/plain, */*'
    }
  });
  console.log('summaryApi status:', resSummary.status);
  if (resSummary.status === 200) {
    const sJson = await resSummary.json();
    console.log('summaryApi JSON keys:', Object.keys(sJson));
    console.log('Summary data:', JSON.stringify(sJson, null, 2).slice(0, 1000));
  }
}

checkPCWeb(placeId);
