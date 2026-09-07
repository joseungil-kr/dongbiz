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
    const regex = /href="(https?:\/\/map\.naver\.com\/p\/(?:search\/[^/]+\/place|entry\/place)\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    const seen = new Set<string>();
    const ranking: string[] = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (ranking.length >= limit) break;
      const id = match[2];
      if (seen.has(id)) continue;

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

export async function scrapeFullPlaceMetrics(queryOrId: string): Promise<any> {
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
    }
  }

  // 소식 (Biznews) 체크
  const newsKeys = keys.filter(k => k.startsWith('BiznewsItem:') || k.startsWith('NewsItem:'));
  if (newsKeys.length > 0) {
    const firstNews = state[newsKeys[0]];
    if (firstNews && (firstNews.createdTs || firstNews.createDate || firstNews.date)) {
      recentNews = firstNews.createdTs || firstNews.createDate || firstNews.date;
    }
  }

  // 네이버가 직접 제공하는 누락정보 감사 플래그 (추측 대신 실제 필드 사용)
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
      cafeBlogReviewsTotal: base.cafeBlogReviewsTotal || 0,
      textReviewsTotal: base.visitorReviewsTextReviewTotal || 0,
      hasTalktalk: Boolean(base.talktalkUrl),
      hasSmartCall: Boolean(base.virtualPhone),
      photoCount: topPhotosTotal,
      menuCount: menus.length,
      totalVoteCount: reviewStats?.analysis?.votedKeyword?.totalCount || 0,
      // B3: 추측(menuCount>0 등) 대신 네이버가 실제로 내려주는 누락정보 플래그를 그대로 사용
      isBizHourMissing: missingInfo.isBizHourMissing ?? null,
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
