async function run() {
  const res = await fetch('https://m.place.naver.com/place/1994640103/home', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    }
  });
  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if (!apolloMatch) { console.log("NO APOLLO"); return; }
  const state = JSON.parse(apolloMatch[1]);
  const pdKey = Object.keys(state.ROOT_QUERY).find(k => k.startsWith('placeDetail'));
  console.log('pdKey:', pdKey);
  console.log('pd value:', state.ROOT_QUERY[pdKey]);
}
run();
