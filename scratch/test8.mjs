import fs from 'fs';

async function test(placeId) {
    const res = await fetch(`https://m.place.naver.com/place/${placeId}/home`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
    });
    const html = await res.text();
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
    const state = JSON.parse(apolloMatch[1]);
    const keys = Object.keys(state);
    
    // Find who has description
    const descKeys = keys.filter(k => state[k] && typeof state[k] === 'object' && ('description' in state[k]));
    console.log(placeId, 'desc keys:', descKeys.map(k => `${k} -> ${String(state[k].description).slice(0, 30)}`));
    
    // Find who has total photos
    const totalKeys = keys.filter(k => state[k] && typeof state[k] === 'object' && ('totalCount' in state[k] || 'photoCount' in state[k] || 'imageCount' in state[k] || 'total' in state[k]));
    console.log(placeId, 'total photos/counts keys:', totalKeys);
    
    // Find news
    const newsKeys = keys.filter(k => k.toLowerCase().includes('news') || k.toLowerCase().includes('notice'));
    console.log(placeId, 'news keys:', newsKeys);
}
test('1785101394');
test('1515578361');
