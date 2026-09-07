import fs from 'fs';

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
        
        if (pdKey && rootQuery[pdKey] && rootQuery[pdKey].informationTab) {
            const infoTab = rootQuery[pdKey].informationTab;
            const infoRef = infoTab.__ref || infoTab; // check if it's a reference
            const infoObj = typeof infoRef === 'string' ? state[infoRef] : infoRef;
            
            console.log(placeId, '->', infoObj?.keywordList);
        }
    }
}
test('1785101394');
test('1515578361');
