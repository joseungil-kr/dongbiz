const placeId = '2058645213';

async function inspectSaveCount(id) {
  // 저장수 및 예약 혜택 엔드포인트
  const endpoints = [
    `https://m.place.naver.com/place/${id}/home`,
    `https://map.naver.com/p/api/place/summary/${id}`,
    `https://m.place.naver.com/restaurant/${id}/home`,
  ];

  const res = await fetch(`https://m.place.naver.com/restaurant/${id}/home`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  const html = await res.text();
  console.log('Restaurant HTML Length:', html.length);

  // 저장 수량 패턴 검색 (예: "저장 1,234" 또는 "bookmarkCount": 123)
  const saveMatches = html.match(/저장\s*([0-9,]+)/g) || 
                      html.match(/"saveCount":\s*([0-9]+)/g) ||
                      html.match(/"bookmarkCount":\s*([0-9]+)/g) ||
                      html.match(/"bookmark":\s*\{[^}]+\}/g);

  console.log('Save matches:', saveMatches);

  // 소개글(description), 공지사항(notice)
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if (apolloMatch) {
    const state = JSON.parse(apolloMatch[1]);
    const keys = Object.keys(state);
    
    // 소개글
    const baseKey = keys.find(k => k.startsWith('PlaceDetailBase') || k.startsWith('RestaurantBase'));
    console.log('Base Object Description:', state[baseKey]?.description);
    console.log('Base Object MicroReviews:', state[baseKey]?.microReviews);
    console.log('Base Object BusinessHours:', state[baseKey]?.businessHours);
    console.log('Base Object Road (찾아오는길):', state[baseKey]?.road);

    // 대표 키워드 (소비자 태그 말고 업주가 등록한 대표 키워드: keywords)
    console.log('Keywords field in Base:', state[baseKey]?.keywords);

    // 공지사항 (Notice)
    const noticeKey = keys.find(k => k.toLowerCase().includes('notice'));
    if (noticeKey) console.log('Notice data:', state[noticeKey]);
  }
}

inspectSaveCount(placeId);
