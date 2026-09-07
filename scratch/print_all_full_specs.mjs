const placeId = process.argv[2] || '2058645213';

async function extractRawFullData(id) {
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
    console.error('APOLLO_STATE 추출 실패');
    return;
  }

  const state = JSON.parse(apolloMatch[1]);
  const keys = Object.keys(state);

  // 1. PlaceDetailBase
  const baseKey = keys.find(k => k.startsWith(`PlaceDetailBase:${id}`));
  const base = state[baseKey] || {};

  // 2. Review Stats
  const reviewKey = keys.find(k => k.startsWith(`VisitorReviewStatsResult:${id}`));
  const reviewStats = state[reviewKey] || {};
  const voted = reviewStats?.analysis?.votedKeyword || {};
  const votedDetails = voted?.details || [];

  // 3. Menus
  const menuKeys = keys.filter(k => k.startsWith(`Menu:${id}`));
  const menus = menuKeys.map(k => state[k]);

  // 4. Photos
  const photoKeys = keys.filter(k => k.startsWith(`PlaceDetailTopPhotoItem:${id}`));
  const photos = photoKeys.map(k => state[k]);

  console.log('\n================================================================================');
  console.log(`📊 [네이버 스마트플레이스 전수 원천 데이터 풀 리포트 (Full Raw Specification)]`);
  console.log(`• 수집 대상 고유 ID: ${id}`);
  console.log(`• 플레이스 URL: https://map.naver.com/p/entry/place/${id}`);
  console.log('================================================================================\n');

  console.log('--------------------------------------------------------------------------------');
  console.log('[SECTION 1. 매장 기본 식별 & 인프라 정보 (Identity & Location)]');
  console.log('--------------------------------------------------------------------------------');
  console.log(`• 상호명 (name):                 ${base.name}`);
  console.log(`• 카테고리 (category):           ${base.category}`);
  console.log(`• 카테고리 코드 (categoryCode):   ${base.categoryCode}`);
  console.log(`• 카테고리 코드 리스트:           ${JSON.stringify(base.categoryCodeList)}`);
  console.log(`• 사이트 고유 식별자 (siteId):    ${base.siteId}`);
  console.log(`• 지역 법정동 코드 (rcode):       ${base.rcode}`);
  console.log(`• 도로명 주소 (roadAddress):     ${base.roadAddress}`);
  console.log(`• 지번 주소 (address):           ${base.address}`);
  console.log(`• 찾아오는 길 (road / directions): ${base.road || '없음'}`);
  console.log(`• 일반 전화번호 (phone):          ${base.phone || '미등록'}`);
  console.log(`• 0507 가상 스마트콜:            ${base.virtualPhone || '미등록'}`);
  console.log(`• 모바일 폰 등록 여부:            ${base.hasMobilePhoneNumber ? '등록됨' : '미등록'}`);
  console.log(`• 지도 좌표 X (경도 lon):         ${base.coordinate?.x}`);
  console.log(`• 지도 좌표 Y (위도 lat):         ${base.coordinate?.y}`);
  console.log(`• 기본 지도 줌 레벨 (zoomLevel):  ${base.coordinate?.mapZoomLevel}`);
  console.log(`• 거리뷰 파노라마 ID:            ${base.streetPanorama?.__ref || '없음'}`);
  console.log(`• 네이버 톡톡 URL (talktalkUrl):  ${base.talktalkUrl || '미연동'}`);
  console.log(`• 네이버 챗봇 URL (chatBotUrl):   ${base.chatBotUrl || '미연동'}`);
  console.log(`• 네이버 블로그 연동 (naverBlog): ${JSON.stringify(base.naverBlog || '미연동')}`);
  console.log(`• 비즈니스 타입 (businessType):   ${base.missingInfo?.businessType || '일반'}`);
  console.log(`• 착한가격업소 여부 (isGoodStore): ${base.isGoodStore ? '선정업체' : '해당없음'}`);
  console.log(`• KTIS 등록 여부 (isKtis):        ${base.isKtis ? 'Y' : 'N'}`);

  console.log('\n--------------------------------------------------------------------------------');
  console.log('[SECTION 2. 상위노출 랭킹 알고리즘 정량 지표 (SEO & Algorithm Scores)]');
  console.log('--------------------------------------------------------------------------------');
  console.log(`• 방문자(영수증) 총 리뷰수:       ${base.visitorReviewsTotal}건`);
  console.log(`• 블로그 & 카페 총 리뷰수:        ${base.cafeBlogReviewsTotal}건`);
  console.log(`• 방문자 평점 스코어:             ${base.visitorReviewsScore || '비공개'} / 5.0`);
  console.log(`• 평점 리뷰 참여자 수:            ${reviewStats.ratingReviewsTotal || 0}명`);
  console.log(`• 정성 텍스트 리뷰 수:            ${base.visitorReviewsTextReviewTotal || 0}건`);
  console.log(`• 키워드 리뷰 총 투표 참여수:     ${voted.totalCount || 0}표`);
  console.log(`• 키워드 리뷰 참여 실 사용자수:   ${voted.userCount || 0}명`);
  console.log(`• 키워드 리뷰 작성 건수:          ${voted.reviewCount || 0}건`);
  console.log(`• 스마트콜(0507) 연동 가산점:     ${base.virtualPhone ? '가산점 획득 (연동됨)' : '미연동'}`);
  console.log(`• 네이버 톡톡(실시간) 연동 가산점: ${base.talktalkUrl ? '가산점 획득 (연동됨)' : '미연동'}`);
  console.log(`• 대표 사진 등록 수:              ${photos.length}장`);
  console.log(`• 메뉴 및 상품 등록 수:           ${menus.length}개`);
  console.log(`• 대표 한줄평 요약 (microReviews): ${JSON.stringify(base.microReviews || [])}`);

  console.log('\n--------------------------------------------------------------------------------');
  console.log('[SECTION 3. 소비자 키워드 리뷰 전수 데이터 (Voted Keywords Full List)]');
  console.log('--------------------------------------------------------------------------------');
  console.log(`총 ${votedDetails.length}개 소비자 평가 키워드 득표 내역:`);
  votedDetails.forEach((k, idx) => {
    console.log(`   ${String(idx + 1).padStart(2, ' ')}. [${k.displayName}] - ${k.count}표 (코드: ${k.code}, 아이콘: ${k.iconCode})`);
  });

  console.log('\n--------------------------------------------------------------------------------');
  console.log('[SECTION 4. 등록 메뉴 & 가격 & 설명 전수 리스트 (Menu Catalog)]');
  console.log('--------------------------------------------------------------------------------');
  console.log(`총 ${menus.length}개 등록 메뉴 전수 데이터:`);
  menus.forEach((m, idx) => {
    const isRec = m.recommend ? '⭐ [대표추천]' : '  ';
    const priceStr = m.price ? `${Number(m.price).toLocaleString()}원` : '가격표기없음';
    console.log(`   ${String(idx + 1).padStart(2, ' ')}. ${isRec} ${m.name} : ${priceStr}`);
    if (m.description) {
      console.log(`       설명: "${m.description}"`);
    }
    if (m.images && m.images.length > 0) {
      console.log(`       사진: ${m.images[0]}`);
    }
  });

  console.log('\n--------------------------------------------------------------------------------');
  console.log('[SECTION 5. 편의시설, 서비스 및 결제 수단 (Amenities & Payments)]');
  console.log('--------------------------------------------------------------------------------');
  console.log(`• 제공 편의시설 (${base.conveniences?.length || 0}개):`);
  console.log(`  ${base.conveniences?.join(' | ') || '없음'}`);
  console.log(`• 지원 결제수단 (${base.paymentInfo?.length || 0}개):`);
  console.log(`  ${base.paymentInfo?.join(' | ') || '없음'}`);

  console.log('\n--------------------------------------------------------------------------------');
  console.log('[SECTION 6. 등록 대표 이미지 갤러리 메타데이터 (Media Assets)]');
  console.log('--------------------------------------------------------------------------------');
  console.log(`총 ${photos.length}개 상단 대표 사진 목록:`);
  photos.forEach((p, idx) => {
    console.log(`   ${idx + 1}. [${p.mediaSource || '업체'}] ${p.width}x${p.height}px | URL: ${p.thumbnailUrl}`);
  });

  console.log('\n--------------------------------------------------------------------------------');
  console.log('[SECTION 7. 매장 누락 정보 감사 진단 (Missing Info Audit)]');
  console.log('--------------------------------------------------------------------------------');
  if (base.missingInfo) {
    console.log(`• 영업시간 정보 누락 여부 (isBizHourMissing):       ${base.missingInfo.isBizHourMissing ? '⚠️ 누락됨 (보완필요)' : '정상 등록'}`);
    console.log(`• 메뉴 사진 누락 여부 (isMenuImageMissing):         ${base.missingInfo.isMenuImageMissing ? '⚠️ 누락됨 (보완필요)' : '정상 등록'}`);
    console.log(`• 찾아오는길 정보 누락 여부 (isAccessorMissing):    ${base.missingInfo.isAccessorMissing ? '⚠️ 누락됨' : '정상 등록'}`);
    console.log(`• 소개글 누락 여부 (isDescriptionMissing):          ${base.missingInfo.isDescriptionMissing ? '⚠️ 누락됨 (보완필요)' : '정상 등록'}`);
    console.log(`• 편의시설 누락 여부 (isConveniencesMissing):       ${base.missingInfo.isConveniencesMissing ? '⚠️ 누락됨' : '정상 등록'}`);
    console.log(`• 스마트플레이스 개선 권장 배너 필요성:             ${base.missingInfo.needLargeSuggestionBanner ? '개선 권장 대상' : '우수 관리'}`);
  }
  console.log('================================================================================\n');
}

extractRawFullData(placeId);
