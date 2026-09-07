import fs from 'fs';

async function test(placeId) {
    const res = await fetch(`https://m.place.naver.com/place/${placeId}/home`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
    });
    const html = await res.text();
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
    const state = JSON.parse(apolloMatch[1]);
    const keys = Object.keys(state);
    
    const baseKey = keys.find(k => k.startsWith(`PlaceDetailBase:${placeId}`));
    const base = state[baseKey] || {};
    console.log(placeId, 'base.description:', base.description);
    console.log(placeId, 'base.microReviews:', base.microReviews);
    
    // Check News
    const newsKeys = keys.filter(k => k.startsWith(`BiznewsItem:`));
    console.log(placeId, 'news keys:', newsKeys);
    if (newsKeys.length > 0) {
      const firstNews = state[newsKeys[0]];
      console.log('first news:', firstNews.title, firstNews.createdTs);
    }
    
    // Photos total count
    console.log(placeId, 'visitorReviewMediasTotal:', base.visitorReviewMediasTotal);
    
    // Also look inside ROOT_QUERY placeDetail
    const rootQueryKey = keys.find(k => k === 'ROOT_QUERY');
    const rootQuery = state[rootQueryKey];
    const pdKey = Object.keys(rootQuery).find(k => k.startsWith('placeDetail'));
    console.log('pd total photos?:', rootQuery[pdKey]?.images?.totalCount);
    
    // Let's print out what base actually has
    // console.log(Object.keys(base));
}
test('1785101394'); // Ansan Sky
test('1515578361'); // Suwon gold
