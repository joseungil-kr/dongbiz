import fs from 'fs';
const searchUrl = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent('수원금매입전문점')}`;
const searchRes = await fetch(searchUrl, {
  headers: {
    'User-Agent': 'Mozilla/5.0'
  }
});
const searchHtml = await searchRes.text();
const match = searchHtml.match(/https?:\/\/map\.naver\.com\/p\/(?:search\/[^/]+\/place|entry\/place)\/(\d+)/i) || 
              searchHtml.match(/https?:\/\/map\.naver\.com\/v5\/entry\/place\/(\d+)/i) ||
              searchHtml.match(/data-cid="(\d+)"/i) ||
              searchHtml.match(/place\/(\d+)/i);
if(match) {
    const placeId = match[1];
    console.log('Found placeId:', placeId);
    const res = await fetch(`https://m.place.naver.com/place/${placeId}/home`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
    });
    const html = await res.text();
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if(apolloMatch) {
        const state = JSON.parse(apolloMatch[1]);
        const baseKey = Object.keys(state).find(k => k.startsWith(`PlaceDetailBase:${placeId}`));
        const base = state[baseKey];
        console.log('base.keywords:', base.keywords);
        console.log('base.keywordList:', base.keywordList);
        console.log('base.description:', base.description);
        
        // Let's find any object with keywordList
        Object.keys(state).forEach(k => {
            if(JSON.stringify(state[k]).includes('keywordList') || JSON.stringify(state[k]).includes('keywords')) {
                console.log('KEY:', k);
                console.log('JSON:', JSON.stringify(state[k]).substring(0, 300));
            }
        });
    }
}
