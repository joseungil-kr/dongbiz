import fs from 'fs';

async function test(placeId) {
    const res = await fetch(`https://m.place.naver.com/place/${placeId}/news`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
    });
    const html = await res.text();
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (!apolloMatch) return console.log('No apollo state in news for', placeId);
    
    const state = JSON.parse(apolloMatch[1]);
    const keys = Object.keys(state);
    
    const newsKeys = keys.filter(k => k.toLowerCase().includes('news') || k.toLowerCase().includes('feed'));
    console.log(placeId, 'news keys:', newsKeys);
    if(newsKeys.length > 0) {
      console.log(state[newsKeys[0]]);
    }
}
test('2058645213'); // 백세보리밥
test('1515578361'); // 수원금은방
