const assert = require('node:assert/strict');
const { load, kv, detail, feed, id } = require('./collection.cjs');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const graphql = (items, total = items.length) => new Response(JSON.stringify([{ data: { restaurants: {
  businesses: { items, total, siteSort: 'rel.dsc' }
} } }]));
const candidateHtml = () => 'window.__APOLLO_STATE__ = ' + JSON.stringify({
  'PlaceListBusinessesItem:7654321': { id: '7654321', name: '같은상호', fullAddress: '다른 지점' },
  ['PlaceListBusinessesItem:' + id]: { id, name: '<mark>같은상호</mark>', fullAddress: '내 지점' },
  ROOT_QUERY: {
    'placeList({"input":{"start":1,"display":7}})': { businesses: { total: 2,
      items: [{ __ref: 'PlaceListBusinessesItem:' + id }, { __ref: 'PlaceListBusinessesItem:7654321' }] } },
    'placeList({"input":{"start":1,"display":9,"filterOpening":"true"}})': { businesses: { items: [{ id: '9999999', name: '추천 광고' }] } }
  }
}) + ';';

test('name searches return choices; no detail request until selection', async () => {
  const urls = [];
  const app = load('src/index.ts', async url => {
    urls.push(url); return new Response(url.includes('search.naver') ? candidateHtml() : url.endsWith('/feed') ? feed : detail);
  }).default;
  const env = { CACHE: kv() }, ctx = { waitUntil() {} };
  const result = await app.fetch(new Request('https://local/api/place?query=' + encodeURIComponent('같은상호')), env, ctx);
  const choices = await result.json();
  assert.equal(choices.requiresSelection, true);
  assert.equal(choices.candidates.length, 2); assert.equal(choices.candidates[0].placeId, id);
  assert.equal(choices.candidates[0].name, '같은상호'); assert.equal(urls.length, 1);
  const selected = await app.fetch(new Request('https://local/api/place?query=' + id), env, ctx);
  assert.equal(selected.status, 200); assert.equal((await selected.json()).myStore.placeId, id);
});
test('phone, link and ID bypass name candidate selection', async () => {
  const s = load('src/place-search.ts', () => { throw new Error('no network'); });
  for (const value of ['0507-1234-5678', '031 123 4567', 'https://naver.me/test', 'naver.me/test', id]) assert.equal(s.isStoreName(value), false);
  assert.equal(s.isStoreName('매장 지점명'), true);
});
test('350 entries come from seven ordered API pages, target rank survives past 300', async () => {
  const starts = [];
  const s = load('src/place-search.ts', async (url, init) => {
    assert.equal(url, 'https://pcmap-api.place.naver.com/graphql');
    const start = JSON.parse(init.body)[0].variables.input.start; starts.push(start);
    return graphql(Array.from({ length: 50 }, (_, i) => ({ id: start + i === 327 ? id : String(8000000 + start + i), name: '업체' + (start + i) })), 500);
  });
  const listing = await s.collectSearchListing('지역 맛집', 'restaurant');
  assert.deepEqual(starts, [1, 51, 101, 151, 201, 251, 301]);
  assert.equal(listing.items.length, 350); assert.equal(listing.items.findIndex(x => x.placeId === id) + 1, 327);
  assert.equal(listing.stopReason, 'limit');
});
test('failed later page preserves only confirmed prefix, overlapping page cannot invent ranks', async () => {
  for (const mode of ['blocked', 'overlap']) {
    let calls = 0;
    const s = load('src/place-search.ts', async () => {
      calls++;
      if (calls === 2 && mode === 'blocked') return new Response('', { status: 429 });
      return graphql(Array.from({ length: 50 }, (_, i) => ({ id: String(8000000 + i), name: '업체' + i })), 500);
    });
    const listing = await s.collectSearchListing('지역 맛집');
    assert.equal(calls, 2); assert.equal(listing.items.length, 50); assert.equal(listing.stopReason, 'collection_failed');
    assert.equal(listing.complete, false);
  }
});
test('terminal empty page preserves 300 confirmed rows and advertised total', async () => {
  const s = load('src/place-search.ts', async (url, init) => {
    const start = JSON.parse(init.body)[0].variables.input.start;
    if (start === 301) return new Response(JSON.stringify([{data:{restaurants:{businesses:{items:[],total:0,siteSort:null}}}}]));
    return graphql(Array.from({length:50},(_,i)=>({id:String(8000000+start+i),name:'업체'})),13477);
  });
  const list = await s.collectSearchListing('지역 맛집');
  assert.equal(list.items.length,300); assert.equal(list.total,13477);
  assert.equal(list.complete,false); assert.equal(list.stopReason,'end');
  assert.equal(list.errorCode,undefined);
});
test('explicit empty list is an empty result, GraphQL errors are failures', async () => {
  const empty = load('src/place-search.ts', async () => graphql([], 0));
  const listing = await empty.collectSearchListing('빈검색'); assert.equal(listing.items.length, 0); assert.equal(listing.complete, true);
  const fail = load('src/place-search.ts', async () => new Response(JSON.stringify([{ errors: [{ message: 'failure' }] }])));
  await assert.rejects(fail.collectSearchListing('빈검색'), e => e.code === 'PARSE_CHANGED');
});

function fakeDB(failWrite = false) {
  const histories = new Map();
  return { histories, prepare(sql) {
    let args;
    return { bind(...values) { args = values; return this; }, async run() {
      if (sql.includes('INSERT INTO search_histories')) {
        if (failWrite) throw new Error('DB unavailable');
        histories.set(args[0], { myRank: args[3], raw_data: args[9] });
      }
      return { success: true };
    }, async first() { return histories.get(args[0]) || null; } };
  }, async batch() { return []; } };
}
test('deep rank and source/range saved and restored; only successful analyses consume quota', async () => {
  const db = fakeDB(), cache = kv(), tasks = [];
  await cache.put(`place:v10:${id}:feed`, JSON.stringify({placeId:id,name:'Test',seoMetrics:{visitorReviewsTotal:12,hasTalktalk:false}}));
  const app = load('src/index.ts', async (url, init) => {
    if (url.includes('pcmap-api')) {
      const start = JSON.parse(init.body)[0].variables.input.start;
      return graphql(Array.from({length:50},(_,i)=>({id:start+i===137?id:String(8000000+start+i),name:'업체'+(start+i)})),500);
    }
    const match = url.match(/place\/(\d+)\/home/);
    assert.ok(match, 'only known detail URLs requested');
    return new Response(detail.replaceAll(id, match[1]));
  }).default;
  const env = { CACHE:cache, DB:db }, ctx = { waitUntil(p) { tasks.push(p); } };
  const req = () => new Request(`https://local/api/gap?placeId=${id}&keyword=지역맛집`, {headers:{'CF-Connecting-IP':'fixture'}});
  const response = await app.fetch(req(),env,ctx);
  const data = await response.json(); assert.equal(response.status,200);
  assert.equal(data.myRank,137); assert.equal(data.rankSearched,350); assert.equal(data.comparisonCount,6);
  assert.equal(data.rankObservation.source,'naver-map');
  assert.equal(db.histories.get(data.shareId).myRank,137);
  const restored = await app.fetch(new Request(`https://local/api/history?shareId=${data.shareId}`),env,ctx);
  assert.deepEqual(await restored.json(),data);
  assert.ok([...cache.values.entries()].some(([k,v])=>k.startsWith('gaplimit:')&&v==='1'));
  await Promise.all(tasks);
});
test('failed collection and failed persistence do not spend daily allowance', async () => {
  for (const failure of ['collection','database']) {
    const cache = kv();
    await cache.put(`place:v10:${id}:feed`, JSON.stringify({placeId:id,name:'Test',seoMetrics:{visitorReviewsTotal:12,hasTalktalk:false}}));
    const app = load('src/index.ts',async url=> {
      if(failure==='collection')return new Response('',{status:429});
      if(url.includes('pcmap-api'))return graphql([{id:'7654321',name:'다른업체'}]);
      return new Response(detail.replaceAll(id,'7654321'));
    }).default;
    const res=await app.fetch(new Request(`https://local/api/gap?placeId=${id}&keyword=지역맛집`),{CACHE:cache,DB:fakeDB(true)},{waitUntil(){}});
    assert.equal(res.status,503);
    assert.equal([...cache.values.keys()].some(k=>k.startsWith('gaplimit:')),false);
  }
});

module.exports={candidateHtml,graphql,fakeDB};
if(require.main===module)(async()=>{for(const [name,fn] of tests){await fn();console.log('PASS '+name);}console.log(`${tests.length} search checks passed.`);})().catch(err=>{console.error(err);process.exitCode=1;});
