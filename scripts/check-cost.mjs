import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const content = JSON.parse(readFileSync(new URL('data/content.json', root), 'utf8'));
const mapping = JSON.parse(readFileSync(new URL('data/page-places.json', root), 'utf8'));
const text = s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
export function checkDetail(html, slug) {
  assert.equal((html.match(/<h1\b/g)||[]).length, 1, 'H1');
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
  assert.ok(html.includes(`rel="canonical" href="https://dongbiz.com/cost/${encodeURIComponent(slug)}"`));
  for (const tag of ['og:title','og:description','og:url','twitter:card','twitter:title','twitter:description']) assert.ok(html.includes(`="${tag}"`), tag);
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  for (const type of ['Article','BreadcrumbList','FAQPage']) assert.ok(graph.some(x=>x['@type']===type),type);
  const faqs = [...html.matchAll(/<details><summary>(.*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(m=>({q:text(m[1]),a:text(m[2])}));
  assert.deepEqual(faqs,content[slug].faqs);
  assert.deepEqual(graph.find(x=>x['@type']==='FAQPage').mainEntity.map(f=>({q:f.name,a:f.acceptedAnswer.text})),faqs);
  assert.deepEqual([...html.matchAll(/data-place-id="(\d+)"/g)].map(m=>m[1]),mapping[slug].placeIds);
  const body = html.match(/<div id="cost-body">([\s\S]*?)<\/div>/)[1];
  for (const section of content[slug].sections) for (const p of section.paragraphs) {
    const plain = p.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/\*\*([^*]+)\*\*/g,'$1');
    assert.ok(text(body).includes(plain), 'paragraph retained');
  }
  const ctas = html.match(/<div class="cost-ctas">([\s\S]*?)<\/div>/)[1];
  assert.equal((ctas.match(/<a /g)||[]).length,2);
  assert.match(ctas,/href="\/"/);
  assert.match(ctas,/href="\/guide\/플레이스정보수정순위"/);
  const related = html.match(/id="cost-related">([\s\S]*?)<\/section>/)[1];
  assert.equal((related.match(/href="\/cost\//g)||[]).length,6);
  assert.equal((related.match(/href="\/guide\//g)||[]).length,2);
  assert.equal((related.match(/href="\/rank\//g)||[]).length,1);
  assert.ok(html.indexOf('aeo-direct-answer') < html.indexOf('id="cost-body"'));
  return {slug,bodyChars:text(body).length,rows:mapping[slug].placeIds.length,faqs:faqs.length,status:'PASS'};
}

async function main() {
  const base = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/$/,'');
  const results=[];
  for (const route of ['/cost',...Object.keys(mapping).map(s=>'/cost/'+encodeURIComponent(s)),'/','/rank','/guide','/guide/'+encodeURIComponent('플레이스순위조회'),'/sitemap.xml']) {
    try {
      const res=await fetch(base+route,{signal:AbortSignal.timeout(15000)});
      assert.equal(res.status,200,route);
      const html=await res.text();
      if(route.startsWith('/cost/')) results.push(checkDetail(html,decodeURIComponent(route.slice(6))));
      else {
        if(route==='/sitemap.xml') for(const suffix of ['',...Object.keys(mapping).map(s=>'/'+encodeURIComponent(s))]) assert.ok(html.includes(`<loc>https://dongbiz.com/cost${suffix}</loc>`));
        results.push({route,status:'PASS'});
      }
    } catch(e) {results.push({route,status:'FAIL',error:e.message});}
  }
  console.log(JSON.stringify(results,null,2));
  writeFileSync(new URL('REPORTS/http-check.json',root),JSON.stringify(results,null,2)+'\n');
  if(results.some(r=>r.status==='FAIL')) process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await main();
