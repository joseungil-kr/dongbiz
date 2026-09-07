const placeId = process.argv[2] || '2058645213';

async function inspectAllPlaceData(id) {
  console.log(`[FULL-INSPECT] 네이버 플레이스 ID: ${id} 전체 데이터 추출 분석 시작...`);
  
  const detailUrl = `https://m.place.naver.com/place/${id}/home`;
  const res = await fetch(detailUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'text/html,application/xhtml+xml',
    }
  });

  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);

  if (!apolloMatch) {
    console.log('APOLLO_STATE 없음');
    return;
  }

  const state = JSON.parse(apolloMatch[1]);
  const keys = Object.keys(state);

  console.log(`총 상태 키 개수: ${keys.length}`);

  // 1. PlaceDetailBase
  const baseKey = keys.find(k => k.startsWith(`PlaceDetailBase:${id}`));
  const base = state[baseKey] || {};

  // 2. Photo / Images
  const photoKeys = keys.filter(k => k.includes('Photo') || k.includes('Image'));
  
  // 3. Review / Stats
  const reviewStatsKey = keys.find(k => k.startsWith(`VisitorReviewStatsResult:${id}`) || k.includes('ReviewStats'));
  const reviewStats = state[reviewStatsKey] || {};

  // 4. Menu
  const menuKeys = keys.filter(k => k.startsWith(`Menu:${id}`));

  // 5. Keyword / Tags / Rep Keywords
  const keywordKeys = keys.filter(k => k.toLowerCase().includes('keyword') || k.toLowerCase().includes('tag'));

  console.log('\n=== [1] PlaceDetailBase 주요 필드 ===');
  for (const [k, v] of Object.entries(base)) {
    if (typeof v !== 'object' || Array.isArray(v)) {
      console.log(`- ${k}:`, v);
    }
  }

  console.log('\n=== [2] Review Stats 필드 ===');
  console.log(JSON.stringify(reviewStats, null, 2));

  console.log('\n=== [3] 사진 / 이미지 관련 키 및 샘플 ===');
  console.log('Photo keys count:', photoKeys.length);
  if (photoKeys.length > 0) {
    console.log('Sample photo item:', state[photoKeys[0]]);
  }

  console.log('\n=== [4] 메뉴 / 상품 정보 ===');
  console.log('Menu count:', menuKeys.length);
  if (menuKeys.length > 0) {
    console.log('Sample menu item:', state[menuKeys[0]]);
  }

  console.log('\n=== [5] 키워드 / 태그 관련 상태 ===');
  keywordKeys.forEach(k => {
    console.log(`- ${k}:`, state[k]);
  });
}

inspectAllPlaceData(placeId);
