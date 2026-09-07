const query = process.argv[2] || '0314070103';

async function testNaverWebSearch() {
  console.log(`[TEST] 네이버 통합 검색 스크래핑: "${query}"`);
  const url = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(query)}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  const res = await fetch(url, { headers });
  const html = await res.text();

  // 1. JSON-LD 스키마 추출 시도
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const parsed = JSON.parse(jsonLdMatch[1]);
      console.log('JSON-LD 발견:', parsed);
    } catch(e) {}
  }

  // 2. 플레이스 링크 추출 (map.naver.com/p/entry/place/...)
  const placeMatch = html.match(/https?:\/\/map\.naver\.com\/p\/entry\/place\/(\d+)/i) || 
                     html.match(/https?:\/\/map\.naver\.com\/v5\/entry\/place\/(\d+)/i) ||
                     html.match(/data-cid="(\d+)"/i);

  if (placeMatch) {
    const placeId = placeMatch[1];
    console.log(`\n✅ 네이버 플레이스 ID 발견: ${placeId}`);
    console.log(`• 플레이스 링크: https://map.naver.com/p/entry/place/${placeId}`);
  }

  // 3. 업체 상호명 및 주소 추출 정규식
  const titleMatch = html.match(/<span class="YwYLL">([^<]+)<\/span>/i) || 
                     html.match(/<span class="Fc1rA">([^<]+)<\/span>/i) ||
                     html.match(/<strong class="tit[^"]*">([^<]+)<\/strong>/i) ||
                     html.match(/data-title="([^"]+)"/i);

  const addressMatch = html.match(/<span class="LDgIH">([^<]+)<\/span>/i) ||
                       html.match(/<span class="addr[^"]*">([^<]+)<\/span>/i);

  if (titleMatch || placeMatch) {
    console.log('========================================');
    console.log('🎉 [서버사이드 스크래핑 성공!]');
    console.log('========================================');
    console.log(`• 상호명:      ${titleMatch ? titleMatch[1] : '추출중'}`);
    console.log(`• 주소:        ${addressMatch ? addressMatch[1] : '상세 추출 가능'}`);
    console.log(`• 검색 전화번호: ${query}`);
    console.log('========================================\n');
  } else {
    console.log('HTML 길이:', html.length);
    // 검색결과 텍스트 일부 스니펫 확인
    const bodySnippet = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 800);
    console.log('텍스트 스니펫:', bodySnippet);
  }
}

testNaverWebSearch();
