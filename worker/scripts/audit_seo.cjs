const fs = require('fs');

async function audit() {
  const pages = [
    { name: '홈페이지', url: 'https://dongbiz.com/' },
    { name: '키워드 순위 허브', url: 'https://dongbiz.com/rank' },
    { name: '키워드 순위 상세(수원금거래소)', url: 'https://dongbiz.com/rank/%EC%88%98%EC%9B%90%EA%B8%88%EA%B1%B0%EB%9E%98%EC%86%8C' },
    { name: '가이드 목록', url: 'https://dongbiz.com/guide' },
    { name: '키워드 검색량', url: 'https://dongbiz.com/keyword-volume' },
    { name: '광고컨설팅', url: 'https://dongbiz.com/ads' },
    { name: '블로그배포', url: 'https://dongbiz.com/blog' },
  ];

  const path = require('path');
  const guidesContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'guides.ts'), 'utf8');
  const slugs = [...guidesContent.matchAll(/slug:\s*'([^']+)'/g)].map(m => m[1]);
  if (!slugs.includes('플레이스순위하락')) slugs.push('플레이스순위하락');
  for (const s of slugs) {
    pages.push({ name: '가이드: ' + s, url: 'https://dongbiz.com/guide/' + encodeURIComponent(s) });
  }

  console.log(`[SEO 전수 진단 시작] 총 ${pages.length}개 페이지 점검 중...\n`);

  const results = [];
  for (const p of pages) {
    try {
      const res = await fetch(p.url);
      const html = await res.text();

      let score = 100;
      const issues = [];

      // 1. Title
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';
      if (!title) { score -= 20; issues.push('Title 태그 누락'); }
      else if (title.length < 10) { score -= 5; issues.push(`Title 너무 짧음 (${title.length}자)`); }

      // 2. Meta Description
      const descMatch = html.match(/<meta\s+name=["']description["']\s+content="([^"]*)"/i) ||
                        html.match(/<meta\s+name=["']description["']\s+content='([^']*)'/i);
      const desc = descMatch ? descMatch[1].trim() : '';
      if (!desc) { score -= 20; issues.push('Meta Description 누락'); }
      else if (desc.length < 30) { score -= 5; issues.push(`Meta Description 짧음 (${desc.length}자)`); }

      // 3. Canonical
      const canonMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i);
      if (!canonMatch) { score -= 10; issues.push('Canonical URL 누락'); }

      // 4. H1
      const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
      if (h1Matches.length === 0) { score -= 15; issues.push('H1 태그 누락'); }
      else if (h1Matches.length > 1) { score -= 5; issues.push(`H1 태그 다중 존재 (${h1Matches.length}개)`); }

      // 5. OpenGraph
      const ogTitle = html.match(/<meta\s+property=["']og:title["']/i);
      const ogDesc = html.match(/<meta\s+property=["']og:description["']/i);
      const ogImg = html.match(/<meta\s+property=["']og:image["']/i);
      const ogUrl = html.match(/<meta\s+property=["']og:url["']/i);
      if (!ogTitle || !ogDesc) { score -= 10; issues.push('og:title 또는 og:description 누락'); }
      if (!ogImg) { score -= 10; issues.push('og:image 누락'); }
      if (!ogUrl) { score -= 5; issues.push('og:url 누락'); }

      // 6. Twitter card
      const twCard = html.match(/<meta\s+name=["']twitter:card["']/i);
      if (!twCard) { score -= 5; issues.push('twitter:card 누락'); }

      // 7. JSON-LD
      const jsonLd = html.match(/<script\s+type=["']application\/ld\+json["']/i);
      if (!jsonLd) { score -= 15; issues.push('JSON-LD 구조화 데이터 누락'); }

      // 8. Viewport
      const viewport = html.match(/<meta\s+name=["']viewport["']/i);
      if (!viewport) { score -= 10; issues.push('Viewport 메타태그 누락'); }

      // 9. 이미지 alt 누락
      const imgsWithoutAlt = [...html.matchAll(/<img(?![^>]*\balt=)[^>]*>/gi)];
      if (imgsWithoutAlt.length > 0) { score -= 5; issues.push(`alt 속성 없는 이미지 (${imgsWithoutAlt.length}개)`); }

      // 10. 텍스트 분량
      const cleanText = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                            .replace(/<style[\s\S]*?<\/style>/gi, '')
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/\s+/g, ' ').trim();
      const textLen = cleanText.length;
      if (textLen < 300) { score -= 15; issues.push(`본문 텍스트 분량 부족 (${textLen}자)`); }

      results.push({ name: p.name, url: p.url, score: Math.max(0, score), issues, textLen, title, descLen: desc.length });
    } catch (e) {
      results.push({ name: p.name, url: p.url, error: e.message });
    }
  }

  // 점수 오름차순 정렬 (점수가 낮은 페이지가 위로)
  results.sort((a, b) => (a.score || 0) - (b.score || 0));

  console.log('=== [SEO 전수 진단 결과 요약] ===');
  for (const r of results) {
    if (r.error) {
      console.log(`❌ ${r.name}: 오류 (${r.error})`);
    } else {
      const badge = r.score < 80 ? '🔴' : (r.score < 95 ? '🟡' : '🟢');
      console.log(`${badge} [${r.score}점] ${r.name} (글자수: ${r.textLen}자, Description: ${r.descLen}자)`);
      if (r.issues.length) console.log(`   └─ 이슈: ${r.issues.join(' | ')}`);
    }
  }
}

audit();
