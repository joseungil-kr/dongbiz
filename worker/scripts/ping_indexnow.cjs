const fs = require('fs');
const path = require('path');

const INDEXNOW_KEY = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const HOST = 'dongbiz.com';
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`;

async function getGuideSlugs() {
  const slugs = [];
  try {
    const guidesPath = path.join(__dirname, '..', 'src', 'guides.ts');
    if (fs.existsSync(guidesPath)) {
      const content = fs.readFileSync(guidesPath, 'utf8');
      const matches = [...content.matchAll(/slug:\s*'([^']+)'/g)];
      for (const m of matches) {
        if (!slugs.includes(m[1])) slugs.push(m[1]);
      }
    }

    const dropPath = path.join(__dirname, '..', 'src', 'guide-drop.ts');
    if (fs.existsSync(dropPath)) {
      const dropContent = fs.readFileSync(dropPath, 'utf8');
      const dropMatches = [...dropContent.matchAll(/slug:\s*'([^']+)'/g)];
      for (const m of dropMatches) {
        if (!slugs.includes(m[1])) slugs.push(m[1]);
      }
    }
  } catch (err) {
    console.error('[IndexNow] 가이드 슬러그 파싱 중 오류:', err.message);
  }
  return slugs;
}

async function pingEndpoint(name, endpointUrl, payload) {
  try {
    console.log(`[IndexNow] ${name} 전송 중 (${payload.urlList.length}개 URL)...`);
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`[IndexNow] ✅ ${name} 전송 성공 (${res.status}): ${text || 'OK'}`);
    } else {
      console.warn(`[IndexNow] ⚠️ ${name} 응답 코드 ${res.status}: ${text || res.statusText}`);
    }
  } catch (err) {
    console.error(`[IndexNow] ❌ ${name} 전송 실패:`, err.message);
  }
}

async function main() {
  console.log('\n🚀 [IndexNow 자동 배포] 발행된 기사(가이드) 및 주요 URL 색인 통보 시작');

  const slugs = await getGuideSlugs();
  const guideUrls = slugs.map(s => `https://${HOST}/guide/${encodeURIComponent(s)}`);

  const urlList = [
    `https://${HOST}/`,
    `https://${HOST}/guide`,
    `https://${HOST}/rank`,
    ...guideUrls
  ];

  console.log(`[IndexNow] 대상 URL 총 ${urlList.length}건 (가이드 ${slugs.length}건 포함)`);

  const payload = {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList: urlList
  };

  // 1. 네이버 서치어드바이저 IndexNow API
  await pingEndpoint('네이버 서치어드바이저', 'https://searchadvisor.naver.com/indexnow', payload);

  // 2. 표준 IndexNow API (Bing / Yandex / Seznam)
  await pingEndpoint('IndexNow 표준(Bing/Yandex)', 'https://api.indexnow.org/indexnow', payload);

  console.log('✨ [IndexNow 자동 배포] 완료!\n');
}

main().catch(err => {
  console.error('[IndexNow] 치명적 오류:', err);
});
