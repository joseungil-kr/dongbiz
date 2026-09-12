/**
 * 매장 전용 미니홈피 (§6.11) — /p/{placeId}, /p/{placeId}/{topic}
 *
 * ⚠️ 이 기능의 성패는 "자동 생성이냐"가 아니라 **"사람에게 가치가 있느냐"**에 달려 있다.
 * 구글은 2024년 스팸 정책에 scaled content abuse를 명시했고, 템플릿에 상호만 갈아끼운
 * 페이지가 정확히 거기 걸린다. 그래서 이 파일은 두 규칙을 지킨다(§6.11.4):
 *
 *   1. **데이터가 없으면 섹션도 페이지도 만들지 않는다.** 빈 자리를 문구로 때우는 순간 템플릿이 된다.
 *   2. **지표를 전시하지 않는다.** 이 페이지의 독자는 사장님이 아니라 매장을 찾는 소비자다.
 *      리뷰 수·순위는 문서를 **구성하는 재료**로만 쓰고 화면에 숫자로 내보내지 않는다.
 *
 * 하위 페이지는 "정보의 종류"가 아니라 **"실제로 검색되는 질문 하나"** 단위로 쪼갠다(§6.11.6b).
 * 같은 소개글을 메뉴편·주차편으로 자르면 내부 중복이 되고, 그게 외부 중복보다 먼저 문제가 된다.
 *
 * 현재는 전 페이지 noindex다. 결제 연동 전까지 색인되면 안 된다.
 */

import { autocomplete } from './searchad';

const NOINDEX = '<meta name="robots" content="noindex,nofollow">';

function esc(str: string): string {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** 상세설명을 그대로 싣지 않는다 — 플레이스와 중복 콘텐츠가 된다. 문장 단위로 끊어 재구성한다. */
function sentences(text: string, limit = 4): string[] {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length >= 12)
    .slice(0, limit);
}

export interface Topic {
  slug: string;
  /** 사람이 실제로 검색한 질문 그대로 */
  query: string;
  title: string;
  render: (store: any) => string;
}

/**
 * 하위 페이지 후보. **자동완성에 실제로 뜬 것만** 살아남는다 —
 * 검색 수요가 없는 주제로 페이지를 만들면 그게 저품질 페이지다(§6.11.6b).
 * `has`가 false면 데이터가 없다는 뜻이라 그 페이지 자체를 만들지 않는다.
 */
const TOPIC_DEFS: Array<{
  slug: string; keys: string[]; title: (n: string) => string;
  has: (s: any) => boolean; render: (s: any) => string;
}> = [
  {
    slug: 'menu', keys: ['메뉴', '가격', '단가'],
    title: n => `${n} 메뉴와 가격`,
    has: s => (s.menus?.length ?? 0) > 0,
    render: s => `
      <p>${esc(s.name)}에서 주문할 수 있는 메뉴입니다. 가격은 매장 사정에 따라 달라질 수 있어
      방문 전 전화로 확인하시는 편이 정확합니다.</p>
      <table class="menu">
        <tbody>${s.menus.slice(0, 30).map((m: any) => `<tr>
          <td>${esc(m.name)}${m.isRecommend ? ' <span class="rec">대표</span>' : ''}
            ${m.description ? `<span class="d">${esc(m.description)}</span>` : ''}</td>
          <td class="p">${m.price ? Number(m.price).toLocaleString('ko-KR') + '원' : '변동'}</td>
        </tr>`).join('')}</tbody>
      </table>`,
  },
  {
    // ⚠️ 주차 정보가 있을 때만 만든다. 예전엔 '찾아오는 길'만 있어도 이 페이지를 만들었는데,
    // 그러면 주차를 검색한 사람에게 "매장에 확인하세요"라고 답하는 얇은 페이지가 된다.
    // 질문에 답하지 못하는 페이지는 만들지 않는 게 맞다(§6.11.4).
    slug: 'parking', keys: ['주차'],
    title: n => `${n} 주차 안내`,
    has: s => (s.conveniences || []).some((c: string) => /주차/.test(c)),
    render: s => `
      <p>${esc(s.name)}은 주차가 가능한 매장으로 등록돼 있습니다.
      주차 대수와 무료 여부는 매장 사정에 따라 달라질 수 있습니다.</p>
      ${s.directions ? `<p><b>찾아오는 길</b><br>${esc(s.directions)}</p>` : ''}
      ${s.roadAddress ? `<p><b>주소</b><br>${esc(s.roadAddress)}</p>` : ''}`,
  },
  {
    // 주차와 분리했다. 둘은 다른 질문이고, 답하는 데이터도 다르다.
    slug: 'directions', keys: ['찾아오는', '오시는', '가는길', '위치', '약도'],
    title: n => `${n} 찾아오는 길`,
    has: s => !!s.directions || !!s.roadAddress,
    render: s => `
      ${s.directions ? `<p>${esc(s.directions)}</p>` : ''}
      ${s.roadAddress ? `<p><b>주소</b><br>${esc(s.roadAddress)}</p>` : ''}
      <p><a href="${esc(s.placeUrl)}" rel="nofollow">네이버 지도에서 길찾기</a></p>`,
  },
  {
    slug: 'reservation', keys: ['예약', '웨이팅', '대기'],
    title: n => `${n} 예약 문의`,
    has: s => !!s.phone,
    render: s => `
      <p>${esc(s.name)} 예약과 문의는 전화로 하실 수 있습니다.</p>
      <p><b>전화</b><br><a href="tel:${esc(String(s.phone).replace(/-/g, ''))}">${esc(s.phone)}</a></p>
      ${s.seoMetrics?.hasTalktalk ? '<p>네이버 톡톡으로도 문의를 받고 있습니다.</p>' : ''}`,
  },
  {
    slug: 'hours', keys: ['영업시간', '오픈', '브레이크타임', '휴무'],
    title: n => `${n} 영업시간`,
    has: s => s.seoMetrics?.isBizHourMissing === false,
    render: s => `
      <p>${esc(s.name)}의 영업시간은 네이버 플레이스에 등록돼 있습니다.
      명절·임시휴무는 반영이 늦을 수 있어 방문 전 확인을 권합니다.</p>
      <p><a href="${esc(s.placeUrl)}" rel="nofollow">네이버 지도에서 영업시간 보기</a></p>`,
  },
  {
    slug: 'facility', keys: ['룸', '단체', '포장', '배달', '반려동물', '와이파이', '유아'],
    title: n => `${n} 편의시설`,
    has: s => (s.conveniences?.length ?? 0) > 0,
    render: s => `
      <p>${esc(s.name)}에서 이용할 수 있는 편의시설입니다.</p>
      <ul class="tags">${s.conveniences.map((c: string) => `<li>${esc(c)}</li>`).join('')}</ul>
      ${(s.paymentMethods?.length ?? 0) > 0
        ? `<p><b>결제수단</b><br>${s.paymentMethods.map((m: string) => esc(m)).join(' · ')}</p>` : ''}`,
  },
];

/**
 * 이 매장에 실제로 붙는 검색어를 자동완성에서 확인하고, 그 중 데이터가 있는 주제만 페이지로 만든다.
 * 자동완성이 비면(신생 매장 등) 데이터 보유 기준으로만 만든다 — 이 경우 페이지 수가 적게 나오는 게 정상이다.
 */
export async function pickTopics(store: any, max = 10): Promise<Topic[]> {
  const suggestions = (await autocomplete(store.name || '')).join(' ');
  const picked: Topic[] = [];

  for (const def of TOPIC_DEFS) {
    if (!def.has(store)) continue; // 데이터 없음 → 페이지 자체를 만들지 않는다
    const query = def.keys.find(k => suggestions.includes(k));
    picked.push({
      slug: def.slug,
      // 자동완성에 없으면 검색 수요가 확인되지 않은 주제다. 만들되 우선순위를 뒤로 민다.
      query: query ? `${store.name} ${query}` : '',
      title: def.title(store.name || ''),
      render: def.render,
    });
  }
  // 실제 검색 수요가 확인된 주제를 앞으로
  picked.sort((a, b) => (b.query ? 1 : 0) - (a.query ? 1 : 0));
  return picked.slice(0, max);
}

const STYLE = `
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,'Pretendard','Noto Sans KR',sans-serif;line-height:1.75;
    color:#111827;background:#fff;word-break:keep-all;-webkit-font-smoothing:antialiased}
  .wrap{max-width:720px;margin:0 auto;padding:0 20px 64px}
  a{color:#1D4ED8}
  header.hero{border-bottom:1px solid #EEF0F3;padding:30px 0 24px;margin-bottom:28px}
  .cat{font-size:12.5px;font-weight:800;color:#6B7280;letter-spacing:.04em;margin:0 0 8px}
  h1{font-size:clamp(25px,4.4vw,34px);line-height:1.25;letter-spacing:-.035em;margin:0 0 12px;font-weight:900}
  .addr{margin:0 0 18px;color:#4B5563;font-size:14.5px}
  .acts{display:flex;gap:8px;flex-wrap:wrap}
  .acts a{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:800;padding:11px 18px;
    border-radius:11px;background:#111827;color:#fff;text-decoration:none}
  .acts a.sub{background:#fff;color:#111827;border:1px solid #D8DCE2}
  h2{font-size:20px;letter-spacing:-.03em;margin:34px 0 10px;font-weight:900}
  p{margin:0 0 13px;font-size:15px;color:#374151}
  ul.tags{list-style:none;display:flex;flex-wrap:wrap;gap:7px;padding:0;margin:0 0 14px}
  ul.tags li{font-size:13px;font-weight:700;background:#F3F4F6;border-radius:999px;padding:6px 13px;color:#374151}
  table.menu{width:100%;border-collapse:collapse;margin:0 0 14px}
  table.menu td{padding:12px 0;border-bottom:1px solid #F1F3F5;font-size:14.5px;vertical-align:top}
  table.menu td.p{text-align:right;white-space:nowrap;font-weight:800}
  table.menu .rec{font-size:11px;font-weight:800;color:#B45309;background:#FEF3C7;border-radius:5px;padding:2px 6px}
  table.menu .d{display:block;font-size:12.5px;color:#9CA3AF;margin-top:3px}
  .voice{background:#F8FAFC;border:1px solid #E9EDF2;border-radius:14px;padding:18px 20px;margin:0 0 14px}
  .voice b{font-size:14px}
  .pages{display:grid;gap:8px;margin:12px 0 0}
  .pages a{display:block;border:1px solid #E5E7EB;border-radius:12px;padding:14px 16px;
    text-decoration:none;color:#111827;font-weight:800;font-size:14.5px}
  .pages a span{display:block;font-weight:500;font-size:12.5px;color:#6B7280;margin-top:3px}
  .faq details{border-bottom:1px solid #EEF0F3;padding:14px 0}
  .faq summary{cursor:pointer;font-weight:800;font-size:15px;list-style:none}
  .faq summary::-webkit-details-marker{display:none}
  .faq p{margin:9px 0 0;font-size:14.5px}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid #EEF0F3;font-size:12px;color:#9CA3AF}
  .draft{background:#FEF3C7;border:1px solid #FCD34D;border-radius:12px;padding:13px 16px;margin:0 0 20px;
    font-size:13px;color:#78350F;line-height:1.6}
`;

function shell(o: { title: string; desc: string; store: any; body: string; jsonLd?: string }): string {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${NOINDEX}
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<style>${STYLE}</style>
${o.jsonLd ? `<script type="application/ld+json">${o.jsonLd}</script>` : ''}
</head><body><div class="wrap">
<div class="draft"><b>미리보기 페이지입니다.</b> 검색엔진에 등록되지 않은 상태(noindex)이며,
네이버 플레이스의 공개 정보를 바탕으로 자동 생성했습니다. 수정·삭제를 원하시면 알려주세요.</div>
${o.body}
<footer>
  네이버 플레이스 공개 정보를 바탕으로 자동 구성한 페이지입니다. 네이버 공식 자료가 아닙니다.<br>
  정보 수정·삭제 요청 : interpiad@gmail.com · 동네장사
</footer>
</div></body></html>`;
}

/** 메인 페이지. 매장 전체를 한 장으로 소개하고, 세부 질문은 하위 페이지로 넘긴다. */
export function renderMiniHome(store: any, topics: Topic[]): string {
  const intro = sentences(store.description, 3);
  const votes = (store.topRepKeywords || []).slice(0, 5);
  const base = `/p/${store.placeId}`;

  // LocalBusiness 구조화 데이터 — 검색엔진이 이해하기 쉬운 형태로 사실만 넘긴다.
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'LocalBusiness',
    name: store.name, telephone: store.phone || undefined,
    address: store.roadAddress ? { '@type': 'PostalAddress', streetAddress: store.roadAddress, addressCountry: 'KR' } : undefined,
    geo: store.coordinates?.x ? { '@type': 'GeoCoordinates', latitude: store.coordinates.y, longitude: store.coordinates.x } : undefined,
    // 사진은 페이지에 싣지 않기로 했다(2026-09-10 사용자 결정). 화면에 없는 이미지를
    // 구조화 데이터로만 신고하면 페이지 내용과 어긋나므로 넣지 않는다.
  });

  const body = `
<header class="hero">
  <p class="cat">${esc(store.category || '')}${store.roadAddress ? ' · ' + esc(store.roadAddress.split(' ').slice(0, 2).join(' ')) : ''}</p>
  <h1>${esc(store.name)}</h1>
  ${store.roadAddress ? `<p class="addr">${esc(store.roadAddress)}</p>` : ''}
  <div class="acts">
    ${store.phone ? `<a href="tel:${esc(String(store.phone).replace(/-/g, ''))}">전화하기</a>` : ''}
    <a class="sub" href="${esc(store.placeUrl)}" rel="nofollow">지도에서 보기</a>
  </div>
</header>

${intro.length ? `<h2>어떤 곳인가요</h2>${intro.map(t => `<p>${esc(t)}</p>`).join('')}` : ''}

${votes.length ? `<h2>방문객이 많이 고른 표현</h2>
<div class="voice">
  <b>${esc(votes[0].keyword)}</b> 외 ${votes.length - 1}가지가 리뷰에서 자주 선택됐습니다.
  <ul class="tags" style="margin-top:10px">${votes.map((v: any) => `<li>${esc(v.keyword)}</li>`).join('')}</ul>
</div>` : ''}

${(store.keywordList?.length ?? 0) ? `<h2>이런 걸 찾으실 때</h2>
<ul class="tags">${store.keywordList.map((k: string) => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}

${topics.length ? `<h2>자세히 보기</h2>
<div class="pages">${topics.map(t => `<a href="${base}/${t.slug}">${esc(t.title)}
  ${t.query ? `<span>“${esc(t.query)}”로 찾는 분들이 보는 정보</span>` : ''}</a>`).join('')}</div>` : ''}
`;

  return shell({
    title: `${store.name} — ${store.category || '매장 정보'}`,
    desc: intro[0] || `${store.name} 위치·연락처·메뉴 등 매장 정보`,
    store, body, jsonLd,
  });
}

/** 하위 페이지. 질문 하나에만 답하고, 매장 소개는 반복하지 않고 메인으로 링크한다. */
export function renderMiniTopic(store: any, topic: Topic, siblings: Topic[]): string {
  const base = `/p/${store.placeId}`;
  const others = siblings.filter(t => t.slug !== topic.slug);

  const body = `
<header class="hero">
  <p class="cat"><a href="${base}">${esc(store.name)}</a></p>
  <h1>${esc(topic.title)}</h1>
</header>
${topic.render(store)}
${others.length ? `<h2>다른 정보</h2>
<div class="pages">${others.map(t => `<a href="${base}/${t.slug}">${esc(t.title)}</a>`).join('')}</div>` : ''}
<p style="margin-top:22px"><a href="${base}">← ${esc(store.name)} 전체 정보</a></p>`;

  return shell({ title: `${topic.title} | 동네장사`, desc: `${store.name} ${topic.title}`, store, body });
}
