import fs from 'fs';
const placeId = '1785101394';
const res = await fetch(`https://m.place.naver.com/place/${placeId}/home`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
});
const html = await res.text();
const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
if(apolloMatch) {
    const state = JSON.parse(apolloMatch[1]);
    
    // Recursive search
    function search(obj, path) {
        if (!obj) return;
        if (typeof obj === 'string') return;
        if (Array.isArray(obj)) {
            obj.forEach((v, i) => search(v, `${path}[${i}]`));
        } else if (typeof obj === 'object') {
            for (let k of Object.keys(obj)) {
                if (k.toLowerCase().includes('keyword')) {
                    console.log(`FOUND KEY: ${path}.${k} =`, obj[k]);
                }
                search(obj[k], `${path}.${k}`);
            }
        }
    }
    
    search(state, 'state');
} else {
    console.log('No apollo state found');
}
