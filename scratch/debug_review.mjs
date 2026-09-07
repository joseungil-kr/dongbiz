const placeId = '2058645213';

async function checkReviewKeys() {
  const detailUrl = `https://m.place.naver.com/place/${placeId}/home`;
  const res = await fetch(detailUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  const state = JSON.parse(apolloMatch[1]);
  const keys = Object.keys(state);
  const reviewKey = keys.find(k => k.startsWith(`VisitorReviewStatsResult:${placeId}`));
  console.log('reviewKey:', reviewKey);
  const reviewStats = state[reviewKey];
  console.log('reviewStats analysis keys:', Object.keys(reviewStats?.analysis || {}));
  console.log('votedKeywords count:', reviewStats?.analysis?.votedKeywords?.length);
  if (reviewStats?.analysis?.votedKeywords) {
    console.log('First 3 votedKeywords:', reviewStats.analysis.votedKeywords.slice(0, 3));
  }
}

checkReviewKeys();
