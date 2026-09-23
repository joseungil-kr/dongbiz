const fs = require('fs');
async function run() {
  const html = fs.readFileSync('c:/project/대행사 에이젼시 기획/worker/src/dump.html', 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+\.js)"[^>]*><\/script>/g)].map(m => m[1]);
  let allQueries = [];
  for (const src of scripts) {
    if(!src.includes('g-place.pstatic.net/assets')) continue;
    console.log('Fetching', src);
    const res = await fetch(src);
    const text = await res.text();
    const queries = text.match(/query\s+\w+\([^)]*\)\s*\{[\s\S]*?\}(?=")/g) || [];
    allQueries.push(...queries);
  }
  fs.writeFileSync('c:/project/대행사 에이젼시 기획/worker/src/queries.txt', allQueries.join('\n\n---\n\n'), 'utf8');
  console.log('Total queries:', allQueries.length);
}
run();
