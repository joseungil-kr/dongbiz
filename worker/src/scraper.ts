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

    // §7.14→실사용 버그로 확정(2026-09-08): <a href> DOM 순서는 실제 순위와 다를 수 있다
    // (1위 업체가 4위로 잘못 집계된 실제 사례 확인, href 스캔은 순서가 뒤섞이고 무관한
    // 업체가 섞여 들어오기까지 함). 검색 API 응답이 그대로 박힌 ROOT_QUERY의
    // PlaceListBusinesses.items 배열이 진짜 순위 그대로이므로 이걸 최우선으로 쓴다.
    // (광고/'새로 오픈했어요' 캐러셀은 이 배열과 별개의 구조라 애초에 안 섞여 있었음 —
    // 실측으로 nop_res doc-id와 겹치는 항목 0건 확인.)
    // §7.15 잔여 한계(2026-09-08, 이 파싱 방식과 무관): 지역명이 없는 업종 키워드(예:
    // "인형병원")는 이 items 배열 자체가 요청자 IP의 지역(GeoIP)에 따라 다르게 옴이 실측
    // 확인됨 — 같은 키워드를 안산 IP에서 조회하면 안산 업체가 1위, Cloudflare Worker의
    // 데이터센터 IP에서 조회하면 다른 순서로 옴(URL에 x/y 좌표를 실어도 안 바뀜, 쿠키/서버
    // 사이드 GeoIP 기반으로 추정). "안산맛집"처럼 지역명이 박힌 키워드는 이 영향이 훨씬
    // 적을 것으로 추정(미검증). 완전한 해결책 없음 — 사용자에게는 "가능하면 지역명을 포함한
    // 키워드로 진단하라"고 안내하는 게 현재로선 최선.
    const anchorIdx = html.indexOf('"__typename":"PlaceListBusinesses"');
    if (anchorIdx !== -1) {
      const itemsKeyIdx = html.indexOf('"items":[', anchorIdx);
      if (itemsKeyIdx !== -1) {
        const start = itemsKeyIdx + '"items":['.length;
        const end = html.indexOf(']', start);
        const itemsBlock = html.slice(start, end);
        // §7.4: 같은 placeId가 두 번 나올 수 있다. href 스캔 폴백에는 seen 셋이 있었는데
        // JSON 우선으로 바꾸면서(§7.15) 이 방어가 빠져 있었다 — 중복이 그대로 순위가 되어
        // 같은 업체가 두 줄로 보이는 원인이 된다.
        const ids = [...new Set([...itemsBlock.matchAll(/PlaceListBusinessesItem:(\d+)/g)].map(m => m[1]))];
        if (ids.length > 0) return ids.slice(0, limit);
      }
    }

    // 폴백: 위 JSON 구조를 못 찾았을 때만(네이버 구조 변경 대비) 기존 href 스캔 방식 사용.
    // §7.13: '새로 오픈했어요' 캐러셀(최근 3개월 이내 개업 홍보 카드, 오가닉 순위 아님)에
    // 포함된 업체는 data-nop_res-doc-id="{placeId}" 속성으로 명확히 표시된다.
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

  // 사진 키는 출처가 접미사로 붙어 있다: _business_N(업체 등록) / _clip_N(클립 영상) / _visitor_N(방문자 리뷰).
  // ⚠️ _clip_ 은 thumbnailUrl이 clip-service 호스트인데 외부에서 부르면 **404**다(실측).
  //    그대로 담으면 공유 OG 이미지·진단 화면 대표사진이 깨진다 — 실제로 2번째 항목이 그랬다.
  // 업체가 직접 등록한 사진을 앞에 두고, 방문자 사진을 뒤에 붙인다. 클립은 버린다.
  // photoKeys는 사진 수(photoCount) 폴백으로도 쓰이므로 **거르지 않는다** — 여기서 빼면
  // 지표가 조용히 달라진다. 표시용 목록에서만 클립을 제외한다.
  const photoKeys = keys.filter(k => k.startsWith(`PlaceDetailTopPhotoItem:${placeId}`));
  const photoRank = (k: string) => (k.includes('_business_') ? 0 : 1);
  const samplePhotos = photoKeys
    .filter(k => !k.includes('_clip_'))
    .sort((a, b) => photoRank(a) - photoRank(b))
    .map(k => state[k]?.thumbnailUrl)
    .filter(Boolean);

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
      saveCount: parseSaveCount(base.saveCount) ?? null,
      bookmarkCount: parseSaveCount(base.bookmarkCount) ?? null,
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

// ─────────────────────────────────────────────────────────────────────────────
// pcmap 목록 수집 (§9.10). 리버스 엔지니어링용 "너비" 수집기.
//
// 통합검색 위젯은 상위 6곳만 보여주고(§7.10) 지표도 개별 페이지를 다시 긁어야 얻는다.
// pcmap 목록은 **한 번의 요청으로 50곳 이상 + 지표까지** 준다. 표본이 9배가 되고
// 요청 수는 1/8로 준다. 광고도 타입으로 분리돼 있어 §7.5의 취약한 패턴 판별이 필요 없다.
//
// ⚠️ 실측 경고: 빠르게 6회 연달아 호출했더니 **429**를 맞았다(2026-09-09). 호출 간격을
// 반드시 두고, 한 실행에서 몰아치지 말 것. 페이지에 ncaptcha 스크립트도 박혀 있다(§7.7).
// ─────────────────────────────────────────────────────────────────────────────

/** 정렬 축. 업종마다 지원 목록이 다르다 — restaurant만 saved, hairshop은 revisit이 있다. */
export type SortMode = 'popular' | 'saved' | 'trendy' | 'revisit' | 'reviewTotalCount';

export interface PlaceListItem {
  placeId: string;
  name: string;
  category: string | null;
  rank: number;
  isAd: boolean;
  saveCountRaw: string | null;   // "24,000+" 원문
  saveCountMin: number | null;   // 24000 — 분석용 하한값
  visitorReviewCount: number | null;
  blogCafeReviewCount: number | null;
  totalReviewCount: number | null;
  imageCount: number | null;
  hasBooking: boolean | null;
  hasTalktalk: boolean | null;
  roadAddress: string | null;
}

/**
 * "~100" / "24,000+" / "700+" 형태를 분석 가능한 하한값으로 바꾼다.
 * 반올림된 구간값이라 정확한 수가 아니다 — 비교·추세용으로만 쓸 것.
 */
function parseSaveCount(raw: unknown): number | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 키워드 1개의 목록을 정렬 축 1개로 수집한다.
 * `category`는 pcmap 경로다 — 'restaurant' | 'hairshop' | 'place' 등.
 */
export async function getPlaceList(
  keyword: string,
  { category = 'restaurant', sort = 'popular' as SortMode, limit = 50 } = {},
): Promise<PlaceListItem[]> {
  const params = new URLSearchParams({ query: keyword });
  // popular는 기본값이라 파라미터를 붙이지 않는다(붙이면 빈 결과가 오는 경우가 있다).
  if (sort !== 'popular') params.set('sortingOrder', sort);

  const url = `https://pcmap.place.naver.com/${category}/list?${params}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://map.naver.com/',
    'Accept-Language': 'ko-KR,ko;q=0.9',
  };

  // 429는 잠깐 쉬면 풀린다. 한 번만 더 시도하고, 그래도 막히면 호출부가 알 수 있게 던진다
  // — 조용히 빈 배열을 돌려주면 "수집 완료"라고 표시되면서 데이터만 비는 사고가 난다(실제로 겪음).
  let res = await fetch(url, { headers });
  if (res.status === 429) {
    await new Promise(resolve => setTimeout(resolve, 15000));
    res = await fetch(url, { headers });
  }
  if (!res.ok) throw new Error(`pcmap 목록 조회 실패 (HTTP ${res.status})`);

  const html = await res.text();
  const start = html.indexOf('window.__APOLLO_STATE__ = ');
  if (start < 0) throw new Error('APOLLO_STATE 없음 — 차단되었거나 구조가 바뀌었다');

  // 중괄호 균형으로 JSON 끝을 찾는다. 정규식으로 자르면 본문에 }가 섞여 깨진다.
  const from = html.indexOf('{', start);
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) throw new Error('APOLLO_STATE 파싱 실패');

  const state = JSON.parse(html.slice(from, end)) as Record<string, any>;

  // ⚠️ §7.15 교훈: 표시 순서를 추측하지 않는다. 여기서는 객체 키 순서가 실제 순위와
  // 일치함을 상위 6곳으로 실측 확인했으나, 권위 있는 순서 배열을 찾기 전까지
  // **깊은 순위는 신뢰하지 말 것**. 광고(RestaurantAdSummary 등)는 순위에서 제외한다.
  const items: PlaceListItem[] = [];
  for (const value of Object.values(state)) {
    if (!value || typeof value !== 'object') continue;
    const type = (value as any).__typename;
    if (typeof type !== 'string' || !('saveCount' in value || 'visitorReviewCount' in value)) continue;
    const isAd = /Ad(Summary|Item)$/.test(type);
    if (!(value as any).id || !(value as any).name) continue;

    items.push({
      placeId: String((value as any).id),
      name: (value as any).name,
      category: (value as any).category ?? null,
      rank: 0, // 아래에서 오가닉만 다시 매긴다
      isAd,
      saveCountRaw: (value as any).saveCount ?? null,
      saveCountMin: parseSaveCount((value as any).saveCount),
      visitorReviewCount: toInt((value as any).visitorReviewCount),
      blogCafeReviewCount: toInt((value as any).blogCafeReviewCount),
      totalReviewCount: toInt((value as any).totalReviewCount),
      imageCount: toInt((value as any).imageCount),
      hasBooking: (value as any).hasBooking ?? null,
      hasTalktalk: (value as any).talktalkUrl ? true : false,
      roadAddress: (value as any).roadAddress ?? null,
    });
  }

  let organicRank = 0;
  for (const item of items) if (!item.isAd) item.rank = ++organicRank;

  return items.filter(i => !i.isAd).slice(0, limit);
}
