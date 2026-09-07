/**
 * 네이버 스마트플레이스 전수 지표 스크래퍼 완성본 (Rank & SEO Metrics Extractor)
 */
export async function scrapeFullPlaceMetrics(queryOrId) {
  // 1단계: 플레이스 ID 만능 식별 (고유번호, 플레이스URL, naver.me 단축URL, 일반전화/스마트콜, 상호명)
  let placeId = queryOrId.toString().trim();

  // A. 순수 숫자 ID (7~12자리) 입력된 경우 (예: 35915385, 1785101394, 2058645213)
  // 단, 지역번호로 시작하는 일반 전화번호(02, 031, 010 등 0으로 시작)는 제외
  if (/^[1-9]\d{6,11}$/.test(placeId)) {
    // 순수 ID로 간주
  }
  // B. 네이버 단축 URL (예: https://naver.me/FE3ghnOU)
  else if (placeId.includes('naver.me')) {
    const headRes = await fetch(placeId, { redirect: 'manual' });
    const location = headRes.headers.get('location') || '';
    const locMatch = location.match(/place\/(\d+)/);
    if (locMatch) {
      placeId = locMatch[1];
    } else {
      throw new Error(`유효하지 않은 단축 URL입니다: ${queryOrId}`);
    }
  }
  // C. 플레이스 상세 URL (예: https://map.naver.com/p/entry/place/1785101394)
  else if (placeId.includes('place/')) {
    const urlMatch = placeId.match(/place\/(\d+)/);
    if (urlMatch) {
      placeId = urlMatch[1];
    } else {
      throw new Error(`올바른 플레이스 URL이 아닙니다: ${queryOrId}`);
    }
  }
  // D. 전화번호 또는 상호명 검색
  else {
    const searchUrl = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(placeId)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });
    const searchHtml = await searchRes.text();
    const match = searchHtml.match(/https?:\/\/map\.naver\.com\/p\/(?:search\/[^/]+\/place|entry\/place)\/(\d+)/i) || 
                  searchHtml.match(/https?:\/\/map\.naver\.com\/v5\/entry\/place\/(\d+)/i) ||
                  searchHtml.match(/data-cid="(\d+)"/i) ||
                  searchHtml.match(/place\/(\d+)/i);
    if (!match) {
      throw new Error(`스마트플레이스를 찾을 수 없습니다: ${queryOrId}`);
    }
    placeId = match[1];
  }

  // 2단계: 플레이스 상세 홈 HTML 패치
  const homeUrl = `https://m.place.naver.com/place/${placeId}/home`;
  const res = await fetch(homeUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      'Accept': 'text/html,application/xhtml+xml',
    }
  });

  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if (!apolloMatch) {
    throw new Error('플레이스 상태 데이터를 추출할 수 없습니다.');
  }

  const state = JSON.parse(apolloMatch[1]);
  const keys = Object.keys(state);

  // 1. 기본 상세 데이터
  const baseKey = keys.find(k => k.startsWith(`PlaceDetailBase:${placeId}`));
  const base = state[baseKey] || {};

  // 2. 방문자 키워드 리뷰 분석 (analysis.votedKeyword.details)
  const reviewStatsKey = keys.find(k => k.startsWith(`VisitorReviewStatsResult:${placeId}`));
  const reviewStats = state[reviewStatsKey] || {};
  const voteDetails = reviewStats?.analysis?.votedKeyword?.details || [];
  const topKeywords = voteDetails.map(item => ({
    keyword: item.displayName,
    count: item.count,
    code: item.code
  }));

  // 3. 메뉴 리스트 추출
  const menuKeys = keys.filter(k => k.startsWith(`Menu:${placeId}`));
  const menus = menuKeys.map(k => {
    const m = state[k];
    return {
      name: m.name,
      price: m.price ? Number(m.price) : null,
      isRecommend: Boolean(m.recommend),
      description: m.description || null
    };
  });

  // 4. 등록 이미지 수량 및 썸네일
  const photoKeys = keys.filter(k => k.startsWith(`PlaceDetailTopPhotoItem:${placeId}`));
  const samplePhotos = photoKeys.map(k => state[k]?.thumbnailUrl).filter(Boolean);

  // 5. ROOT_QUERY에서 keywordList, description 등 추출 (Apollo __ref 해결)
  let keywordList = [];
  let rootDesc = '';
  let topPhotosTotal = photoKeys.length;
  let recentNews = null;

  const rootQueryKey = keys.find(k => k === 'ROOT_QUERY');
  if (rootQueryKey) {
    const rootQuery = state[rootQueryKey];
    const pdKey = Object.keys(rootQuery).find(k => k.startsWith('placeDetail'));
    if (pdKey && rootQuery[pdKey]) {
      const pd = rootQuery[pdKey];
      rootDesc = pd.description || '';
      
      // 이미지 총 개수
      if (pd.topPhotos) {
        if (pd.topPhotos.__ref) {
          topPhotosTotal = state[pd.topPhotos.__ref]?.total || photoKeys.length;
        } else {
          topPhotosTotal = pd.topPhotos.total || photoKeys.length;
        }
      } else if (pd.images) {
        if (pd.images.__ref) {
          topPhotosTotal = state[pd.images.__ref]?.totalImages || photoKeys.length;
        } else {
          topPhotosTotal = pd.images.totalImages || photoKeys.length;
        }
      }
      
      if (pd.informationTab) {
        const infoTab = pd.informationTab;
        const infoRef = infoTab.__ref || infoTab;
        const infoObj = typeof infoRef === 'string' ? state[infoRef] : infoRef;
        keywordList = infoObj?.keywordList || [];
      }
    }
  }

  // 6. 소식 (Biznews) 체크
  const newsKeys = keys.filter(k => k.startsWith('BiznewsItem:') || k.startsWith('NewsItem:'));
  if (newsKeys.length > 0) {
    const firstNews = state[newsKeys[0]];
    if (firstNews && (firstNews.createdTs || firstNews.createDate || firstNews.date)) {
      recentNews = firstNews.createdTs || firstNews.createDate || firstNews.date;
    }
  }

  // 종합 리포트 객체 조립
  const metrics = {
    placeId: placeId,
    placeUrl: `https://map.naver.com/p/entry/place/${placeId}`,
    name: base.name,
    category: base.category,
    phone: base.phone || base.virtualPhone || null,
    roadAddress: base.roadAddress,
    address: base.address,
    directions: base.road || null,
    coordinates: {
      x: base.coordinate?.x || null,
      y: base.coordinate?.y || null,
    },
    description: rootDesc || base.description || base.microReviews?.[0] || '',
    keywordList: keywordList,
    recentNewsDate: recentNews,

    seoMetrics: {
      visitorReviewsTotal: base.visitorReviewsTotal || 0,        // 방문자(영수증) 리뷰 총수
      visitorReviewsScore: base.visitorReviewsScore || null,     // 방문자 리뷰 평점 (예: 4.68)
      cafeBlogReviewsTotal: base.cafeBlogReviewsTotal || 0,      // 블로그/카페 리뷰 총수
      textReviewsTotal: base.visitorReviewsTextReviewTotal || 0, // 텍스트 리뷰 수
      hasTalktalk: Boolean(base.talktalkUrl),                    // 톡톡 상담 연동 여부
      hasSmartCall: Boolean(base.virtualPhone),                  // 0507 스마트콜 연동 여부
      photoCount: topPhotosTotal,                                // 상단 등록 사진 수 (실제 전체 개수)
      menuCount: menus.length,                                   // 등록된 메뉴/서비스 수
      totalVoteCount: reviewStats?.analysis?.votedKeyword?.totalCount || 0, // 키워드 리뷰 총 투표수
    },

    topRepKeywords: topKeywords,
    menus: menus,
    conveniences: base.conveniences || [],
    paymentMethods: base.paymentInfo || [],
    samplePhotos: samplePhotos.slice(0, 5)
  };

  return metrics;
}

// 직접 실행 테스트
const target = process.argv[2] || '0314070103';
scrapeFullPlaceMetrics(target)
  .then(data => {
    console.log('\n========================================================');
    console.log(`📊 [네이버 스마트플레이스 상위노출 지표 전수 수집 성공!]`);
    console.log('========================================================');
    console.log(`1. 매장 기본정보`);
    console.log(`   • 상호: ${data.name} (${data.category})`);
    console.log(`   • 주소: ${data.roadAddress} (${data.address})`);
    console.log(`   • 전화번호: ${data.phone}`);
    console.log(`   • 찾아오는 길: ${data.directions || '없음'}`);
    console.log(`   • 지도 좌표: (${data.coordinates.x}, ${data.coordinates.y})`);
    console.log(`--------------------------------------------------------`);
    console.log(`2. 플레이스 상위노출 핵심 스코어 & 지표 (Rank Metrics)`);
    console.log(`   • 방문자(영수증) 리뷰:  ${data.seoMetrics.visitorReviewsTotal}건`);
    console.log(`   • 블로그/카페 리뷰:     ${data.seoMetrics.cafeBlogReviewsTotal}건`);
    console.log(`   • 평점 스코어:          ${data.seoMetrics.visitorReviewsScore || '비공개'} / 5.0`);
    console.log(`   • 실제 텍스트 리뷰:     ${data.seoMetrics.textReviewsTotal}건`);
    console.log(`   • 키워드 리뷰 총 투표수: ${data.seoMetrics.totalVoteCount}표`);
    console.log(`   • 네이버 톡톡 연동:     ${data.seoMetrics.hasTalktalk ? '연동됨 (상위노출 가산점)' : '미연동'}`);
    console.log(`   • 0507 스마트콜:        ${data.seoMetrics.hasSmartCall ? '연동됨 (통화 가산점)' : '미연동'}`);
    console.log(`   • 등록된 메뉴 수:       ${data.seoMetrics.menuCount}개`);
    console.log(`   • 등록 사진 수:         ${data.seoMetrics.photoCount}장`);
    console.log(`--------------------------------------------------------`);
    console.log(`3. 소비자들이 뽑은 매장 대표 키워드 TOP 7 (SEO 키워드 추출용)`);
    data.topRepKeywords.slice(0, 7).forEach((k, i) => {
      console.log(`   ${i + 1}. [${k.keyword}] - ${k.count}명 투표 (코드: ${k.code})`);
    });
    console.log(`--------------------------------------------------------`);
    console.log(`4. 등록 메뉴 및 가격표 (일부)`);
    data.menus.slice(0, 3).forEach(m => {
      console.log(`   • ${m.name}: ${m.price ? m.price.toLocaleString() + '원' : '가격문의'} ${m.isRecommend ? '(대표메뉴)' : ''}`);
    });
    console.log(`========================================================\n`);
  })
  .catch(err => console.error('에러 발생:', err.message));
