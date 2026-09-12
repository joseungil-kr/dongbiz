/**
 * 네이버 검색광고 API — 키워드 월간 검색량 (§6.5.7)
 *
 * 연관검색어는 ac.search.naver.com(무료)으로 이미 확보돼 있으므로 여기서는 검색량 숫자만 가져온다.
 * 시크릿 미설정 시 null을 반환한다 — 알림/캐시와 같은 패턴으로, 키가 없어도 기능은 그대로 동작한다.
 */

export interface SearchAdEnv {
  NAVER_AD_CUSTOMER_ID?: string;
  NAVER_AD_ACCESS_LICENSE?: string;
  NAVER_AD_SECRET_KEY?: string;
  CACHE?: KVNamespace;
  /** 조회한 검색량을 시계열로 남기기 위한 바인딩 (§9.12). 없으면 기록만 건너뛴다. */
  DB?: D1Database;
}

export interface KeywordVolume {
  keyword: string;
  pc: number;
  mobile: number;
  total: number;
  /** PC·모바일 중 하나라도 "< 10"이면 true — 고객 화면 프레임 분기용 */
  isUnderTen: boolean;
  /** 필드별 "< 10" 여부. 관리자 리포트는 이걸로 값 대신 "< 10"을 그대로 표기한다 */
  pcUnderTen: boolean;
  mobileUnderTen: boolean;
  /** 낮음 | 중간 | 높음 */
  competition: string | null;
}

/** 검색광고 API가 함께 돌려주는 연관 키워드까지 포함한 전용 도구 응답. */
export interface KeywordVolumeLookup {
  keyword: string;
  volume: KeywordVolume;
  related: KeywordVolume[];
}

const API_HOST = 'https://api.searchad.naver.com';
const PATH = '/keywordstool';
const CACHE_TTL = 86400; // 월간 검색량이라 하루 캐시로 충분
const MAX_HINTS = 5; // API가 한 번에 받는 hintKeywords 상한

/** API는 공백 없는 대문자를 기준으로 매칭한다. 이 정규화가 없으면 항상 미스가 난다. */
export function normalizeKeyword(keyword: string): string {
  return keyword.replace(/\s+/g, '').toUpperCase();
}
const normalize = normalizeKeyword;

/**
 * 검색광고 API는 10회 미만을 숫자가 아니라 "< 10" 문자열로 준다.
 * 0으로 깎으면 "수요 없음"으로 오독되므로 상한값 10을 쓰고 isUnderTen 플래그로 구분한다.
 */
function parseCount(raw: unknown): { value: number; underTen: boolean; valid: boolean } {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: raw, underTen: false, valid: true };
  const s = String(raw ?? '').trim();
  if (s.startsWith('<')) return { value: 10, underTen: true, valid: true };
  if (!s) return { value: 0, underTen: false, valid: false };
  const n = Number(s.replace(/,/g, ''));
  return { value: Number.isFinite(n) ? n : 0, underTen: false, valid: Number.isFinite(n) };
}

function toKeywordVolume(row: any): KeywordVolume | null {
  const keyword = String(row?.relKeyword ?? '').trim();
  const pc = parseCount(row?.monthlyPcQcCnt);
  const mobile = parseCount(row?.monthlyMobileQcCnt);
  if (!keyword || !pc.valid || !mobile.valid) return null;
  return {
    keyword,
    pc: pc.value,
    mobile: mobile.value,
    total: pc.value + mobile.value,
    isUnderTen: pc.underTen || mobile.underTen,
    pcUnderTen: pc.underTen,
    mobileUnderTen: mobile.underTen,
    competition: row.compIdx ?? null,
  };
}

async function sign(secret: string, ts: string, method: string, path: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${method}.${path}`));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/** 검색광고 API의 원본 응답을 검색량 형식으로 바꾼다. 인증·응답 오류는 호출부가 구분할 수 있게 던진다. */
async function fetchSearchAdRows(
  env: SearchAdEnv,
  keywords: string[],
): Promise<KeywordVolume[]> {
  const { NAVER_AD_CUSTOMER_ID: customer, NAVER_AD_ACCESS_LICENSE: license, NAVER_AD_SECRET_KEY: secret } = env;
  if (!customer || !license || !secret) throw new Error('SEARCH_AD_UNAVAILABLE');
  const ts = String(Date.now());
  const signature = await sign(secret, ts, 'GET', PATH);
  const hints = keywords.map(normalize).join(',');
  const res = await fetch(`${API_HOST}${PATH}?hintKeywords=${encodeURIComponent(hints)}&showDetail=1`, {
    headers: {
      'X-Timestamp': ts,
      'X-API-KEY': license,
      'X-Customer': customer,
      'X-Signature': signature,
    },
  });
  if (!res.ok) throw new Error(`SEARCH_AD_HTTP_${res.status}`);
  const body = (await res.json()) as { keywordList?: any[] };
  if (!Array.isArray(body.keywordList)) throw new Error('SEARCH_AD_INVALID_RESPONSE');
  return body.keywordList.map(toKeywordVolume).filter((row): row is KeywordVolume => !!row);
}

/** 힌트 5개 이하를 한 번에 조회. 기존 호출부에는 요청한 키워드만 반환한다. */
async function fetchBatch(env: SearchAdEnv, keywords: string[]): Promise<Map<string, KeywordVolume>> {
  const out = new Map<string, KeywordVolume>();
  try {
    const rows = await fetchSearchAdRows(env, keywords);
    const byKeyword = new Map(rows.map(row => [normalize(row.keyword), row]));
    for (const keyword of keywords) {
      const volume = byKeyword.get(normalize(keyword));
      if (volume) out.set(keyword, { ...volume, keyword });
    }
  } catch {
    // 검색량은 기존 진단·리포트의 부가 정보다 — 실패해도 전체를 죽이지 않는다.
  }
  return out;
}

/** 전용 검색량 페이지용: 요청 키워드와 검색광고 API의 관련 키워드를 함께 보존한다. */
export async function lookupKeywordVolume(env: SearchAdEnv, keyword: string): Promise<KeywordVolumeLookup | null> {
  const rows = await fetchSearchAdRows(env, [keyword]);
  const volume = rows.find(row => normalize(row.keyword) === normalize(keyword));
  if (!volume) return null;
  const seen = new Set<string>([normalize(volume.keyword)]);
  const related = rows.filter(row => {
    const key = normalize(row.keyword);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.total - a.total);
  return { keyword: volume.keyword, volume, related };
}

/**
 * 여러 키워드의 월간 검색량을 한 번에 조회한다. 결과에 없는 키워드는 null.
 * KV 캐시는 키워드 단위라 이미 조회된 것은 API 호출에 포함되지 않는다.
 */
export async function getKeywordVolumes(
  env: SearchAdEnv,
  keywords: string[],
  opts: { cache?: boolean; context?: string; relatedTo?: string } = {},
): Promise<Record<string, KeywordVolume | null>> {
  // KV도 subrequest로 잡힌다. 키워드 N개면 읽기 N + 쓰기 N이라 /api/gap처럼 한도(50)가
  // 빡빡한 경로에서는 캐시를 끄고 fetch 몇 번으로 끝내는 편이 안전하다.
  const useCache = opts.cache !== false && !!env.CACHE;
  const result: Record<string, KeywordVolume | null> = {};
  const unique = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  const missing: string[] = [];

  for (const keyword of unique) {
    result[keyword] = null;
    const hit = useCache ? await env.CACHE!.get(`searchad:v1:${normalize(keyword)}`, 'json') : null;
    if (hit) result[keyword] = hit as KeywordVolume;
    else missing.push(keyword);
  }

  const fresh: KeywordVolume[] = [];
  for (let i = 0; i < missing.length; i += MAX_HINTS) {
    const found = await fetchBatch(env, missing.slice(i, i + MAX_HINTS));
    for (const [keyword, volume] of found) {
      result[keyword] = volume;
      fresh.push(volume);
      if (useCache) await env.CACHE!.put(`searchad:v1:${normalize(keyword)}`, JSON.stringify(volume), { expirationTtl: CACHE_TTL });
    }
  }

  // 실제로 API를 새로 탄 것만 기록한다 (§9.12). 캐시 히트는 이미 남긴 값이라 중복이 된다.
  // 화면에 뿌리고 버리면 "검색량이 오른 뒤 순위가 올랐나"를 영영 물어볼 수 없다.
  await recordVolumes(env, fresh, opts.context, opts.relatedTo);
  return result;
}

/** 조회된 검색량을 keyword_volumes에 남긴다. 실패해도 조회 결과에는 영향을 주지 않는다. */
async function recordVolumes(env: SearchAdEnv, volumes: KeywordVolume[], context?: string, relatedTo?: string): Promise<void> {
  if (!env.DB || volumes.length === 0) return;
  try {
    await env.DB.batch(volumes.map(v => env.DB!.prepare(`
      INSERT INTO keyword_volumes (id, keyword, norm_keyword, pc, mobile, total, is_under_ten, competition, context, related_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), v.keyword, normalize(v.keyword),
      v.pc, v.mobile, v.total, v.isUnderTen ? 1 : 0, v.competition,
      context ?? null, relatedTo ?? null,
    )));
  } catch (err) {
    console.error('keyword_volumes 기록 실패:', err);
  }
}

/**
 * 네이버 자동완성 — 사람들이 그 상호를 실제로 어떻게 치는지 가져온다 (§6.3.1에서 쓰던 것과 같은 소스).
 * 키가 필요 없고 검색광고 API와 무관하다. 실패해도 빈 배열이라 호출부는 그냥 진행한다.
 */
export async function autocomplete(query: string): Promise<string[]> {
  try {
    const url = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(query)}&st=1&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&frm=nv`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: string[][][] };
    return (body.items?.[0] ?? []).map((entry) => entry[0]).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 상호 검색량은 상호 하나만 재면 크게 과소평가된다 (§6.8).
 * "백세보리밥 닭한마리"만 재면 140회지만, 실제로 사람들은 "안산 백세보리밥", "상록구 백세보리밥",
 * "백세닭한마리"처럼 나눠서 친다. 그 변형들을 모아 합산해야 실제 직접 검색 유입에 가까워진다.
 *
 * 변형 출처 2가지:
 *   ① 자동완성 — 실제로 입력되는 형태. 우리가 상상 못 한 조합이 여기서 나온다
 *   ② 지역명 조합 — 자동완성에 안 뜰 만큼 검색량이 적은 롱테일 보완
 */
/**
 * 상호에서 브랜드로 볼 토큰 하나를 뽑는다.
 *
 * ⚠️ 이건 **추정이지 판별이 아니다.** 한국 상호는 [브랜드][업종]도 있고([고기굽는방앗간][상록수역점])
 * [업종][브랜드]도 있다([인형수선][안나]). 첫 토큰을 잡으면 후자에서 업종어를 브랜드로 오인한다.
 * 네이버 카테고리로 걸러보려 했으나 '한식'·'육류,고기요리'처럼 넓어서 신호가 안 된다.
 * → 자동 판별을 포기하고, 이 토큰의 검색량은 **화면에서 기본 합산 제외**로 두고 사람이 켠다(§6.8.3).
 */
export function brandCore(name: string): string {
  return (name.split(/\s+/)[0] || name)
    .replace(/(본점|직영점|\d+호점|[가-힣]+역점|[가-힣]+점)$/, '')
    .trim();
}

export function brandVariants(name: string, region: string, fromAutocomplete: string[] = []): string[] {
  // ⚠️ 상호 토큰을 전부 조합하면 안 된다. "백세보리밥 닭한마리"에서 '닭한마리'를 쓰면
  // '안산닭한마리'(월 230회)가 생성되는데, 이건 안산에서 닭한마리집을 찾는 사람이지
  // 우리 매장을 찾는 사람이 아니다. 합계에 넣으면 그대로 과대계상이다(실측으로 확인).
  const core = brandCore(name);
  if (core.length < 2) return [name];

  // 주소에서 실제로 검색에 쓰이는 지역 토큰만: "경기도 안산시 상록구" → ['안산', '상록구'].
  // 광역 단위(경기도·충청남도)는 아무도 상호 앞에 붙여 검색하지 않으므로 버린다.
  const regionTokens = (region || '')
    .split(/\s+/)
    .filter((t) => /[가-힣]{2,}(시|군|구|동|읍|면)$/.test(t))
    .map((t) => t.replace(/시$/, ''))
    .slice(0, 2);

  const combos = regionTokens.flatMap((r) => [`${r}${core}`, `${core}${r}`]);

  // 자동완성은 실제 입력 형태라 가장 신뢰도가 높다. 다만 브랜드 토큰이 없는 추천어는 버린다.
  const fromAc = fromAutocomplete.filter((k) => normalize(k).includes(normalize(core)));

  const seen = new Set<string>();
  return [name, core, ...fromAc, ...combos].filter((k) => {
    const key = normalize(k);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 15); // API 호출 3회 상한
}

/** 내림 반올림에 쓰는 구간. 실수치는 고객에게 내보내지 않는다 (§6.5.9). */
const TIERS = [100000, 50000, 10000, 5000, 1000, 500, 100];

/**
 * 고객 화면용 한 문장. **실수치는 절대 담지 않는다** — 구간으로 뭉뚱그린다(§6.5.9).
 * 100회 미만은 숫자를 아예 빼고 "선점이 쉬운 틈새"로 뒤집는다 — 사장님이 키워드를 포기하지 않도록.
 */
export function describeVolume(keyword: string, volume: KeywordVolume | null): string | null {
  if (!volume) return null;
  const tier = TIERS.find((t) => volume.total >= t);
  if (volume.isUnderTen || !tier) {
    return `'${keyword}' 키워드는 아직 경쟁이 붙지 않은 틈새 키워드입니다. 지금 선점하면 상위 진입이 빠릅니다.`;
  }
  return `'${keyword}' 키워드는 월간 조회량 ${tier.toLocaleString()}건 이상의 키워드입니다.`;
}
