import fs from 'fs';
 // Cannot import if it's not exported.

// I'll just write the exact logic and run it
async function test(placeId) {
    const res = await fetch(`https://m.place.naver.com/place/${placeId}/home`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
    });
    const html = await res.text();
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
    const state = JSON.parse(apolloMatch[1]);
    const keys = Object.keys(state);
    
    let keywordList = [];
    const rootQueryKey = keys.find(k => k === 'ROOT_QUERY');
    if (rootQueryKey) {
        const rootQuery = state[rootQueryKey];
        const pdKey = Object.keys(rootQuery).find(k => k.startsWith('placeDetail'));
        console.log('pdKey:', pdKey);
        
        if (pdKey && rootQuery[pdKey]) {
            console.log('rootQuery[pdKey]:', Object.keys(rootQuery[pdKey]));
            
            // Note: Wait! The GraphQL reference object might look like:
            // {"__ref": "PlaceDetail:1785101394"}
            // So rootQuery[pdKey] is NOT the actual PlaceDetail object, it's just a REFERENCE!
        }
    }
}
test('1785101394');
test('1515578361');
