const placeId = '1945990889';

async function checkBlogRef(id) {
  const homeUrl = `https://m.place.naver.com/place/${id}/home`;
  const res = await fetch(homeUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
  const state = JSON.parse(apolloMatch[1]);
  console.log('BaseNaverBlog data:', state['BaseNaverBlog:hp8279']);
}

checkBlogRef(placeId);
