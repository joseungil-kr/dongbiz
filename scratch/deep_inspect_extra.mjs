const placeId = '2058645213';

async function deepInspectAllTabs(id) {
  console.log(`[DEEP-INSPECT] 플레이스 전체 탭 데이터 수집 테스트: ID ${id}`);

  // 1. 홈 탭 (기본정보, 영업시간, 소개글, 저장수 등)
  const homeUrl = `https://m.place.naver.com/place/${id}/home`;
  const resHome = await fetch(homeUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  const htmlHome = await resHome.text();
  const apolloMatch = htmlHome.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  
  if (!apolloMatch) {
    console.log('홈 데이터 파싱 실패');
    return;
  }

  const state = JSON.parse(apolloMatch[1]);
  const keys = Object.keys(state);

  // 저장하기(북마크) 수량, 네이버 알림받기, 공유수 관련 키 탐색
  const bookmarkKeys = keys.filter(k => k.toLowerCase().includes('save') || k.toLowerCase().includes('bookmark') || k.toLowerCase().includes('favorite'));
  console.log('\n--- 1. 저장/북마크 관련 키 ---');
  console.log(bookmarkKeys);
  bookmarkKeys.forEach(k => console.log(k, state[k]));

  // 영업시간 및 브레이크타임, 휴무일 (OpeningHours)
  const hoursKeys = keys.filter(k => k.toLowerCase().includes('hour') || k.toLowerCase().includes('business') || k.toLowerCase().includes('time'));
  console.log('\n--- 2. 영업시간/휴무일 관련 키 ---');
  hoursKeys.forEach(k => console.log(k, state[k]));

  // 소개글 / 공지사항 / 사장님 한마디 (Notice / Description / MicroReview)
  const descKeys = keys.filter(k => k.toLowerCase().includes('desc') || k.toLowerCase().includes('notice') || k.toLowerCase().includes('story') || k.toLowerCase().includes('intro'));
  console.log('\n--- 3. 공지/소개/소식 관련 키 ---');
  descKeys.forEach(k => console.log(k, state[k]));

  // 소셜 미디어 링크 (인스타그램, 블로그, 유튜브, 스마트스토어 링크 등)
  const snsKeys = keys.filter(k => k.toLowerCase().includes('sns') || k.toLowerCase().includes('channel') || k.toLowerCase().includes('homepage') || k.toLowerCase().includes('url'));
  console.log('\n--- 4. SNS 및 외부 채널 링크 관련 키 ---');
  snsKeys.forEach(k => console.log(k, state[k]));

  // 쿠폰 / 이벤트 / 혜택 (Coupon / Event / Benefit)
  const couponKeys = keys.filter(k => k.toLowerCase().includes('coupon') || k.toLowerCase().includes('event') || k.toLowerCase().includes('benefit'));
  console.log('\n--- 5. 쿠폰/이벤트 관련 키 ---');
  couponKeys.forEach(k => console.log(k, state[k]));
}

deepInspectAllTabs(placeId);
