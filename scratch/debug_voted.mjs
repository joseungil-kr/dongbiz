const placeId = '2058645213';

async function checkVoted() {
  const detailUrl = `https://m.place.naver.com/place/${placeId}/home`;
  const res = await fetch(detailUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  const state = JSON.parse(apolloMatch[1]);
  const reviewKey = Object.keys(state).find(k => k.startsWith(`VisitorReviewStatsResult:${placeId}`));
  console.log('votedKeyword data:', JSON.stringify(state[reviewKey]?.analysis?.votedKeyword, null, 2));
}

checkVoted();
