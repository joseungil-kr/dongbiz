import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { checkDetail } from './check-cost.mjs';
const root = new URL('../',import.meta.url);
const require = createRequire(new URL('worker/package.json',root));
const esbuild = require('esbuild');
mkdirSync(new URL('worker/.wrangler/cost-test/',root),{recursive:true});
const outfile = new URL('worker/.wrangler/cost-test/cost.mjs',root);
await esbuild.build({entryPoints:[new URL('worker/src/cost-pages.ts',root).pathname.slice(1)],bundle:true,platform:'node',format:'esm',outfile:outfile.pathname.slice(1)});
const {COST_PAGES,COST_URLS,renderCostPage,renderCostHub,costPlaces} = await import(outfile.href);
assert.equal(COST_PAGES.length,15);
assert.equal(new Set(COST_URLS).size,16);
assert.equal(renderCostPage('missing'),null);
const sources=readdirSync(new URL('data/places',root)).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(new URL('data/places/'+f,root),'utf8')));
const results=COST_PAGES.map(p=>{
  const html=renderCostPage(p.slug);
  for(const place of costPlaces(p.slug)) {
    const original=sources.find(s=>s.keyword===place.sourceKeyword).items.find(x=>x.placeId===place.placeId);
    assert.equal(original.regionOk,true);
    for(const key of ['name','category','visitorReviewCount','blogCafeReviewCount','fullAddress','rank']) assert.equal(place[key],original[key]);
  }
  return checkDetail(html,p.slug);
});
const hub=renderCostHub();
assert.equal((hub.match(/<h1\b/g)||[]).length,1);
const graph=JSON.parse(hub.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
assert.equal(graph[0]['@type'],'CollectionPage');
assert.equal(graph[1].itemListElement.length,15);
const index=readFileSync(new URL('worker/src/index.ts',root),'utf8');
assert.ok(index.includes('...COST_URLS.map((url, i)'));
assert.ok(index.includes('...COST_URLS,'));
const ping=readFileSync(new URL('worker/scripts/ping_indexnow.cjs',root),'utf8');
assert.ok(ping.includes('https://${HOST}/cost'));
writeFileSync(new URL('REPORTS/static-check.json',root),JSON.stringify(results,null,2)+'\n');
console.log(`PASS: 15 detail pages, 150 source-matched rows, 45 FAQs, hub metadata, 16 SEO URLs.\n${JSON.stringify(results,null,2)}`);
