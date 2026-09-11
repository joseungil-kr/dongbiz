import { naverHtml, collectionFailure, CollectionError } from './collection';

export interface PlaceCandidate {
  placeId: string;
  name: string;
  category: string | null;
  roadAddress: string | null;
  phone: string | null;
}
export interface SearchListing {
  items: PlaceCandidate[];
  source: 'naver-map';
  collectedAt: string;
  total: number | null;
  pages: number;
  limit: number;
  complete: boolean;
  stopReason: 'end' | 'limit' | 'collection_failed';
  errorCode?: string;
  sort: string | null;
}
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://map.naver.com/', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

/** Parse the JSON assignment, never evaluate third-party JavaScript. */
export function readPlaceState(html: string): Record<string, any> {
  const match = /__APOLLO_STATE__\s*=\s*\{/.exec(html);
  if (!match) throw collectionFailure('PARSE_CHANGED', 'list-state');
  const from = match.index + match[0].lastIndexOf('{');
  let depth = 0, quoted = false, escaped = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(from, i + 1)); }
      catch { break; }
    }
  }
  throw collectionFailure('PARSE_CHANGED', 'list-json');
}
const clean = (v: unknown) => typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim() : '';

/** ROOT_QUERY.placeList.businesses.items is ordered. Ad/new-opening arrays are separate. */
export function parseOrderedList(html: string, expectedStart?: number) {
  const state = readPlaceState(html);
  const entries = Object.entries(state.ROOT_QUERY || {}).filter(([key]) => key.startsWith('placeList('));
  let selected: any;
  let selectedInput: any;
  for (const [key, value] of entries) {
    let input: any;
    try { input = JSON.parse(key.slice(key.indexOf('(') + 1, -1)).input; } catch { continue; }
    if (!input || input.filterOpening || (expectedStart != null && Number(input.start) !== expectedStart)) continue;
    const result: any = (value as any)?.__ref ? state[(value as any).__ref] : value;
    const list = result?.businesses?.__ref ? state[result.businesses.__ref] : result?.businesses;
    if (!Array.isArray(list?.items)) continue;
    if (selected) throw collectionFailure('PARSE_CHANGED', 'list-ambiguous');
    selected = list; selectedInput = input;
  }
  if (!selected) throw collectionFailure('PARSE_CHANGED', 'list-order');
  const items: PlaceCandidate[] = [];
  const seen = new Set<string>();
  for (const ref of selected.items) {
    const row = ref?.__ref ? state[ref.__ref] : ref;
    if (!row?.id || !row?.name) throw collectionFailure('PARSE_CHANGED', 'list-item');
    if (/Ad(Summary|Item)$/.test(row.__typename || '') || row.isAd === true) continue;
    const placeId = String(row.id);
    if (seen.has(placeId)) continue;
    seen.add(placeId);
    items.push({ placeId, name: clean(row.normalizedName || row.name), category: clean(row.category) || null,
      roadAddress: clean(row.fullAddress || row.roadAddress || row.address) || null,
      phone: clean(row.phone || row.virtualPhone) || null });
  }
  return { items, total: typeof selected.total === 'number' ? selected.total : null,
    start: Number(selectedInput.start), display: Number(selectedInput.display), sort: selected.siteSort || null };
}

export function isStoreName(query: string): boolean {
  const text = query.trim();
  return !(/^[1-9]\d{6,11}$/.test(text) || /^0[\d\s()-]{7,}$/.test(text)
    || /^https?:\/\//i.test(text) || text.includes('naver.me') || text.includes('place/'));
}

export async function searchPlaceCandidates(query: string): Promise<PlaceCandidate[]> {
  const url = `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(query.trim())}`;
  return parseOrderedList(await naverHtml(url, 'candidates', HEADERS)).items;
}

// Observed in Naver's restaurantPcmapList bundle. The HTML route always resets
// start=1; later pages use this GraphQL operation. Request only list fields.
const LIST_QUERY = `query getRestaurantsPcmap($input: PlaceListInput) {
  restaurants: placeList(input: $input) {
    businesses { total siteSort items { __typename id name normalizedName fullAddress category phone virtualPhone } }
  }
}`;
export async function fetchOrderedPage(keyword: string, start: number) {
  const body = JSON.stringify([{ operationName: 'getRestaurantsPcmap', query: LIST_QUERY,
    variables: { input: { query: keyword, start, display: 50, deviceType: 'pcmap', isPcmap: true } } }]);
  const raw = await naverHtml('https://pcmap-api.place.naver.com/graphql', 'rank-list',
    { ...HEADERS, 'Content-Type': 'application/json', Referer: 'https://pcmap.place.naver.com/' }, false, body);
  let response: any;
  try { response = JSON.parse(raw); } catch { throw collectionFailure('PARSE_CHANGED', 'list-api-json'); }
  const result = Array.isArray(response) ? response[0] : response;
  const list = result?.data?.restaurants?.businesses;
  if (result?.errors?.length || !Array.isArray(list?.items)) throw collectionFailure('PARSE_CHANGED', 'list-api');
  const seen = new Set<string>();
  const items: PlaceCandidate[] = [];
  for (const row of list.items) {
    if (!row?.id || !row?.name) throw collectionFailure('PARSE_CHANGED', 'list-api-item');
    if (/Ad(Summary|Item)$/.test(row.__typename || '') || row.isAd === true) continue;
    const placeId = String(row.id);
    if (seen.has(placeId)) throw collectionFailure('PARSE_CHANGED', 'list-api-duplicate');
    seen.add(placeId);
    items.push({ placeId, name: clean(row.normalizedName || row.name), category: clean(row.category) || null,
      roadAddress: clean(row.fullAddress) || null, phone: clean(row.phone || row.virtualPhone) || null });
  }
  return { items, display: 50, sort: list.siteSort || null, total: typeof list.total === 'number' ? list.total : null };
}

/** Bounded sequential pages, no guessed rank from object insertion order. */
export async function collectSearchListing(keyword: string, category = 'place', limit = 350): Promise<SearchListing> {
  if (!['place', 'restaurant', 'hairshop'].includes(category)) throw new Error('Unsupported listing category');
  limit = Math.min(350, Math.max(50, limit));
  const out: SearchListing = { items: [], source: 'naver-map', collectedAt: new Date().toISOString(),
    total: null, pages: 0, limit, complete: false, stopReason: 'limit', sort: null };
  const ids = new Set<string>();
  for (let start = 1; start <= limit; start += 50) {
    if (start > 1) await new Promise(resolve => setTimeout(resolve, 5000));
    try {
      const page = await fetchOrderedPage(keyword.trim(), start);
      // The provider may return an empty terminal page with total=0 and no sort.
      // Keep the advertised total and do not label a provider cap as a failure.
      if (!page.items.length) {
        out.pages++;
        if (out.total == null) out.total = page.total;
        out.complete = out.total === out.items.length;
        out.stopReason = 'end';
        break;
      }
      if (page.display !== 50 || (out.pages && page.sort !== out.sort)) throw collectionFailure('PARSE_CHANGED', 'list-page-consistency');
      // Overlapping pages could be ignored pagination or live reordering. Do not invent ranks after the gap.
      if (page.items.some(item => ids.has(item.placeId))) throw collectionFailure('PARSE_CHANGED', 'list-page-overlap');
      out.pages++; out.total = page.total; out.sort = page.sort;
      for (const item of page.items) { ids.add(item.placeId); out.items.push(item); }
      if (page.items.length < 50 || (page.total != null && out.items.length >= page.total)) {
        out.complete = page.total != null && out.items.length >= page.total;
        out.stopReason = 'end'; break;
      }
    } catch (err) {
      if (!out.items.length) throw err;
      out.stopReason = 'collection_failed';
      out.errorCode = err instanceof CollectionError ? err.code : 'UNKNOWN';
      break;
    }
  }
  return out;
}
