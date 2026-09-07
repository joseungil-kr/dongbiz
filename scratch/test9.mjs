import fs from 'fs';

async function test(placeId) {
    const res = await fetch(`https://m.place.naver.com/place/${placeId}/home`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
    });
    const html = await res.text();
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
    const state = JSON.parse(apolloMatch[1]);
    const keys = Object.keys(state);
    
    // Just find any value that is a long string that looks like a description.
    for (const key of keys) {
      const obj = state[key];
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string' && v.length > 50) {
            console.log(placeId, key, k, '=>', v.slice(0, 50));
          }
        }
      }
    }
}
test('2058645213'); // 백세보리밥 닭한마리
