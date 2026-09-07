import fs from 'fs';

async function test(placeId) {
    const res = await fetch(`https://m.place.naver.com/place/${placeId}/home`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
    });
    const html = await res.text();
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
    const state = JSON.parse(apolloMatch[1]);
    const keys = Object.keys(state);
    
    const rootQueryKey = keys.find(k => k === 'ROOT_QUERY');
    const rootQuery = state[rootQueryKey];
    const pdKey = Object.keys(rootQuery).find(k => k.startsWith('placeDetail'));
    const pd = rootQuery[pdKey];
    
    console.log(placeId, 'images:', pd.images);
    if(pd.images && pd.images.__ref) {
       console.log('totalCount:', state[pd.images.__ref]);
    }
    
    console.log(placeId, 'topPhotos:', pd.topPhotos);
    
    console.log('hasFeed:', pd.hasFeed);
}
test('2058645213'); // 백세보리밥
test('1515578361'); // 수원금은방
