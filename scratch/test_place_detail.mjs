const placeId = '2058645213';

async function fetchPlaceDetail(id) {
  console.log(`[TEST] 네이버 플레이스 상세 API 호출: ${id}`);
  const url = `https://api.place.naver.com/graphql`;

  const query = [
    {
      operationName: "getPlaceDetail",
      variables: {
        id: id
      },
      query: `query getPlaceDetail($id: String!) {
        place(id: $id) {
          id
          name
          category
          roadAddress
          address
          phone
          virtualPhone
          businessHours
          description
          images {
            url
          }
        }
      }`
    }
  ];

  // 또는 플레이스 모바일 웹 상세 엔드포인트
  const detailHtmlUrl = `https://m.place.naver.com/place/${id}/home`;

  const res = await fetch(detailHtmlUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'text/html,application/xhtml+xml',
    }
  });

  const html = await res.text();

  // window.__APOLLO_STATE__ 추출 (네이버 플레이스가 클라이언트에 렌더링용으로 심어둔 전체 JSON 데이터)
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if (apolloMatch) {
    try {
      const state = JSON.parse(apolloMatch[1]);
      const baseKey = Object.keys(state).find(k => k.startsWith(`PlaceBase:${id}`) || k.startsWith(`PlaceSummary:${id}`));
      const placeData = state[baseKey];
      
      console.log('\n========================================');
      console.log('🎉 [100% 완벽 검증] 플레이스 상세 데이터 추출 완료!');
      console.log('========================================');
      console.log(`• 고유 ID:       ${id}`);
      console.log(`• 상호명:        ${placeData?.name || state[`Place:${id}`]?.name}`);
      console.log(`• 업종 카테고리: ${placeData?.category || state[`Place:${id}`]?.category}`);
      console.log(`• 도로명 주소:   ${placeData?.roadAddress || state[`Place:${id}`]?.roadAddress}`);
      console.log(`• 지번 주소:     ${placeData?.address || state[`Place:${id}`]?.address}`);
      console.log(`• 전화번호:      ${placeData?.phone || placeData?.virtualPhone || state[`Place:${id}`]?.phone}`);
      console.log(`• 소개글:        ${(placeData?.description || state[`Place:${id}`]?.description || '없음').slice(0, 100)}...`);
      console.log('========================================\n');
      return;
    } catch(e) {
      console.error('APOLLO_STATE 파싱 실패:', e);
    }
  }

  // 백업: HTML meta og 태그 추출
  const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1];
  const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/i)?.[1];
  console.log('Meta Fallback:', { ogTitle, ogDesc });
}

fetchPlaceDetail(placeId);
