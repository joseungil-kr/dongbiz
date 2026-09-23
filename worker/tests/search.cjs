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
test('name search falls back to the map list when integrated search has no usable list', async () => {
  const s = load('src/place-search.ts', async (url) => {
    if (url.includes('search.naver.com')) return new Response('window.__APOLLO_STATE__ = {"ROOT_QUERY":{}};');
    return graphql([{ id, name: 'Dream Studio' }], 1);
  });
  const candidates = await s.searchPlaceCandidates('Dream Studio');
  assert.equal(candidates.map(x => x.placeId).join(','), id);
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
test('listing stops at the provider total instead of requesting pages beyond it', async () => {
  const starts = [];
  const s = load('src/place-search.ts', async (url, init) => {
    const start = JSON.parse(init.body)[0].variables.input.start; starts.push(start);
    return graphql(Array.from({ length: 50 }, (_, i) => ({ id: String(start + i), name: 'Store' })), 60);
  });
  await s.collectSearchListing('Doll hospital');
  assert.deepEqual(starts, [1, 51]);
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
        histories.set(args[0], { placeId: args[1], targetKeyword: args[2], myRank: args[3], raw_data: args[9], created_at: new Date().toISOString() });
      }
      return { success: true };
    }, async first() { return histories.get(args[0]) || null; }, async all() {
      if (!sql.includes('FROM search_histories')) return { results: [] };
      return { results: [...histories.values()]
        .filter(row => row.placeId === args[0] && row.targetKeyword === args[1] && row.myRank != null)
        .map(row => ({ my_rank: row.myRank, raw_data: row.raw_data, created_at: row.created_at }))
        .reverse().slice(0, 8) };
    } };
  }, async batch() { return []; } };
}
test('deep rank and source/range saved and restored; only successful analyses consume quota', async () => {
  const db = fakeDB(), cache = kv(), tasks = [];
  await cache.put(`place:v10:${id}:feed`, JSON.stringify({placeId:id,name:'Test',seoMetrics:{visitorReviewsTotal:12,hasTalktalk:false}}));
  const app = load('src/index.ts', async (url, init) => {
    if (url.includes('pcmap-api')) {
      const start = JSON.parse(init.body)[0].variables.input.start;
      return graphql(Array.from({length:50},(_,i)=>({id:start+i===137?id:String(8000000+start+i),name:'업체'+(start+i),saveCount:start <= 1 && i < 6 ? '100+' : null})),500);
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
  assert.equal(data.stats.saveCount.avg,100); assert.equal(data.stats.saveCount.count,6);
  assert.equal(data.rankObservation.source,'naver-map');
  assert.deepEqual(data.rankHistory.map(x=>x.rank),[137]);
  assert.equal(db.histories.get(data.shareId).myRank,137);
  const restored = await app.fetch(new Request(`https://local/api/history?shareId=${data.shareId}`),env,ctx);
  assert.deepEqual(await restored.json(),data);
  const repeated = await app.fetch(req(),env,ctx);
  const repeatedData = await repeated.json();
  assert.deepEqual(repeatedData.rankHistory.map(x=>x.rank),[137,137]);
  assert.ok([...cache.values.entries()].some(([k,v])=>k.startsWith('gaplimit:')&&v==='2'));
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

test('rate-limited keyword reuses its latest successful map observation without a widget retry', async () => {
  const cache = kv(), keyword = 'Stale keyword';
  let blocked = false, mapCalls = 0;
  const app = load('src/index.ts', async (url, init) => {
    if (url.includes('pcmap-api')) {
      mapCalls++;
      if (blocked) return new Response('', { status: 429 });
      return graphql(Array.from({length: 6}, (_, i) => ({ id: i === 0 ? id : String(8000100 + i), name: 'Store ' + i })), 6);
    }
    if (url.endsWith('/feed')) return new Response(feed);
    const match = url.match(/place\/(\d+)\/home/);
    assert.ok(match, 'stale observation must not use the legacy search widget');
    return new Response(detail.replaceAll(id, match[1]));
  }).default;
  const ctx = { waitUntil() {} };
  const request = () => new Request(`https://local/api/gap?placeId=${id}&keyword=${encodeURIComponent(keyword)}`);
  const first = await app.fetch(request(), { CACHE: cache }, ctx);
  assert.equal(first.status, 200, await first.text());
  cache.values.delete(`v9:map-list:v2:place:${keyword}`);
  blocked = true;
  const second = await app.fetch(request(), { CACHE: cache }, ctx);
  const data = await second.json();
  assert.equal(second.status, 200);
  assert.equal(data.rankObservation.status, 'stale_success');
  assert.equal(data.rankObservation.stale, true);
  assert.equal(mapCalls, 2);
  assert.ok([...cache.values.keys()].some(key => key.includes(':map-observation:v1:place:') && key.endsWith(':cooldown')));
});

test('keyword volume keeps related ad keywords, caches them, and never consumes the gap limit', async () => {
  let adCalls = 0;
  const app = load('src/index.ts', async url => {
    assert.ok(url.startsWith('https://api.searchad.naver.com/keywordstool?'));
    adCalls++;
    return new Response(JSON.stringify({ keywordList: [
      { relKeyword: '안산 맛집', monthlyPcQcCnt: '< 10', monthlyMobileQcCnt: 120, compIdx: '중간' },
      { relKeyword: '안산 맛집 추천', monthlyPcQcCnt: 80, monthlyMobileQcCnt: 240, compIdx: '높음' },
      { relKeyword: '안산 데이트 맛집', monthlyPcQcCnt: 20, monthlyMobileQcCnt: 30, compIdx: '낮음' },
      { relKeyword: '누락값', monthlyPcQcCnt: null, monthlyMobileQcCnt: 20, compIdx: '낮음' },
    ] }));
  }).default;
  const cache = kv(), env = { CACHE: cache, NAVER_AD_CUSTOMER_ID: 'customer', NAVER_AD_ACCESS_LICENSE: 'license', NAVER_AD_SECRET_KEY: 'secret' };
  const request = () => new Request('https://local/api/keyword-volume?q=' + encodeURIComponent('안산 맛집'), { headers: { 'CF-Connecting-IP': 'fixture' } });
  const first = await app.fetch(request(), env, { waitUntil() {} });
  assert.equal(first.status, 200);
  const data = await first.json();
  assert.equal(data.volume.pcUnderTen, true); assert.equal(data.volume.mobile, 120);
  assert.equal(data.related.length, 2); assert.equal(data.related[0].keyword, '안산 맛집 추천');
  assert.equal(adCalls, 1); assert.equal([...cache.values.keys()].some(k => k.startsWith('gaplimit:')), false);
  const second = await app.fetch(request(), env, { waitUntil() {} });
  assert.equal(second.status, 200); assert.equal(adCalls, 1);
});

test('keyword volume page has its menu and a parsable client interaction script', async () => {
  const app = load('src/index.ts', async () => { throw new Error('no network'); }).default;
  const response = await app.fetch(new Request('https://local/keyword-volume'), {}, { waitUntil() {} });
  const html = await response.text();
  assert.equal(response.status, 200); assert.match(html, /<title>네이버 키워드 검색량 조회 \| 동네장사<\/title>/); assert.match(html, /키워드의 <span>월간 검색량<\/span>을<br>정확한 데이터로 확인하세요/); assert.match(html, /월간 PC·모바일 검색량입니다\.<br>플레이스 순위 진단 횟수와는 별도로 조회됩니다/); assert.match(html, />검색할 키워드를 입력하세요<\/label>/); assert.match(html, /font-family:'Pretendard'/); assert.match(html, /max-width:672px/); assert.match(html, /background:#03C75A/); assert.match(html, /관련 키워드 더 보기/);
  const script = html.match(/<script>\(\(\) => \{.*?<\/script>/s);
  assert.ok(script, 'keyword volume client script exists');
  new Function(script[0].slice('<script>'.length, -'</script>'.length));
});

test('place selection returns focus to the Step 1 search card', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="step1Card"/);
  assert.match(html, /function focusStep1ForSelection\(\)/);
  assert.match(html, /focusStep1ForSelection\(\);\s*runDiagnose\(candidate\.placeId\)/);
});
test('gap result leads with priorities and hides the mini-site preview', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /플레이스 주요 지표/);
  assert.match(html, /지금 먼저 개선할 항목/);
  assert.match(html, /id="prioritySummary"/);
  assert.match(html, /id="resultOverviewGrid"/);
  assert.match(html, /resultOverviewGrid\.before\(prioritySummary\)/);
  assert.match(html, /hidden bg-slate-900 text-white rounded-2xl/);
  assert.doesNotMatch(html, /네이버 알고리즘 가산점에 유리합니다/);
  assert.doesNotMatch(html, /등록 키워드를 설명에 포함하면 SEO에 유리합니다/);
});
test('public rank pages expose observation metadata and exclude non-relevance rows', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  assert.match(source, /eligibleRankKeywordSummaries/);
  assert.match(source, /COUNT\(DISTINCT place_id\) AS places/);
  assert.match(source, /마지막 표본/);
  assert.match(source, /기록 출처/);
  assert.match(source, /WHERE keyword = \? AND rank IS NOT NULL/);
  assert.match(source, /sort_mode = 'popular' OR sort_mode IS NULL/);
  assert.match(source, /is_ad = 0 OR is_ad IS NULL/);
});
test('report guide is anchored below the email form and does not imply a 350-result scan', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /target: '#reportEmailForm'/);
  assert.match(html, /placement: 'below-right'/);
  assert.match(html, /네이버 지도 목록을 확인하고 있습니다/);
  assert.doesNotMatch(html, /현재 예상 확인 구간/);
});
test('rank trend and six benchmark charts are present and client script parses', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="rankTrendChart"/); assert.match(html, /▲ \$\{change\}/); assert.match(html, /▼ \$\{Math\.abs\(change\)\}/);
  assert.match(html, /const rankLabel = `\$\{data\.myRank\}위`/); assert.match(html, /`리뷰 \$\{data\.grade\}등급`/);
  assert.match(html, /const markerData = \[/); assert.match(html, /6위 진입선 \$\{metricValue\(boundaryVal/);
  assert.match(html, /const boundarySummary = has && !compareName/);
  assert.match(html, /h-5 w-0\.5 \$\{marker\.color\}/);
  for (const label of ['영수증(방문자) 리뷰','블로그/카페 리뷰','키워드 투표수','등록 사진 수','방문자 평점','방문자 리뷰 1건당 첨부 미디어']) assert.match(html, new RegExp(label.replace(/[()]/g, '\\$&')));
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1].trim()).filter(Boolean);
  new Function(scripts.at(-1));
});

module.exports={candidateHtml,graphql,fakeDB};
if(require.main===module)(async()=>{for(const [name,fn] of tests){await fn();console.log('PASS '+name);}console.log(`${tests.length} search checks passed.`);})().catch(err=>{console.error(err);process.exitCode=1;});
