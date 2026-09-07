const placeId = '2058645213';

async function inspectState(id) {
  const detailHtmlUrl = `https://m.place.naver.com/place/${id}/home`;
  const res = await fetch(detailHtmlUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if (apolloMatch) {
    const state = JSON.parse(apolloMatch[1]);
    console.log('Available Root Keys in APOLLO_STATE:');
    const keys = Object.keys(state);
    console.log(keys.filter(k => k.includes(id) || k.includes('Place') || k.includes('ROOT')));
    // 그 중 하나 출력
    const matched = keys.find(k => k.includes(id));
    console.log('Sample matched key:', matched, state[matched]);
  }
}

inspectState(placeId);
