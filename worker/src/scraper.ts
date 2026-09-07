/**
 * 네이버 스마트플레이스 전수 지표 스크래퍼 (Rank & SEO Metrics Extractor)
 * Cloudflare Worker 환경용 (Fetch API 호환)
 *
 * 기술 함정은 작업지시서.md §7 참조. 여기서 수정한 실수를 반복하지 말 것.
 */

const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

/**
 * 키워드 검색 시 오가닉 순위 1~limit위 placeId 목록을 순위 순서대로 반환.
 * §7.4 동일 업체가 상단 카드 + 하단 피드에 중복 노출되므로 Set으로 제거.
 * §7.5 '광고' 텍스트 매칭은 리뷰 본문 오탐을 유발하므로 제외, ico_ad/sp_ad 클래스만 신뢰.
 */
export async function getOrganicRanking(keyword: string, limit = 14): Promise<string[]> {
  try {
    const searchUrl = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(keyword)}`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': UA_DESKTOP }
    });
    const html = await res.text();

    // §7.13: '새로 오픈했어요' 캐러셀(최근 3개월 이내 개업 홍보 카드, 오가닉 순위 아님)에
    // 포함된 업체는 data-nop_res-doc-id="{placeId}" 속성으로 명확히 표시된다. 이 캐러셀이
    // 순위 리스트 중간에 끼어들면서 절반 이상이 홍보 카드로 오염되는 사례가 실사용에서 확인됨
    // (14개 중 9개가 이 캐러셀이었던 사례 있음). 반드시 제외할 것.
    const nopIds = new Set([...html.matchAll(/data-nop_res-doc-id="(\d+)"/g)].map(m => m[1]));

    const regex = /href="(https?:\/\/map\.naver\.com\/p\/(?:search\/[^/]+\/place|entry\/place)\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    const seen = new Set<string>();
    const ranking: string[] = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (ranking.length >= limit) break;
      const id = match[2];
      if (seen.has(id)) continue;
      if (nopIds.has(id)) continue;

      const surrounding = html.slice(Math.max(0, match.index - 300), match.index + 300);
      const isAd = surrounding.includes('ico_ad') || surrounding.includes('sp_ad');
      if (isAd) continue;

      seen.add(id);
      ranking.push(id);
    }
    return ranking;
  } catch (err) {
    console.error('오가닉 순위 추출 에러:', err);
    return [];
  }
}

// includeFeed: 소식(/feed 탭) 조회 여부. 요청 1회가 늘어나므로 실제로 화면에 표시할
// 내 매장 조회 시에만 true로 켠다. 경쟁사 스크랩(최대 10~14회)에는 굳이 켜지 않는다.
export async function scrapeFullPlaceMetrics(queryOrId: string, includeFeed = false): Promise<any> {
  // 1단계: 플레이스 ID 만능 식별
  let placeId = queryOrId.toString().trim();

  if (/^[1-9]\d{6,11}$/.test(placeId)) {
    // 순수 ID
  }
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
  else if (placeId.includes('place/')) {
    const urlMatch = placeId.match(/place\/(\d+)/);
    if (urlMatch) {
      placeId = urlMatch[1];
    } else {
      throw new Error(`올바른 플레이스 URL이 아닙니다: ${queryOrId}`);
    }
  }
  else {
    const searchUrl = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(placeId)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'User-Agent': UA_DESKTOP,
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
      'User-Agent': UA_MOBILE,
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

  const baseKey = keys.find(k => k.startsWith(`PlaceDetailBase:${placeId}`));
  const base = state[baseKey || ''] || {};

  const reviewStatsKey = keys.find(k => k.startsWith(`VisitorReviewStatsResult:${placeId}`));
  const reviewStats = state[reviewStatsKey || ''] || {};
  const voteDetails = reviewStats?.analysis?.votedKeyword?.details || [];
  const topKeywords = voteDetails.map((item: any) => ({
    keyword: item.displayName,
    count: item.count,
    code: item.code
  }));

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

  const photoKeys = keys.filter(k => k.startsWith(`PlaceDetailTopPhotoItem:${placeId}`));
  const samplePhotos = photoKeys.map(k => state[k]?.thumbnailUrl).filter(Boolean);

  // ROOT_QUERY에서 keywordList, description, 이미지 총 개수, 소식 추출 (§7.1 __ref 포인터 해석)
  let keywordList: string[] = [];
  let rootDesc = '';
  let topPhotosTotal = photoKeys.length;
  let recentNews: string | null = null;
  // §7.8: base.cafeBlogReviewsTotal은 구버전 필드로 항상 0이 나오는 사례 확인됨.
  // 실제 값은 ROOT_QUERY.placeDetail.fsasReviews.total에 있음. base 값을 기본 폴백으로만 둔다.
  let cafeBlogReviewsTotal = base.cafeBlogReviewsTotal || 0;
  // §7.8: base.missingInfo.isBizHourMissing도 구버전 businessHours(항상 null)만 보고 판정하는 것으로
  // 추정됨. 실제 등록 여부는 ROOT_QUERY.placeDetail.newBusinessHours 배열로 직접 판별한다.
  let isBizHourMissing: boolean | null = null;
  let isOpenNow: boolean | null = null;
  // §질문4 A: 상위노출 영향 지표로 알려진 추가 필드들. 전부 pd(ROOT_QUERY.placeDetail) 하위에서 실측 확인됨.
  let hasReviewPenalty = false;
  let isNewOpening = false;
  let hasNaverBooking = false;
  let hasSmartOrder = false;
  let couponCount = 0;
  let reviewMediasTotal = 0;

  const rootQueryKey = keys.find(k => k === 'ROOT_QUERY');
  if (rootQueryKey) {
    const rootQuery = state[rootQueryKey];
    const pdKey = Object.keys(rootQuery).find(k => k.startsWith('placeDetail'));
    if (pdKey && rootQuery[pdKey]) {
      const pd = rootQuery[pdKey];
      rootDesc = pd.description || '';

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

      if (pd.fsasReviews) {
        const fsasRef = pd.fsasReviews.__ref;
        const fsas = fsasRef ? state[fsasRef] : pd.fsasReviews;
        if (fsas && typeof fsas.total === 'number') {
          cafeBlogReviewsTotal = fsas.total;
        }
      }

      const hours = pd.newBusinessHours || pd.businessHours;
      if (Array.isArray(hours)) {
        isBizHourMissing = hours.length === 0;
        if (hours.length > 0 && hours[0]?.businessStatusDescription?.status) {
          isOpenNow = hours[0].businessStatusDescription.status === '영업 중';
        }
      }

      hasReviewPenalty = Boolean(pd.visitorReviewPenalty);
      isNewOpening = Boolean(pd.newOpening);
      hasNaverBooking = Boolean(pd.naverBooking);
      hasSmartOrder = Boolean(pd.naverBooking?.hasSmartOrder);
      couponCount = pd.hasCoupon?.count || 0;
      reviewMediasTotal = pd.visitorReviewMediasTotal || 0;
    }
  }

  // §7.11: 소식(새소식) — 'BiznewsItem:'/'NewsItem:' 키는 네이버 데이터에 존재하지 않는 이름이었다
  // (검증 없이 작성된 스펙 오류로 추정, 실사용 리포트로 발견). 실제 데이터는 /home 탭에도 없고
  // 별도 /feed 탭에만 있으며, 키 접두사는 'Feed:{placeId}_{feedId}', 날짜는 createdString(YYYYMMDD).
  if (includeFeed) {
    try {
      const feedRes = await fetch(`https://m.place.naver.com/place/${placeId}/feed`, {
        headers: { 'User-Agent': UA_MOBILE, 'Accept': 'text/html,application/xhtml+xml' }
      });
      const feedHtml = await feedRes.text();
      const feedApolloMatch = feedHtml.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
      if (feedApolloMatch) {
        const feedState = JSON.parse(feedApolloMatch[1]);
        const feedItems = Object.keys(feedState)
          .filter(k => k.startsWith('Feed:'))
          .map(k => feedState[k])
          // type 'FEED' = 매장이 직접 올린 소식/이벤트. 'BLOG' 등은 블로그 언급이라 제외.
          .filter((f: any) => f.type === 'FEED' && f.createdString)
          .sort((a: any, b: any) => Number(b.createdString) - Number(a.createdString));
        if (feedItems.length > 0) {
          const cs = feedItems[0].createdString; // YYYYMMDD
          recentNews = `${cs.slice(0, 4)}-${cs.slice(4, 6)}-${cs.slice(6, 8)}`;
        }
      }
    } catch (err) {
      console.error('소식(feed) 조회 에러:', err);
    }
  }

  // 네이버가 직접 제공하는 누락정보 감사 플래그. 단, isBizHourMissing은 위에서 실측한 값을 우선한다(§7.8).
  const missingInfo = base.missingInfo || {};

  return {
    placeId: placeId,
    placeUrl: `https://map.naver.com/p/entry/place/${placeId}`,
    name: base.name || null,
    category: base.category || null,
    phone: base.phone || base.virtualPhone || null, // B2: 스마트콜 전용 매장 폴백
    roadAddress: base.roadAddress || null,
    address: base.address || null,
    directions: base.road || null, // B1: base.directions는 존재하지 않는 필드였음
    coordinates: {
      x: base.coordinate?.x || null,
      y: base.coordinate?.y || null,
    },
    description: rootDesc || base.description || base.microReviews?.[0] || '',
    keywordList: keywordList,
    recentNewsDate: recentNews,
    seoMetrics: {
      visitorReviewsTotal: base.visitorReviewsTotal || 0,
      visitorReviewsScore: base.visitorReviewsScore || null,
      cafeBlogReviewsTotal: cafeBlogReviewsTotal, // §7.8: fsasReviews.total 우선 사용
      textReviewsTotal: base.visitorReviewsTextReviewTotal || 0,
      hasTalktalk: Boolean(base.talktalkUrl),
      hasSmartCall: Boolean(base.virtualPhone),
      photoCount: topPhotosTotal,
      menuCount: menus.length,
      totalVoteCount: reviewStats?.analysis?.votedKeyword?.totalCount || 0,
      descriptionLength: (rootDesc || base.description || '').length,
      // 상위노출 영향 지표로 알려진 추가 필드 (질문4 A그룹, pd 하위에서 실측 확인)
      hasReviewPenalty, // 리뷰 어뷰징 패널티 — 있으면 순위 강등 정설
      isNewOpening, // 신규오픈 부스팅 슬롯 대상 여부 (§7.13 '새로 오픈했어요' 캐러셀과 연결됨)
      hasNaverBooking, // 예약 연동 — 가산점 정설
      hasSmartOrder, // 네이버 주문(스마트오더) 연동
      couponCount, // 발행 쿠폰 수 — 노출 슬롯 우대
      reviewMediasTotal, // 사진 첨부 리뷰 수 (텍스트만 있는 리뷰보다 가중치 높다는 게 정설)
      isGoodStore: base.isGoodStore ?? null, // 네이버 "우수업체" 자체 판정 플래그
      isOpenNow, // 현재 영업중 여부 (newBusinessHours의 businessStatusDescription.status)
      // B3/§7.8: newBusinessHours 실측값 우선, 못 구하면 네이버 missingInfo 플래그로 폴백
      isBizHourMissing: isBizHourMissing ?? missingInfo.isBizHourMissing ?? null,
      isMenuImageMissing: missingInfo.isMenuImageMissing ?? null,
      isAccessorMissing: missingInfo.isAccessorMissing ?? null,
      isDescriptionMissing: missingInfo.isDescriptionMissing ?? null,
      isConveniencesMissing: missingInfo.isConveniencesMissing ?? null,
    },
    topRepKeywords: topKeywords,
    menus: menus,
    conveniences: base.conveniences || [],
    paymentMethods: base.paymentInfo || [],
    samplePhotos: samplePhotos.slice(0, 5)
  };
}
