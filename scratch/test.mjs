import fs from 'fs';
const res = await fetch('https://m.place.naver.com/place/2058645213/home', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
  }
});
const html = await res.text();
const match = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});/);
if (match) {
  const state = JSON.parse(match[1]);
  const keys = Object.keys(state);
  keys.forEach(k => {
    const s = JSON.stringify(state[k]);
    if(s.includes('keywordList') || s.includes('keywords')) {
      console.log('KEY:', k);
      console.log('JSON:', s.substring(0, 300));
    }
  });
}
