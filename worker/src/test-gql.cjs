const fs = require('fs');
async function run() {
  const res = await fetch('https://m.place.naver.com/place/1994640103/home', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
  });
  const html = await res.text();
  fs.writeFileSync('c:/project/대행사 에이젼시 기획/worker/src/dump.html', html, 'utf8');
  console.log('Dumped. Length:', html.length);
}
run();
