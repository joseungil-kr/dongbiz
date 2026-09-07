const placeId = '1945990889';

async function checkBlogDetails(id) {
  const homeUrl = `https://m.place.naver.com/place/${id}/home`;
  const res = await fetch(homeUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  const state = JSON.parse(apolloMatch[1]);
  const baseKey = Object.keys(state).find(k => k.startsWith(`PlaceDetailBase:${id}`));
  console.log('naverBlog detail:', state[baseKey]?.naverBlog);
  console.log('homepages detail:', state[baseKey]?.homepages);
}

checkBlogDetails(placeId);
