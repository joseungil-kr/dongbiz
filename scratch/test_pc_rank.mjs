const keyword = process.argv[2] || '안산맛집';

async function parsePCPlaces(kw) {
  const searchUrl = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(kw)}`;
  const res = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  });

  const html = await res.text();
  console.log('HTML Length:', html.length);

  // 플레이스 섹션 찾기
  // data-cid 또는 map.naver.com 링크 주변 텍스트 분석
  // 네이버 지도 URL 패턴: /p/search/.../place/(\d+) 및 /p/entry/place/(\d+)
  const regex = /href="(https?:\/\/map\.naver\.com\/p\/(?:search\/[^/]+\/place|entry\/place)\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const list = [];

  while ((match = regex.exec(html)) !== null) {
    const link = match[1];
    const id = match[2];
    const inner = match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (inner && !list.find(x => x.id === id)) {
      // 주변 영역 context 확인
      const surrounding = html.slice(Math.max(0, match.index - 300), match.index + 300);
      const isAd = surrounding.includes('ico_ad') || surrounding.includes('광고') || surrounding.includes('sp_ad');
      
      let area = '기본';
      const areaMatch = surrounding.match(/data-nlog-area="([^"]+)"/);
      if (areaMatch) area = areaMatch[1];

      list.push({ id, name: inner, isAd, area });
    }
  }

  console.log(`추출된 플레이스 개수: ${list.length}`);
  list.forEach((item, idx) => {
    console.log(`${idx + 1}. [영역: ${item.area}] [${item.isAd ? '광고(AD)' : '순수오가닉'}] ${item.name} (ID: ${item.id})`);
  });
}

parsePCPlaces(keyword);
