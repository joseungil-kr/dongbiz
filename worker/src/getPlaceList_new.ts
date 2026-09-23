export async function getPlaceList(
  keyword: string,
  { category = 'restaurant', sort = 'popular' as SortMode, limit = 300 } = {},
): Promise<PlaceListItem[]> {
  const items: PlaceListItem[] = [];
  const maxPage = Math.ceil(limit / 50);
  let organicRank = 0;
  
  for (let page = 1; page <= maxPage; page++) {
    const params = new URLSearchParams({ query: keyword });
    if (sort !== 'popular') params.set('sortingOrder', sort);
    if (page > 1) params.set('page', String(page));

    const url = `https://pcmap.place.naver.com/${category}/list?${params}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://map.naver.com/',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    };

    let res = await fetch(url, { headers });
    if (res.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 15000));
      res = await fetch(url, { headers });
    }
    if (!res.ok) throw new Error(`pcmap 목록 조회 실패 (HTTP ${res.status})`);

    const html = await res.text();
    const start = html.indexOf('window.__APOLLO_STATE__ = ');
    if (start < 0) break; // 더 이상 없거나 차단됨

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
    if (end < 0) break;

    const state = JSON.parse(html.slice(from, end)) as Record<string, any>;
    let foundOnPage = 0;

    for (const value of Object.values(state)) {
      if (!value || typeof value !== 'object') continue;
      const type = (value as any).__typename;
      if (typeof type !== 'string' || !('saveCount' in value || 'visitorReviewCount' in value)) continue;
      const isAd = /Ad(Summary|Item)$/.test(type);
      if (!(value as any).id || !(value as any).name) continue;
      
      // 중복 제거
      if (items.some(i => i.placeId === String((value as any).id))) continue;

      const item: PlaceListItem = {
        placeId: String((value as any).id),
        name: (value as any).name,
        category: (value as any).category ?? null,
        rank: 0,
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
        visitorReviewScore: Number((value as any).visitorReviewScore) || 0,
        x: (value as any).x ?? null,
        y: (value as any).y ?? null,
      };
      
      if (!isAd) item.rank = ++organicRank;
      items.push(item);
      foundOnPage++;
    }
    
    if (foundOnPage === 0 || organicRank >= limit) break;
  }

  return items.filter(i => !i.isAd).slice(0, limit);
}

