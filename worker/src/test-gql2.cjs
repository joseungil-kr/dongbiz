const fs = require('fs');
async function run() {
  const html = fs.readFileSync('c:/project/대행사 에이젼시 기획/worker/src/dump.html', 'utf8');
  const mainJsSrc = html.match(/<script defer data-chunk="main" src="([^"]+place\.main[^"]+\.js)"><\/script>/)[1];
  console.log('Main JS:', mainJsSrc);
  const jsRes = await fetch(mainJsSrc);
  const jsText = await jsRes.text();
  const queries = jsText.match(/query\s+\w+\([^)]*\)\s*\{[\s\S]*?\}(?=")/g) || [];
  fs.writeFileSync('c:/project/대행사 에이젼시 기획/worker/src/queries.txt', queries.join('\n\n---\n\n'), 'utf8');
  console.log('Queries found:', queries.length);
}
run();
