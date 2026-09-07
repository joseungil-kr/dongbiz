const keyword = process.argv[2] || '안산맛집';

async function parseOrganicPlaces(kw) {
  console.log(`[RANK-INSPECT] 키워드: "${kw}" 오가닉 순위 파싱 중...`);

  // 네이버 모바일 통합검색 (m.search.naver.com)
  const searchUrl = `https://m.search.naver.com/search.naver?where=m&query=${encodeURIComponent(kw)}`;
  const res = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'text/html,application/xhtml+xml',
    }
  });

  const html = await res.text();

  // 플레이스 카드 아이템 추출
  // 네이버 플레이스 모바일 검색 결과의 각 아이템 블록 분석
  const regex = /<li[^>]*data-cid="(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  const results = [];

  while ((match = regex.exec(html)) !== null) {
    const id = match[1];
    const content = match[2];

    const isAd = content.includes('광고') || content.includes('sp_ad') || content.includes('ico_ad');
    const nameMatch = content.match(/class="[^"]*YwYLL[^"]*">([^<]+)<\/span>/i) || content.match(/class="[^"]*Fc1rA[^"]*">([^<]+)<\/span>/i) || content.match(/<span class="name[^"]*">([^<]+)<\/span>/i) || content.match(/<strong>([^<]+)<\/strong>/i);

    results.push({
      id,
      name: nameMatch ? nameMatch[1] : '이름 미추출',
      isAd
    });
  }

  console.log(`전체 추출된 업체 수: ${results.length}`);
  const ads = results.filter(r => r.isAd);
  const organics = results.filter(r => !r.isAd);

  console.log(`• 광고(AD) 업체: ${ads.length}개`);
  console.log(`• 순수 오가닉(유기적 상위) 업체: ${organics.length}개`);
  console.log('\n[오가닉 1위 ~ 5위 업체]');
  organics.slice(0, 5).forEach((item, idx) => {
    console.log(`   순위 ${idx + 1}위: [ID: ${item.id}] ${item.name}`);
  });
}

parseOrganicPlaces(keyword);
