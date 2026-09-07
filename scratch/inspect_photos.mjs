const placeId = process.argv[2] || '2058645213';

async function fetchPhotoCount(id) {
  const photoUrl = `https://m.place.naver.com/place/${id}/photo`;
  const res = await fetch(photoUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  const html = await res.text();
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);

  if (apolloMatch) {
    const state = JSON.parse(apolloMatch[1]);
    const keys = Object.keys(state);
    const photoCategoryKey = keys.find(k => k.includes('PhotoCategories') || k.includes('PhotoCount') || k.includes('Photos'));
    console.log('Photo keys found:', keys.filter(k => k.toLowerCase().includes('photo')));
    if (photoCategoryKey) {
      console.log('Photo Category Data:', JSON.stringify(state[photoCategoryKey], null, 2));
    }
  }
}

fetchPhotoCount(placeId);
