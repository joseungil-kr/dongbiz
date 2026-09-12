/**
 * 마케팅 랜딩 페이지 (§6.10) — /ads(광고컨설팅), /blog(블로그배포)
 *
 * 카피 문법은 §6.5.2에서 뽑은 경쟁사 문법을 그대로 쓴다:
 *   ① 문제제기는 고객 1인칭 대사   ② 먼저 봅니다 / 이렇게 합니다 / 보내드립니다
 *   ③ 역-보장(1위 보장 안 함)      ④ 분리 판매 명시
 *
 * 디자인은 경쟁사 두 페이지 캡처를 기준으로 잡았다(2026-09-10 사용자 제공):
 *   - /ads  : 진한 잉크 + 크림 + 애시드 옐로우. 다크 패널과 크림 패널이 번갈아 나오며 리듬을 만든다.
 *   - /blog : 흰 배경 + 네이버 녹색. 밝고 상품 중심.
 *
 * ⚠️ 중요 판단: 경쟁사가 "이미지"로 쓰는 것의 절반이 실제로는 **UI 목업**이다(발행 결과 테이블,
 * 검색 화면, 가격 계산기). 그건 사진을 기다릴 게 아니라 HTML로 만드는 편이 빠르고 더 정직하다
 * — 우리가 실제로 주는 산출물을 그대로 보여주기 때문이다. 사진 슬롯은 사진이어야만 하는
 * 자리(히어로 배경, 섹션 전환)만 남겼다.
 */

const PRICING = {
  placeReview: 1500,
  localDoc: 2500,
};

const CONTACT = {
  phone: '010-2490-0555',
  manager: '조승일',
  email: 'interpiad@gmail.com',
  company: '인터피아드',
  bizNo: '124-35-56796',
};

const won = (n: number) => n.toLocaleString('ko-KR') + '원';

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * 사진 슬롯. 자산이 들어오기 전까지 프롬프트를 화면과 `data-prompt`에 동시에 남긴다.
 * 채울 때는 이 블록을 <img>로 바꾸기만 하면 된다 — 비율은 aspect-ratio가 잡고 있다.
 */
function photoSlot(prompt: string, opts: { ratio?: string; dark?: boolean; className?: string; src?: string; eager?: boolean; alt?: string } = {}): string {
  const { ratio = '16 / 9', dark = false, className = '', src, eager = false, alt = '' } = opts;
  if (src) {
    // alt에 생성 프롬프트를 그대로 넣으면 스크린리더가 "와이드 컷, 얕은 심도" 같은 촬영 지시를
    // 읽는다. 사람이 읽는 짧은 설명을 따로 받고, 프롬프트는 교체 참고용으로 data-prompt에만 남긴다.
    // eager는 히어로 한 장뿐이다. 나머지를 lazy로 두지 않으면 첫 화면에서 수 MB를 한꺼번에 받는다.
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" data-prompt="${escapeHtml(prompt)}" class="ph ${className}"
      loading="${eager ? 'eager' : 'lazy'}" decoding="async"
      style="aspect-ratio:${ratio}" />`;
  }
  return `<div class="slot ${dark ? 'slot-dark' : ''} ${className}" style="aspect-ratio:${ratio}" data-prompt="${escapeHtml(prompt)}">
    <span class="slot-tag">이미지 자리</span>
    <p class="slot-prompt">${escapeHtml(prompt)}</p>
  </div>`;
}

export function siteNav(active: 'place' | 'ads' | 'blog', dark = false): string {
  const item = (key: string, href: string, label: string) =>
    `<a href="${href}"${key === active ? ' class="on"' : ''}>${label}</a>`;
  // 로고는 페이지 테마와 무관하게 항상 파란 [동] 배지다 — 테마는 페이지 강조색이고
  // 로고는 브랜드 식별이라, 페이지마다 로고 색이 바뀌면 같은 사이트로 안 읽힌다.
  return `<div class="site-head ${dark ? 'on-dark' : ''}"><div class="site-head-in">
    <a class="brand" href="/"><span class="logo">동</span>동네장사</a>
    <nav class="site-nav">
      ${item('place', '/', '플레이스분석')}
      ${item('ads', '/ads', '광고컨설팅')}
      <!-- ${item('blog', '/blog', '블로그배포')} -->
    </nav>
    <a class="head-cta" href="tel:${CONTACT.phone.replace(/-/g, '')}">상담 문의</a>
  </div></div>`;
}

/**
 * 상단 고정 메뉴 CSS. /rank·/guide처럼 자체 스타일을 쓰는 페이지도 이 상수를 가져다 쓴다
 * — 규칙을 복사해두면 한쪽만 고쳤을 때 페이지마다 헤더가 미세하게 달라진다(§6.10.4).
 */
export const SITE_NAV_CSS = `
  /* 자체 스타일 페이지에는 테마 변수가 없으므로 기본값을 여기서 준다. */
  :root{--accent:#2563EB;--accent-on:#fff}
  /* /rank·/guide는 전역 a 규칙이 없어 브라우저 기본 밑줄이 그대로 나온다(실제로 나왔다).
     이 상수를 가져다 쓰는 어느 페이지에서도 헤더는 같아야 하므로 여기서 직접 끈다. */
  .site-head a{text-decoration:none}
  .site-head{position:sticky;top:0;z-index:60;background:rgba(255,255,255,.88);backdrop-filter:blur(16px);border-bottom:1px solid rgba(15,23,42,.07)}
  .site-head.on-dark{background:rgba(17,19,16,.82);border-bottom-color:rgba(255,255,255,.08)}
  .site-head-in{max-width:1180px;margin:0 auto;display:flex;align-items:center;gap:26px;padding:11px 28px}
  .brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:19px;letter-spacing:-.04em;color:#0F172A}
  .site-head.on-dark .brand{color:#fff}
  .brand .logo{width:34px;height:34px;border-radius:11px;background:#2563EB;color:#fff;font-weight:900;font-size:17px;
    display:inline-flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(37,99,235,.25)}
  .site-nav{display:flex;gap:2px;margin-left:auto}
  .site-nav a{font-size:14px;font-weight:700;color:#64748B;padding:8px 14px;border-radius:999px;transition:.2s}
  .site-nav a:hover{background:rgba(15,23,42,.05);color:#0F172A}
  .site-nav a.on{background:#0F172A;color:#fff}
  .site-head.on-dark .site-nav a{color:#9CA3AF}
  .site-head.on-dark .site-nav a:hover{background:rgba(255,255,255,.08);color:#fff}
  .site-head.on-dark .site-nav a.on{background:var(--accent);color:var(--accent-on)}
  /* 라벨이 '공유'(2자)냐 '상담 문의'(4자)냐에 따라 버튼 폭이 달라지면, 그 앞의 메뉴가
     같이 밀려서 페이지를 옮길 때마다 상단이 미세하게 흔들린다. 최소폭을 고정해 막는다. */
  .head-cta{display:inline-flex;align-items:center;justify-content:center;min-width:98px;
    font-size:13.5px;font-weight:800;padding:9px 18px;border-radius:999px;background:var(--accent);color:var(--accent-on)}

`;

const PAGE_SCRIPT = `
  // 등장 애니메이션. 한 번 보이면 관찰을 끊는다 — 되돌릴 때 다시 흐려지면 산만하다.
  const io = new IntersectionObserver((es) => {
    for (const e of es) { if (!e.isIntersecting) continue; e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  // 히어로 패럴랙스. rAF로 묶어 스크롤마다 레이아웃을 건드리지 않는다.
  const px = document.querySelector('[data-parallax]');
  if (px && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let t = false;
    addEventListener('scroll', () => {
      if (t) return; t = true;
      requestAnimationFrame(() => { px.style.transform = 'translate3d(0,' + Math.min(scrollY * 0.14, 90) + 'px,0)'; t = false; });
    }, { passive: true });
  }

  // sticky 단계 — 이 자리에 나중에 <video>를 넣고 currentTime을 스크롤에 물리면 프레임 스크럽이 된다.
  const steps = [...document.querySelectorAll('[data-step]')];
  if (steps.length) {
    const sio = new IntersectionObserver((es) => { for (const e of es) e.target.classList.toggle('active', e.isIntersecting); }, { threshold: 0.55 });
    steps.forEach(el => sio.observe(el));
  }

  // 배포비 계산기. 수량을 감으로 권하지 않기 위해 금액을 먼저 보여준다.
  const calc = document.getElementById('calc');
  if (calc) {
    const unit = { place: ${PRICING.placeReview}, local: ${PRICING.localDoc} };
    let kind = 'place';
    const qty = document.getElementById('calcQty');
    const out = document.getElementById('calcOut');
    const note = document.getElementById('calcNote');
    const render = () => {
      const n = Math.max(1, Math.min(1000, Number(qty.value) || 0));
      out.textContent = (unit[kind] * n).toLocaleString('ko-KR') + '원';
      note.textContent = (kind === 'place' ? '플레이스용 배포' : '매장검색용 롱테일키워드') + ' ' + n + '건 · 건당 ' + unit[kind].toLocaleString('ko-KR') + '원';
    };
    calc.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
      kind = b.dataset.kind;
      calc.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('on', x === b));
      render();
    }));
    calc.querySelectorAll('[data-qty]').forEach(b => b.addEventListener('click', () => { qty.value = b.dataset.qty; render(); }));
    qty.addEventListener('input', render);
    render();
  }
`;

const BASE_STYLE = `
  *{box-sizing:border-box}
  /* word-break:keep-all — 한글은 어절 중간에서 끊으면 안 된다("아니 / 라," 같은 사고 방지). */
  body{margin:0;font-family:-apple-system,'Pretendard','Noto Sans KR',sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;letter-spacing:-.01em;word-break:keep-all}
  h1,h2,h3,p,dd,li,summary{word-break:keep-all}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:1180px;margin:0 auto;padding:0 28px}

${SITE_NAV_CSS}

  /* ── 사진 슬롯 ─────────────────────────────────────────────── */
  .slot{position:relative;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:9px;
    background:linear-gradient(135deg,#F1F1EC,#E6E7E0);border:1px dashed #C3C6BC;border-radius:18px;padding:26px;text-align:center;overflow:hidden}
  .slot-dark{background:linear-gradient(135deg,#22251F,#171A15);border-color:#3A3E35}
  .slot-tag{font-size:10.5px;font-weight:800;letter-spacing:.1em;color:#9AA093}
  .slot-prompt{margin:0;font-size:12px;color:#7C8375;max-width:44ch;line-height:1.6}
  .slot-dark .slot-prompt{color:#8B9282}
  /* 실제 사진이 들어온 자리. 슬롯(div)에 걸어둔 규칙은 img에 안 먹으므로 따로 잡는다. */
  img.ph{display:block;width:100%;object-fit:cover;border-radius:14px}
  .hero-dark .bg img.ph{height:100%;border-radius:0;aspect-ratio:auto!important}
  .panel > img.ph{position:absolute;inset:0;height:100%;border-radius:0;aspect-ratio:auto!important}

  /* ── 공통 타이포 ───────────────────────────────────────────── */
  .eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;letter-spacing:.02em;margin:0 0 11px}
  .eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--accent)}
  h1{font-size:clamp(34px,5.6vw,62px);line-height:1.12;letter-spacing:-.045em;margin:0 0 16px;font-weight:900}
  h2{font-size:clamp(26px,3.8vw,42px);line-height:1.18;letter-spacing:-.04em;margin:0 0 12px;font-weight:900}
  .lead{font-size:clamp(14.5px,1.5vw,16.5px);line-height:1.62;margin:0;max-width:54ch}
  section{padding:64px 0}
  .split{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:start}

  .btn{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:15.5px;padding:16px 30px;border-radius:13px;
    background:var(--accent);color:var(--accent-on);transition:.2s}
  .btn:hover{transform:translateY(-1px)}
  .btn-ghost{background:transparent;border:1px solid currentColor;color:inherit}

  /* ── 스크롤 연출 ───────────────────────────────────────────── */
  .reveal{opacity:0;transform:translate3d(0,24px,0);transition:opacity .75s cubic-bezier(.2,.7,.3,1),transform .75s cubic-bezier(.2,.7,.3,1)}
  .reveal.in{opacity:1;transform:none}
  @media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}}
  .sticky-media{position:sticky;top:92px}
  .step{padding:26px 0;opacity:.32;transition:opacity .45s ease;border-top:1px solid rgba(15,23,42,.09)}
  .step.active{opacity:1}
  .step .n{font-size:11.5px;font-weight:900;letter-spacing:.14em;color:var(--accent-ink)}
  .step h3{font-size:clamp(18px,2vw,22px);letter-spacing:-.03em;margin:5px 0 6px;font-weight:900}
  .step p{margin:0;font-size:14.5px;opacity:.72}

  /* ── UI 목업 (사진이 아니라 실제 산출물 모양) ───────────────── */
  .mock{background:#fff;border:1px solid #E4E8E2;border-radius:20px;box-shadow:0 24px 60px -30px rgba(15,23,42,.28);overflow:hidden}
  .mock-head{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid #F0F2EE;font-size:12.5px;font-weight:800;color:#0F172A}
  .mock-tag{font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#9AA093}
  .mock table{width:100%;border-collapse:collapse}
  .mock th,.mock td{padding:12px 18px;text-align:left;font-size:12.5px;border-bottom:1px solid #F4F6F2;color:#334155}
  .mock th{font-size:10.5px;letter-spacing:.06em;color:#94A3B8;font-weight:800;background:#FAFBF9}
  .mock tr:last-child td{border-bottom:0}
  .mock .url{color:var(--accent-ink);font-weight:700}
  .pill-ok{display:inline-block;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent-ink)}
  .mock-foot{padding:12px 18px;font-size:11.5px;color:#94A3B8;background:#FAFBF9;border-top:1px solid #F0F2EE}

  footer.site-foot{background:#14171A;color:#8A929B;padding:46px 0 32px;font-size:12.5px}
  footer.site-foot .cols{display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:34px;margin-bottom:28px}
  footer.site-foot h4{color:#fff;font-size:11.5px;letter-spacing:.1em;margin:0 0 14px;font-weight:800}
  footer.site-foot a{display:block;margin-bottom:9px;color:#8A929B}
  footer.site-foot a:hover{color:#fff}
  footer.site-foot .fine{border-top:1px solid #22272C;padding-top:22px;line-height:1.8}

  @media (max-width:920px){
    section{padding:44px 0}
    .split{grid-template-columns:1fr;gap:30px}
    .sticky-media{position:relative;top:0}
    .step{opacity:1;padding:26px 0}
    .head-cta{display:none}
    .site-nav a{padding:8px 10px;font-size:13px}
    footer.site-foot .cols{grid-template-columns:1fr;gap:26px}
  }
`;

/** /blog — 흰 배경 + 네이버 녹색. 상품과 가격이 주인공이라 밝게 간다. */
const BLOG_STYLE = `
  :root{--accent:#03C75A;--accent-on:#fff;--accent-ink:#05803F;--accent-soft:#E7F8EE}
  body{background:#fff;color:#0F172A}
  .eyebrow{color:var(--accent-ink)}
  h1 em,h2 em{font-style:normal;color:var(--accent-ink)}
  .lead{color:#5A6472}
  section.tint{background:#F6F8F5}
  section.soft{background:var(--accent-soft)}

  .chips{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0 30px}
  .chip{border:1px solid #E4E8E2;border-radius:14px;padding:12px 18px;background:#fff}
  .chip b{display:block;font-size:21px;font-weight:900;letter-spacing:-.03em}
  .chip span{font-size:11.5px;color:#94A3B8;font-weight:700}

  .prod{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .prod .item{border:1px solid #E4E8E2;border-radius:20px;padding:28px;background:#fff;position:relative}
  .prod .item.on{background:var(--accent-soft);border-color:var(--accent)}
  .prod .item .who{font-size:11.5px;font-weight:800;color:var(--accent-ink);margin:0 0 10px}
  .prod .item h3{font-size:22px;font-weight:900;letter-spacing:-.03em;margin:0 0 8px}
  .prod .item p{margin:0 0 18px;font-size:14px;color:#5A6472}
  /* 진단의 '블로그리뷰 부족분'과 이 상품이 같은 숫자라는 연결. 본문에 섞으면 묻혀서 따로 뗀다. */
  .prod .item .note{display:flex;gap:8px;align-items:flex-start;margin:0 0 18px;padding:11px 13px;
    border-radius:11px;background:#fff;border:1px solid var(--accent);font-size:13px;color:#0F172A;line-height:1.55}
  .prod .item .note::before{content:'↳';color:var(--accent-ink);font-weight:900;line-height:1.4}
  .prod .item .price{font-size:26px;font-weight:900;letter-spacing:-.03em}
  .prod .item .price small{font-size:12px;color:#94A3B8;font-weight:700}

  .checks{list-style:none;margin:0 0 24px;padding:0}
  .checks li{position:relative;padding-left:24px;margin-bottom:10px;font-size:14.5px;color:#334155}
  .checks li::before{content:'✓';position:absolute;left:0;color:var(--accent);font-weight:900}

  #calc{background:#fff;border:1px solid #E4E8E2;border-radius:22px;padding:26px;box-shadow:0 24px 60px -32px rgba(15,23,42,.26)}
  #calc h4{margin:0 0 4px;font-size:15px;font-weight:900}
  #calc .hint{margin:0 0 18px;font-size:12.5px;color:#94A3B8}
  .seg{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:#F2F5F1;padding:5px;border-radius:12px;margin-bottom:18px}
  .seg button{border:0;background:transparent;padding:11px 8px;border-radius:9px;font-size:13px;font-weight:800;color:#64748B;cursor:pointer}
  .seg button.on{background:#0F172A;color:#fff}
  #calcQty{width:100%;padding:14px 16px;border:1px solid #E4E8E2;border-radius:12px;font-size:16px;font-weight:800;font-family:inherit}
  .qtys{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0 20px}
  .qtys button{border:1px solid #E4E8E2;background:#fff;padding:9px 4px;border-radius:9px;font-size:12.5px;font-weight:800;color:#64748B;cursor:pointer}
  .qtys button:hover{border-color:var(--accent);color:var(--accent-ink)}
  #calcOut{font-size:36px;font-weight:900;letter-spacing:-.04em;margin:0}
  .faq{border-top:1px solid #E4E8E2}
  .faq details{border-bottom:1px solid #E4E8E2;padding:17px 0}
  .faq summary{list-style:none;cursor:pointer;font-size:17px;font-weight:800;letter-spacing:-.02em;display:flex;gap:16px;align-items:baseline}
  .faq summary::-webkit-details-marker{display:none}
  .faq summary .no{font-size:11.5px;font-weight:900;color:var(--accent-ink);letter-spacing:.1em}
  .faq p{margin:10px 0 0 42px;font-size:14.5px;color:#5A6472}
  /* 블로그 글 미리보기 — 배너처럼 보이면 안 된다. 실제 글의 밀도(제목·메타·소제목·본문)를 그대로 흉내낸다. */
  .post .post-body{padding:24px 26px 20px}
  .post-cat{margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:.08em;color:var(--accent-ink)}
  .post h4{margin:0 0 12px;font-size:21px;font-weight:900;letter-spacing:-.035em;line-height:1.35}
  .post .post-meta{display:flex;align-items:center;gap:7px;margin:0 0 18px;padding-bottom:16px;
    border-bottom:1px solid #EEF1EC;font-size:11.5px;color:#94A3B8}
  .post .post-meta .av{width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;
    font-size:10px;font-weight:900;display:inline-flex;align-items:center;justify-content:center}
  .post .post-photo{height:132px;border-radius:12px;background:linear-gradient(135deg,#EEF3EF,#E2EAE4);
    display:flex;align-items:center;justify-content:center;font-size:11.5px;color:#9AA79E;font-weight:700;margin-bottom:16px}
  .post .post-body p{margin:0 0 13px;font-size:13.5px;line-height:1.78;color:#4B5563}
  .post h5{margin:20px 0 8px;font-size:15px;font-weight:900;letter-spacing:-.02em}
  .post .post-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:18px}
  .post .post-tags span{font-size:11.5px;font-weight:700;padding:5px 11px;border-radius:999px;
    background:var(--accent-soft);color:var(--accent-ink)}
  @media (max-width:920px){.prod{grid-template-columns:1fr}}
`;

/** /ads — 잉크 + 크림 + 애시드 옐로우. 다크/크림 패널이 번갈아 리듬을 만든다. */
const ADS_STYLE = `
  :root{--accent:#D6E64F;--accent-on:#14180F;--accent-ink:#5F6B12;--accent-soft:#F0F4D6;
        --ink:#14180F;--cream:#F5F3EA;--forest:#1E3A2B}
  body{background:var(--cream);color:var(--ink)}
  .eyebrow{color:#7A8460}
  .lead{color:#5C6352}
  section.cream{background:var(--cream)}
  section.paper{background:#FBFAF5}
  section.ink{background:var(--ink);color:#EDEFE6}
  section.ink .lead,section.ink .sub{color:#9BA391}
  /* 밝은 배경에서는 아래 42%만 칠하는 형광펜. */
  .hi{background:linear-gradient(transparent 58%,var(--accent) 58%);padding:0 3px}
  /* ⚠️ 어두운 배경: 글자색을 잉크로 뒤집고 전체를 채우면 위아래 줄을 침범하고 버튼처럼 보인다.
     글자는 흰색 그대로 두고 아래쪽만 굵은 밴드로 깐다 — 형광펜 느낌은 남기면서 침범이 없다. */
  .hero-dark .hi,section.ink .hi{background:linear-gradient(transparent 74%,var(--accent) 74%);color:inherit;padding:0 2px}

  .hero-dark{position:relative;background:var(--ink);color:#fff;overflow:hidden;padding:86px 0 72px}
  .hero-dark .bg{position:absolute;inset:0;opacity:.34}
  .hero-dark .bg .slot{height:100%;width:100%;border:0;border-radius:0;aspect-ratio:auto!important}
  .hero-dark .wrap{position:relative;z-index:2}

  /* 상품 3종 — 큰 고스트 번호 + 다크/크림 교차 패널 */
  .panels{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid rgba(20,24,15,.1);border-radius:24px;overflow:hidden}
  .panel{position:relative;padding:38px 34px;min-height:296px;display:flex;flex-direction:column;justify-content:center}
  .panel .ghost{position:absolute;top:24px;right:32px;font-size:96px;font-weight:900;letter-spacing:-.06em;opacity:.09;line-height:1}
  .panel .tag{font-size:11.5px;font-weight:800;letter-spacing:.12em;margin:0 0 14px;opacity:.6}
  .panel h3{font-size:clamp(23px,2.8vw,32px);font-weight:900;letter-spacing:-.04em;margin:0 0 10px;line-height:1.14}
  .panel .say{font-size:14.5px;font-weight:700;margin:0 0 16px;opacity:.85}
  .panel dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:9px 16px;font-size:13.5px}
  .panel dt{font-weight:800;opacity:.55;white-space:nowrap}
  .panel dd{margin:0;opacity:.9}
  .panel.forest{background:var(--forest);color:#EAF2EC}
  .panel.dark{background:var(--ink);color:#EDEFE6}
  .panel.light{background:#FBFAF5}
  .panel .slot{position:absolute;inset:0;border:0;border-radius:0;aspect-ratio:auto!important}

  .cols3{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-top:1px solid rgba(20,24,15,.12)}
  .cols3 > div{padding:26px 26px 8px;border-right:1px solid rgba(20,24,15,.12)}
  .cols3 > div:last-child{border-right:0}
  .cols3 .k{font-size:11px;font-weight:900;letter-spacing:.14em;color:#8A9470;margin:0 0 12px}
  .cols3 h3{font-size:19px;font-weight:900;letter-spacing:-.03em;margin:0 0 10px}
  .cols3 p{margin:0;font-size:14px;color:#5C6352}

  .promise{background:var(--forest);color:#EAF2EC;border-radius:24px;padding:36px 34px}
  .promise h2{color:#fff}
  .promise .quote{font-size:clamp(24px,3.4vw,36px);font-weight:900;letter-spacing:-.04em;line-height:1.25;margin:0 0 18px}
  .promise p{margin:0;color:#A9BFB2;font-size:14.5px}

  .faq{border-top:1px solid rgba(20,24,15,.14)}
  .faq details{border-bottom:1px solid rgba(20,24,15,.14);padding:17px 0}
  .faq summary{list-style:none;cursor:pointer;font-size:17px;font-weight:800;letter-spacing:-.02em}
  .faq summary::-webkit-details-marker{display:none}
  .faq summary::after{content:'+';float:right;opacity:.4;font-weight:400}
  .faq details[open] summary::after{content:'−'}
  .faq p{margin:10px 0 0;font-size:14.5px;color:#5C6352}
  @media (max-width:920px){
    .panels{grid-template-columns:1fr}
    .panel{min-height:260px;padding:36px 26px}
    .cols3{grid-template-columns:1fr}
    .cols3 > div{border-right:0;border-bottom:1px solid rgba(20,24,15,.12)}
  }
`;

function siteFooter(): string {
  return `<footer class="site-foot"><div class="wrap">
    <div class="cols">
      <div>
        <div style="display:flex;align-items:center;gap:9px;color:#fff;font-weight:800;font-size:18px;margin-bottom:14px">
          <span style="width:32px;height:32px;border-radius:10px;background:#2563EB;display:inline-flex;align-items:center;justify-content:center;font-weight:900">동</span>동네장사
        </div>
        네이버 플레이스 순위를 실측으로 진단하고, 부족한 항목만 골라 채웁니다.<br>
        1위를 보장하지 않습니다. 대신 기준과 변화를 그대로 공유합니다.
      </div>
      <div>
        <h4>무료 도구</h4>
        <a href="/">내 매장 순위 진단</a>
        <a href="/rank">키워드별 순위 현황</a>
        <a href="/guide">상위노출 가이드</a>
      </div>
      <div>
        <h4>서비스</h4>
        <a href="/ads">광고컨설팅</a>
        <!-- <a href="/blog">블로그배포</a> -->
        <a href="tel:${CONTACT.phone.replace(/-/g, '')}">${CONTACT.manager} ${CONTACT.phone}</a>
        <a href="mailto:${CONTACT.email}">${CONTACT.email}</a>
      </div>
    </div>
    <div class="fine">
      상호 : ${CONTACT.company} · 사업자등록번호 : ${CONTACT.bizNo} · 문의 : ${CONTACT.email}<br>
      본 페이지의 수치는 네이버 공개 정보를 수집·집계한 자체 분석이며 네이버 공식 자료가 아닙니다. 순위는 검색자의 위치에 따라 다르게 표시될 수 있습니다.
    </div>
  </div></footer>`;
}

function shell(o: { title: string; description: string; canonical: string; active: 'place' | 'ads' | 'blog'; style: string; body: string; darkNav?: boolean }): string {
  return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.description)}">
<link rel="canonical" href="${o.canonical}">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.description)}">
<style>${BASE_STYLE}${o.style}</style>
</head><body>
${siteNav(o.active, o.darkNav)}
${o.body}
${siteFooter()}
<script>${PAGE_SCRIPT}</script>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// /blog — 블로그배포
// ─────────────────────────────────────────────────────────────────────────────
export function renderBlogPage(): string {
  const body = `
<section style="padding:80px 0 70px"><div class="wrap"><div class="split" style="align-items:center">
  <div>
    <p class="eyebrow reveal">네이버 블로그 배포</p>
    <h1 class="reveal">대량 블로그 배포,<br><em>${won(PRICING.placeReview)}부터.</em></h1>
    <p class="lead reveal">상호로 검색했을 때 나올 글과, 아직 우리 가게를 모르는 손님이 칠 검색어에 걸릴 글을
    나눠서 발행합니다. 끝나면 게시 URL을 전부 정리해 드립니다.</p>
    <div class="chips reveal">
      <div class="chip"><b>${won(PRICING.placeReview)}</b><span>플레이스용 배포 · 1건</span></div>
      <div class="chip"><b>${won(PRICING.localDoc)}</b><span>매장검색용 롱테일키워드 · 1건</span></div>
    </div>
    <div class="reveal"><a class="btn" href="#price">배포비 계산해보기 →</a></div>
  </div>
  <div class="reveal">
    <div class="mock">
      <div class="mock-head"><span>블로그 콘텐츠 발행 결과</span><span class="mock-tag">RESULT</span></div>
      <table>
        <tr><th>No.</th><th>배포 상품</th><th>발행일</th><th>게시 URL</th><th>상태</th></tr>
        <tr><td>01</td><td>플레이스용 배포</td><td>07.16</td><td class="url">blog.naver.com/···/01</td><td><span class="pill-ok">완료</span></td></tr>
        <tr><td>02</td><td>플레이스용 배포</td><td>07.16</td><td class="url">blog.naver.com/···/02</td><td><span class="pill-ok">완료</span></td></tr>
        <tr><td>03</td><td>롱테일키워드</td><td>07.18</td><td class="url">blog.naver.com/···/03</td><td><span class="pill-ok">완료</span></td></tr>
        <tr><td>04</td><td>롱테일키워드</td><td>07.18</td><td class="url">blog.naver.com/···/04</td><td><span class="pill-ok">완료</span></td></tr>
      </table>
      <div class="mock-foot">발행이 끝나면 이 형태로 발행일·키워드·게시 주소를 정리해 보내드립니다.</div>
    </div>
  </div>
</div></div></section>

<section class="tint"><div class="wrap">
  <div class="split" style="margin-bottom:44px">
    <div>
      <p class="eyebrow reveal">둘 중 하나만 고르면 됩니다</p>
      <h2 class="reveal">어떤 글이<br>필요하세요?</h2>
    </div>
    <p class="lead reveal" style="padding-top:16px">검색하는 사람은 두 종류입니다. 이미 우리 가게를 아는 사람과, 아직 모르는 사람.
    두 사람은 완전히 다른 검색어를 칩니다. 그래서 글도 나눠서 씁니다.</p>
  </div>
  <div class="prod reveal">
    <div class="item on">
      <p class="who">상호를 검색하는 고객이 봅니다</p>
      <h3>플레이스용 배포</h3>
      <p>“백세보리밥 닭한마리”처럼 상호를 치는 사람. 가격·후기·주차·예약이 궁금한 상태입니다.</p>
      <p class="note">내 매장 <b>‘블로그리뷰’ 숫자에 포함되는 리뷰</b>입니다.</p>
      <div class="price">${won(PRICING.placeReview)} <small>/ 1건</small></div>
    </div>
    <div class="item">
      <p class="who">아직 모르는 고객이 봅니다</p>
      <h3>매장검색용 롱테일키워드</h3>
      <p>“강남역 맛집”은 메뉴도 위치도 분위기도 아직 안 정한 고객이라 이탈률이 높습니다.
      “강남역 어린이 놀이방 있는 한식집”처럼 <b>조건이 붙은 키워드</b>가 실제 방문으로 이어집니다.</p>
      <div class="price">${won(PRICING.localDoc)} <small>/ 1건</small></div>
    </div>
  </div>
</div></section>

<section><div class="wrap"><div class="split" style="align-items:center">
  <div>
    <p class="eyebrow reveal">복사해서 뿌리지 않습니다</p>
    <h2 class="reveal">실제 후기처럼,<br>편하게 읽히게.</h2>
    <p class="lead reveal" style="margin-bottom:26px">업체 정보만 줄줄이 나열하지 않습니다. 예약부터 방문, 메뉴와 매장 분위기까지
    손님이 궁금해할 순서로 씁니다.</p>
    <ul class="checks reveal">
      <li>예약 → 방문 → 메뉴 → 분위기 순의 후기 구성</li>
      <li>검색어 조합마다 주제와 제목을 다르게</li>
      <li>실제 사진과 플레이스 지도 정보 활용</li>
      <li>발행 후 게시 URL 전달</li>
    </ul>
    <div class="reveal"><a class="btn" href="#price">배포비 계산해보기 →</a></div>
  </div>
  <div class="reveal">
    <div class="mock post">
      <div class="mock-head"><span>블로그 글 미리보기</span><span class="mock-tag">BLOG</span></div>
      <div class="post-body">
        <p class="post-cat">맛집 · 안산 상록구</p>
        <h4>상록수역 닭한마리 맛집, 예약부터 주차까지 다녀온 후기</h4>
        <p class="post-meta"><span class="av">동</span>동네주민 리뷰 · 2026. 7. 16. · 조회 1,284</p>
        <div class="post-photo">사진 · 매장 외관</div>
        <p>퇴근하고 상록수역 근처에서 저녁 먹을 곳을 찾다가 다녀왔어요. 주말 저녁엔 웨이팅이 있다고 해서
        미리 전화로 예약하고 갔는데, 도착하니 자리가 바로 준비돼 있어서 편했습니다.</p>
        <h5>주차는 건물 뒤편에 있어요</h5>
        <p>처음 가면 헷갈리는데 매장 앞이 아니라 건물 뒤쪽 공영주차장을 쓰시면 됩니다.
        1시간 무료 도장을 찍어주셔서 부담이 없었어요.</p>
        <h5>대표 메뉴는 닭한마리, 2인분부터</h5>
        <p>육수가 맑고 간이 세지 않아서 아이랑 같이 먹기에도 괜찮았습니다.
        칼국수 사리는 꼭 추가하시고, 남은 국물에 볶음밥까지 하면 두 명이 배부르게 먹습니다.</p>
        <div class="post-tags">
          ${['상록수역맛집', '안산닭한마리', '상록구맛집', '주차가능', '예약가능'].map(t => `<span>#${t}</span>`).join('')}
        </div>
      </div>
      <div class="mock-foot">검색어마다 제목·소제목·본문 구성을 다르게 잡습니다. 같은 글을 복사해 뿌리지 않습니다.</div>
    </div>
</div></div></section>

<section class="tint"><div class="wrap">
  <p class="eyebrow reveal">과정과 결과를 투명하게</p>
  <h2 class="reveal" style="margin-bottom:44px">발행이 끝나면<br>게시 주소를 드립니다.</h2>
  <div class="split">
    <div>
      <div class="step reveal" data-step><p class="n">STEP 01</p><h3>업체 정보 확인</h3><p>상호명·서비스·영업 지역. 이 세 가지만 있으면 시작할 수 있습니다.</p></div>
      <div class="step reveal" data-step><p class="n">STEP 02</p><h3>키워드 선정</h3><p>실제 검색량을 조회해 발행할 검색어를 고릅니다. 아무도 안 치는 검색어로 1위를 해도 의미가 없습니다.</p></div>
      <div class="step reveal" data-step><p class="n">STEP 03</p><h3>글별 내용 조정</h3><p>검색어마다 주제와 제목을 다르게 잡습니다. 같은 글을 복사해 뿌리지 않습니다.</p></div>
      <div class="step reveal" data-step><p class="n">STEP 04</p><h3>게시 URL 전달</h3><p>발행일·키워드·게시 주소를 정리해 보내드립니다. 무엇을 받았는지 눈으로 확인하실 수 있습니다.</p></div>
    </div>
    <div class="sticky-media reveal">
      ${photoSlot('잔잔한 호수 위로 얇은 물안개가 층을 이루는 새벽 풍경. 사람과 건물 없음. 수평선이 여러 겹으로 나뉘어 보이는 미니멀 구도, 차분한 청록-회색 톤, 넓은 여백.', { ratio: '4 / 5', src: '/images/blog-lake-morning.jpg', alt: '물안개가 층을 이룬 새벽 호수' })}
    </div>
  </div>
</div></section>

<section class="soft" id="price"><div class="wrap"><div class="split" style="align-items:center">
  <div>
    <p class="eyebrow reveal">수량만 고르면 바로 계산</p>
    <h2 class="reveal">건당 가격은<br>두 가지입니다.</h2>
    <p class="lead reveal" style="margin-bottom:24px">수량은 진단 결과의 부족분에 맞춰 정합니다.
    이미 진입선을 넘긴 항목은 더 늘려도 순위가 오르지 않으니 권하지 않습니다.</p>
    <p class="lead reveal" style="font-size:13.5px;color:#7B8574">
      ※ 블로그 배포는 검색결과에서 차지하는 <b>면적과 유입</b>을 늘리는 상품입니다.
      플레이스 순위를 올리는 상품이 아니며, 플레이스 순위 작업과는 별도입니다.</p>
  </div>
  <div class="reveal">
    <div id="calc">
      <h4>예상 배포비 계산</h4>
      <p class="hint">상품과 수량을 고르면 금액이 바로 나옵니다.</p>
      <div class="seg">
        <button data-kind="place" class="on">플레이스용 ${won(PRICING.placeReview)}</button>
        <button data-kind="local">롱테일키워드 ${won(PRICING.localDoc)}</button>
      </div>
      <input id="calcQty" type="number" min="1" max="1000" value="30" inputmode="numeric">
      <div class="qtys">
        ${[10, 30, 50, 100].map(n => `<button data-qty="${n}">${n}건</button>`).join('')}
      </div>
      <p id="calcNote" style="margin:0 0 4px;font-size:12.5px;color:#94A3B8"></p>
      <p id="calcOut"></p>
      <a class="btn" style="width:100%;justify-content:center;margin-top:18px" href="tel:${CONTACT.phone.replace(/-/g, '')}">이 수량으로 문의하기 →</a>
    </div>
  </div>
</div></div></section>

<section><div class="wrap"><div class="split">
  <div>
    <p class="eyebrow reveal">문의 전 확인</p>
    <h2 class="reveal">자주 묻는 것</h2>
  </div>
  <div class="faq reveal">
    <details open><summary><span class="no">01</span>몇 건을 해야 하나요?</summary>
      <p>진단으로 정합니다. 1페이지 진입선 업체의 실측값과 현재 값의 차이가 곧 필요한 수량입니다. 감으로 권하지 않습니다.</p></details>
    <details><summary><span class="no">02</span>두 상품 중 무엇을 골라야 하나요?</summary>
      <p>상호를 검색해도 우리 가게 얘기가 없다면 플레이스용 배포입니다. 아직 우리 가게를 모르는 손님을 데려오고 싶다면 매장검색용 롱테일키워드입니다. 둘 다 필요한 경우가 많아 진단에서 비중을 알려드립니다.</p></details>
    <details><summary><span class="no">03</span>블로그 배포만 따로 맡겨도 되나요?</summary>
      <p>됩니다. 플레이스 작업과 별개로 진행할 수 있습니다.</p></details>
    <details><summary><span class="no">04</span>이걸 하면 플레이스 순위가 오르나요?</summary>
      <p>그렇게 약속하지 않습니다. 블로그 배포는 검색결과에서 노출되는 면적과 유입을 늘리는 상품이고, 플레이스 순위는 리뷰·저장·검색 유입 등 별개 지표로 정해집니다. 두 작업은 목적이 다릅니다.</p></details>
  </div>
</div></div></section>

<section class="soft"><div class="wrap"><div class="split" style="align-items:center">
  <div>
    <p class="eyebrow reveal">상담을 물어도 캠페인이 아닙니다</p>
    <h2 class="reveal">상호명과 영업 지역만<br>보내주세요.</h2>
  </div>
  <div class="reveal">
    <p class="lead" style="margin-bottom:22px">플레이스 주소가 있다면 함께 보내주세요. 확인한 뒤 맞는 상품부터 안내드립니다.
    요청하지 않으시면 영업 전화를 드리지 않습니다.</p>
    <a class="btn" href="/">무료로 내 매장 진단하기 →</a>
  </div>
</div></div></section>`;

  return shell({
    title: '블로그배포 | 동네장사',
    description: `상호 검색용 방문 후기형 글과 매장검색용 롱테일키워드 글을 나눠 발행합니다. 건당 ${won(PRICING.placeReview)}부터, 게시 URL 전달.`,
    canonical: 'https://dongbiz.com/blog',
    active: 'blog',
    style: BLOG_STYLE,
    body,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /ads — 광고컨설팅
// ─────────────────────────────────────────────────────────────────────────────
export function renderAdsPage(): string {
  const body = `
<section class="hero-dark">
  <div class="bg">${photoSlot('이른 아침 빈 매장 내부를 창가 역광으로 촬영한 와이드 컷. 사람 없음. 테이블과 의자의 실루엣, 창밖은 흐릿한 거리. 따뜻한 어둠, 시네마틱, 얕은 심도.', { ratio: '21 / 9', dark: true, src: '/images/ads-hero-store-morning.jpg', eager: true, alt: '이른 아침 문을 열기 전의 매장 내부' })}</div>
  <div class="wrap">
    <p class="eyebrow reveal" style="color:#A8B48A">광고컨설팅</p>
    <h1 class="reveal">광고비를 줄이는 게 아니라,<br><span class="hi">어디에 쓸지를 정합니다.</span></h1>
    <p class="lead reveal" style="color:#B9C0AC;margin-bottom:32px">순위·리뷰·저장·검색량을 먼저 실측하고,
    그 매장에서 가장 싸게 오르는 항목부터 손댑니다. 진행 전 기준과 진행 후 변화를 그대로 공유합니다.</p>
    <div class="reveal"><a class="btn" href="/">무료로 내 매장 진단하기 →</a></div>
  </div>
</section>

<section class="cream"><div class="wrap">
  <div class="split" style="margin-bottom:40px">
    <div>
      <p class="eyebrow reveal">셋 중 하나만 맡겨도 됩니다</p>
      <h2 class="reveal">어디가 제일<br>답답하세요?</h2>
    </div>
    <p class="lead reveal" style="padding-top:14px">순위는 리뷰 하나로 정해지지 않습니다. 저장·검색 유입·재방문처럼
    화면에 안 보이는 지표가 함께 움직입니다. 무엇이 부족한지 모른 채 집행하면, 이미 충분한 항목에 돈을 더 쓰게 됩니다.</p>
  </div>
  <div class="panels reveal">
    <div class="panel forest">
      <span class="ghost">01</span>
      <p class="tag">상품 01</p>
      <h3>플레이스<br>상위노출</h3>
      <p class="say">“원하는 검색어에서 우리 가게가 너무 아래에 있어요.”</p>
      <dl>
        <dt>먼저 봅니다</dt><dd>현재 순위 · 주변 경쟁 매장 · 키워드 검색량</dd>
        <dt>이렇게 합니다</dt><dd>플레이스 정보 점검 · 키워드 운영 · 순위 추적</dd>
        <dt>보내드립니다</dt><dd>키워드별 순위표 · 진행 기록</dd>
      </dl>
    </div>
    <div class="panel light" style="padding:0">
      ${photoSlot('나무 테이블 위에 노트북과 서류가 놓인 사무실 정물 컷. 사람 없음. 창가 자연광, 따뜻한 베이지-그린 톤, 위에서 비스듬히 내려다본 구도.', { ratio: '4 / 3', src: '/images/ads-office-desk.jpg', alt: '창가 자연광이 드는 사무실 책상' })}
    </div>
    <div class="panel light" style="padding:0">
      ${photoSlot('반복되는 창문 격자가 보이는 현대식 건물 파사드를 정면에서 촬영. 사람 없음. 밝은 크림-회색 톤, 미니멀 건축 사진, 규칙적 반복.', { ratio: '4 / 3', src: '/images/ads-building-facade.jpg', alt: '규칙적으로 반복되는 건물 외벽의 창문 격자' })}
    </div>
    <div class="panel dark">
      <span class="ghost">02</span>
      <p class="tag">상품 02</p>
      <h3>블로그<br>배포</h3>
      <p class="say">“상호나 서비스명을 검색해도 우리 가게 얘기가 별로 없어요.”</p>
      <dl>
        <dt>먼저 정합니다</dt><dd>알릴 주제 · 노출할 키워드 · 발행 일정</dd>
        <dt>이렇게 합니다</dt><dd>원고와 이미지 준비 · 콘텐츠 발행</dd>
        <dt>보내드립니다</dt><dd>발행 일정 · 게시 URL</dd>
      </dl>
      <p style="margin:20px 0 0"><a href="/blog" style="font-size:13.5px;font-weight:800;color:var(--accent)">블로그 배포 자세히 보기 →</a></p>
    </div>
    <div class="panel forest">
      <span class="ghost">03</span>
      <p class="tag">상품 03</p>
      <h3>플레이스<br>정비·세팅</h3>
      <p class="say">“뭘 채워야 하는지도 모르겠어요.”</p>
      <dl>
        <dt>먼저 봅니다</dt><dd>대표키워드 · 상세설명 · 영업시간 · 편의시설 누락</dd>
        <dt>이렇게 합니다</dt><dd>정보 정비 · 소식 발행 · 톡톡/스마트콜 연동</dd>
        <dt>보내드립니다</dt><dd>수정 목록 · 반영 내역</dd>
      </dl>
    </div>
    <div class="panel light" style="padding:0">
      ${photoSlot('완만한 능선이 겹겹이 이어지는 새벽 산맥 항공 사진. 사람과 건물 없음. 층층이 물러나는 원근, 푸른 새벽 안개, 미니멀.', { ratio: '4 / 3', src: '/images/ads-mountain-fog.jpg', alt: '겹겹이 물러나는 새벽 산 능선' })}
    </div>
  </div>
</div></section>

<section class="paper"><div class="wrap">
  <div class="split" style="margin-bottom:40px">
    <div>
      <p class="eyebrow reveal">감이 아니라 실측</p>
      <h2 class="reveal">자체 개발 도구로,<br>매장부터 분석합니다.</h2>
    </div>
    <p class="lead reveal" style="padding-top:14px">상위 업체가 실제로 가진 숫자를 그대로 가져옵니다.
    추정이 아니라 관측값이고, 그 차이가 곧 필요한 작업량입니다.</p>
  </div>
  <div class="split reveal">
    <div class="mock">
      <div class="mock-head"><span>업장 현황 한 번에 조회</span><span class="mock-tag">진단</span></div>
      <table>
        <tr><th>항목</th><th>내 매장</th><th>1페이지 진입선</th><th>부족분</th></tr>
        <tr><td>블로그·카페 리뷰</td><td>161</td><td>577</td><td style="color:#B4553F;font-weight:800">416</td></tr>
        <tr><td>방문자 리뷰</td><td>22</td><td>4,676</td><td style="color:#B4553F;font-weight:800">4,654</td></tr>
        <tr><td>키워드 투표수</td><td>89</td><td>18,931</td><td style="color:#B4553F;font-weight:800">18,842</td></tr>
        <tr><td>등록 사진</td><td>79</td><td>52</td><td style="color:#4C7A3F;font-weight:800">충족</td></tr>
      </table>
      <div class="mock-foot">이미 충족한 항목은 제안에서 뺍니다. 더 늘려도 순위가 오르지 않습니다.</div>
    </div>
    <div class="mock">
      <div class="mock-head"><span>키워드 수요와 연관어 분석</span><span class="mock-tag">검색량</span></div>
      <table>
        <tr><th>키워드</th><th>월간 검색량</th><th>경쟁도</th></tr>
        <tr><td>안산 상록구맛집</td><td><b>810</b></td><td>높음</td></tr>
        <tr><td>상록구 닭한마리</td><td><b>340</b></td><td>중간</td></tr>
        <tr><td>안산 보리밥</td><td><b>180</b></td><td>낮음</td></tr>
        <tr><td>상록구청 맛집</td><td>&lt; 10</td><td>낮음</td></tr>
      </table>
      <div class="mock-foot">검색량이 적은 키워드는 경쟁도 없습니다 — 선점이 쉬운 자리인지부터 봅니다.</div>
    </div>
  </div>
</div></section>

<section class="cream"><div class="wrap">
  <p class="eyebrow reveal">순서를 지킵니다</p>
  <h2 class="reveal" style="margin-bottom:10px">진단 없이 집행하면<br>효과를 해석할 수 없습니다.</h2>
  <div class="cols3 reveal" style="margin-top:40px">
    <div><p class="k">STEP 01</p><h3>실측</h3><p>목표 키워드에서 상위 업체가 실제로 가진 숫자를 그대로 가져옵니다.</p></div>
    <div><p class="k">STEP 02</p><h3>우선순위</h3><p>부족분이 가장 큰 항목이 아니라, 가장 적은 비용으로 진입선을 넘길 항목부터 정합니다.</p></div>
    <div><p class="k">STEP 03</p><h3>단일 집행</h3><p>광고와 이벤트를 동시에 돌리면 무엇이 효과였는지 구분할 수 없습니다.</p></div>
  </div>
</div></section>

<section class="paper"><div class="wrap"><div class="promise reveal">
  <p class="eyebrow" style="color:#9DBCA8">약속하지 않는 것</p>
  <p class="quote">“무조건 1위”라는<br>말은 하지 않습니다.</p>
  <p>플랫폼의 검색 결과를 고정할 수 있는 곳은 없습니다. 기간도 약속하지 않습니다 — 업종과 경쟁 강도에 따라
  반응 속도가 다르기 때문입니다. 대신 시작 전 기준과 진행 후 순위 변화를 그대로 공유합니다.
  이미 진입선을 넘긴 항목은 제안에서 뺍니다.</p>
</div></div></section>

<section class="cream"><div class="wrap"><div class="split">
  <div>
    <p class="eyebrow reveal">전화하기 전에</p>
    <h2 class="reveal">읽어보세요.</h2>
  </div>
  <div class="faq reveal">
    <details open><summary>비용은 어떻게 되나요?</summary>
      <p>매장 상태와 목표 키워드 수에 따라 달라집니다. 진단 결과를 먼저 보내드리고, 필요한 항목만 골라 견적을 냅니다. 진단과 첫 안내는 무료입니다.</p></details>
    <details><summary>하나만 맡겨도 되나요?</summary>
      <p>됩니다. 플레이스만, 블로그만 따로 진행할 수 있습니다. 순서상 무엇을 먼저 해야 하는지는 진단에서 알려드립니다.</p></details>
    <details><summary>직접 고칠 수 있는 것도 있나요?</summary>
      <p>있습니다. 톡톡 연동, 영업시간·찾아오는길 등록, 대표키워드 5개 채우기는 5분이면 직접 하실 수 있고 비용이 들지 않습니다. 리포트에 방법까지 적어 보내드립니다.</p></details>
    <details><summary>얼마나 걸리나요?</summary>
      <p>고정된 기간을 약속하지 않습니다. 다만 매일 순위를 기록하므로 변화가 시작되는 시점을 숫자로 확인하실 수 있습니다.</p></details>
    <details><summary>지금 당장 뭘 해야 할지 모르겠습니다.</summary>
      <p>진단부터 하시면 됩니다. 무료이고 상호만 있으면 됩니다.</p></details>
  </div>
</div></div></section>

<section class="ink"><div class="wrap" style="text-align:center">
  <h2 class="reveal" style="color:#fff">지금 제일 <span class="hi">답답한 것부터</span><br>확인해보세요.</h2>
  <p class="lead reveal" style="margin:0 auto 30px;color:#9BA391">진단은 무료입니다. 상호만 있으면 되고,
  요청하지 않으시면 영업 전화를 드리지 않습니다.</p>
  <div class="reveal">
    <a class="btn" href="/">무료로 내 매장 진단하기 →</a>
    <a class="btn btn-ghost" style="margin-left:8px;color:#EDEFE6" href="tel:${CONTACT.phone.replace(/-/g, '')}">${CONTACT.manager} ${CONTACT.phone}</a>
  </div>
</div></section>`;

  return shell({
    title: '광고컨설팅 | 동네장사',
    description: '순위·리뷰·저장·검색량을 먼저 실측하고 가장 싸게 오르는 항목부터 정리합니다. 1위를 보장하지 않고, 진행 전후 변화를 그대로 공유합니다.',
    canonical: 'https://dongbiz.com/ads',
    active: 'ads',
    style: ADS_STYLE,
    body,
    darkNav: true,
  });
}

