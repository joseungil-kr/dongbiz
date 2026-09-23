const fs = require('fs');
async function run() {
  const html = fs.readFileSync('c:/project/대행사 에이젼시 기획/worker/src/dump.html', 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+\.js)"[^>]*><\/script>/g)].map(m => m[1]);
  for (const src of scripts) {
    if(!src.includes('g-place.pstatic.net/assets')) continue;
    const res = await fetch(src);
    const text = await res.text();
    if(text.includes('getPlaceDetail')) {
      console.log('FOUND IN', src);
      const match = text.match(/query\s+getPlaceDetail\b[^"]+/);
      if(match) {
        fs.writeFileSync('c:/project/대행사 에이젼시 기획/worker/src/getPlaceDetail.txt', match[0], 'utf8');
        console.log('Saved to getPlaceDetail.txt');
      }
    }
  }
}
run();
