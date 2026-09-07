import fs from 'fs';

async function test(placeId) {
    const res = await fetch(`https://m.place.naver.com/place/${placeId}/home`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
    });
    const html = await res.text();
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
    const state = JSON.parse(apolloMatch[1]);
    const keys = Object.keys(state);
    
    // Find base and check ALL keys for description text
    const baseKey = keys.find(k => k.startsWith(`PlaceDetailBase:${placeId}`));
    const base = state[baseKey] || {};
    console.log(baseKey, Object.keys(base));
    console.log('base.description:', base.description);
    
    const rootQueryKey = keys.find(k => k === 'ROOT_QUERY');
    const rootQuery = state[rootQueryKey];
    const pdKey = Object.keys(rootQuery).find(k => k.startsWith('placeDetail'));
    console.log('pdKey keys', Object.keys(rootQuery[pdKey]));
    
    // News check
    const newsKeys = keys.filter(k => k.includes('Biznews') || k.includes('News') || k.includes('BizNews'));
    console.log('News keys:', newsKeys);
    if(newsKeys.length) {
      console.log('News data:', state[newsKeys[0]]);
    }
}
test('2058645213'); // 백세보리밥
