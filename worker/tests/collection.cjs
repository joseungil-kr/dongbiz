const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const id = '1234567';
const detail = 'window.__APOLLO_STATE__ = ' + JSON.stringify({
  ['PlaceDetailBase:' + id]: { name: 'Test Store', visitorReviewsTotal: 12 }, ROOT_QUERY: {}
}) + ';';
const feed = 'window.__APOLLO_STATE__ = ' + JSON.stringify({
  'Feed:test': { type: 'FEED', createdString: '20260911' }
}) + ';';

function load(entry, fetch, timeout = false) {
  const code = esbuild.buildSync({ entryPoints: [path.join(root, entry)], bundle: true,
    write: false, platform: 'browser', format: 'cjs', target: 'es2022' }).outputFiles[0].text;
  const module = { exports: {} };
  const context = { module, exports: module.exports, fetch, URL, URLSearchParams, Headers,
    Request, Response, AbortController, structuredClone, TextEncoder, TextDecoder,
    crypto: require('node:crypto').webcrypto, btoa, atob,
    console: { error() {}, log() {}, warn() {} },
    setTimeout: (fn, ms) => setTimeout(fn, ms === 15000 ? (timeout ? 5 : 10000) : 0),
    clearTimeout, setInterval, clearInterval };
  vm.runInNewContext(code, context);
  return module.exports;
}
function kv() {
  const values = new Map();
  return { values, async get(key, type) {
    const value = values.get(key); return value == null ? null : type === 'json' ? JSON.parse(value) : value;
  }, async put(key, value) { values.set(key, value); } };
}
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('429 classified, no immediate retry, host cooldown', async () => {
  let calls = 0;
  const c = load('src/collection.ts', async () => { calls++; return new Response('blocked', { status: 429 }); });
  await assert.rejects(c.naverHtml('https://m.place.naver.com/a', 'detail'), e => e.code === 'RATE_LIMITED' && e.upstreamStatus === 429);
  await assert.rejects(c.naverHtml('https://m.place.naver.com/b', 'feed'), e => e.code === 'RATE_LIMITED');
  assert.equal(calls, 1);
});
test('403, 500, network and timeout have distinct codes', async () => {
  for (const [status, expected] of [[403, 'BLOCKED'], [500, 'UPSTREAM_HTTP']]) {
    const c = load('src/collection.ts', async () => new Response('', { status }));
    await assert.rejects(c.naverHtml('https://m.place.naver.com/a', 'detail'), e => e.code === expected);
  }
  const c = load('src/collection.ts', async () => { throw new Error('offline'); });
  await assert.rejects(c.naverHtml('https://m.place.naver.com/a', 'detail'), e => e.code === 'NETWORK');
  const t = load('src/collection.ts', async (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), true);
  await assert.rejects(t.naverHtml('https://m.place.naver.com/a', 'detail'), e => e.code === 'TIMEOUT');
});
test('same URL concurrent calls coalesce; ordinary ncaptcha script is allowed', async () => {
  let calls = 0;
  const c = load('src/collection.ts', async () => { calls++; return new Response('<script src="ncaptcha.js"></script>'); });
  const results = await Promise.all([c.naverHtml('https://m.place.naver.com/a', 'detail'), c.naverHtml('https://m.place.naver.com/a', 'detail')]);
  assert.equal(calls, 1); assert.equal(results[0], results[1]);
});
test('ranking 429 and malformed detail are not empty successful data', async () => {
  const s = load('src/scraper.ts', async () => new Response('', { status: 429 }));
  await assert.rejects(s.getOrganicRanking('test'), e => e.code === 'RATE_LIMITED');
  const empty = load('src/scraper.ts', async () => new Response('window.__APOLLO_STATE__ = {};'));
  await assert.rejects(empty.scrapeFullPlaceMetrics(id), e => e.code === 'PARSE_CHANGED');
});
test('Step 1 alias to Step 2 ID reuses full metrics; callers receive independent data', async () => {
  const calls = [];
  const c = load('src/place-cache.ts', async url => {
    calls.push(url);
    return new Response(url.includes('search.naver') ? `https://map.naver.com/p/entry/place/${id}` : url.endsWith('/feed') ? feed : detail);
  });
  const env = { CACHE: kv() };
  const first = await c.cachedPlace(env, 'Test Store', true);
  const second = await c.cachedPlace(env, id, true);
  assert.equal(calls.length, 3); assert.equal(second.recentNewsDate, '2026-09-11');
  first.name = 'Changed'; assert.equal(second.name, 'Test Store');
  await c.cachedPlace(env, id, false); assert.equal(calls.length, 3);
});
test('home-only cache cannot masquerade as feed-complete; concurrent metrics merged', async () => {
  let calls = 0;
  const c = load('src/place-cache.ts', async url => { calls++; return new Response(url.endsWith('/feed') ? feed : detail); });
  const env = { CACHE: kv() };
  await Promise.all([c.cachedPlace(env, id), c.cachedPlace(env, id)]);
  assert.equal(calls, 1);
  const full = await c.cachedPlace(env, id, true);
  assert.equal(full.recentNewsDate, '2026-09-11'); assert.equal(calls, 3);
});
test('failed feed cannot poison the full cache', async () => {
  const c = load('src/place-cache.ts', async url => new Response(url.endsWith('/feed') ? 'changed' : detail));
  const env = { CACHE: kv() };
  await assert.rejects(c.cachedPlace(env, id, true), e => e.code === 'PARSE_CHANGED');
  assert.equal(env.CACHE.values.has(`place:v10:${id}:feed`), false);
});
test('public debug probes are blocked before fetch; place returns structured 503', async () => {
  let calls = 0;
  const app = load('src/index.ts', async () => { calls++; return new Response('', { status: 429 }); }).default;
  const ctx = { waitUntil() {} };
  for (const route of ['test-html', 'test-list', 'test-graphql', 'test-graphql2']) {
    const res = await app.fetch(new Request('https://local.test/api/' + route), {}, ctx);
    assert.equal(res.status, 404);
  }
  assert.equal(calls, 0);
  const res = await app.fetch(new Request('https://local.test/api/place?query=' + id), { CACHE: kv() }, ctx);
  assert.equal(res.status, 503); assert.equal((await res.json()).code, 'RATE_LIMITED');
});
test('legacy cached empty ranking is ignored and failures are not re-cached', async () => {
  const cache = kv();
  await cache.put(`place:v10:${id}:feed`, JSON.stringify({ placeId: id, name: 'Test', seoMetrics: { hasTalktalk: false } }));
  await cache.put('v9:rank:test', '[]');
  let calls = 0;
  const app = load('src/index.ts', async () => { calls++; return new Response('blocked', { status: 429 }); }).default;
  const res = await app.fetch(new Request(`https://local.test/api/gap?placeId=${id}&keyword=test`), { CACHE: cache }, { waitUntil() {} });
  assert.equal(res.status, 503); assert.equal(calls, 1); // rate limit must not trigger a legacy widget retry
  assert.equal((await res.json()).code, 'RATE_LIMITED');
});

test('short links share classified transport and resolve to canonical ID', async () => {
  const s = load('src/scraper.ts', async (_, init) => {
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: `https://map.naver.com/p/entry/place/${id}` } });
  });
  assert.equal(await s.resolvePlaceId('naver.me/fixture'), id);
});
test('normal Step 1 to Step 2 succeeds without fetching own detail twice', async () => {
  const calls = [];
  const otherId = '2345678';
  const ranking = JSON.stringify({ __typename: 'PlaceListBusinesses', items: [
    { __ref: `PlaceListBusinessesItem:${id}` }, { __ref: `PlaceListBusinessesItem:${otherId}` }
  ] });
  const app = load('src/index.ts', async url => {
    calls.push(url);
    if (url.includes('pcmap-api')) return new Response(JSON.stringify([{ data: { restaurants: { businesses: {
      total: 2, siteSort: 'rel.dsc', items: [{ id, name: 'Test Store' }, { id: otherId, name: 'Other Store' }]
    } } } }]));
    if (url.includes('query=keyword')) return new Response(ranking);
    if (url.includes('search.naver')) return new Response(`https://map.naver.com/p/entry/place/${id}`);
    if (url.endsWith('/feed')) return new Response(feed);
    return new Response(url.includes(otherId) ? detail.replaceAll(id, otherId).replace('Test Store', 'Other Store') : detail);
  }).default;
  const env = { CACHE: kv() };
  const background = [];
  const ctx = { waitUntil(p) { background.push(p); } };
  const first = await app.fetch(new Request('https://local.test/api/place?query=' + id), env, ctx);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).myStore.placeId, id);
  const second = await app.fetch(new Request(`https://local.test/api/gap?placeId=${id}&keyword=keyword`), env, ctx);
  assert.equal(second.status, 200);
  const data = await second.json();
  assert.equal(data.myRank, 1); assert.equal(data.top10Competitors.length, 1);
  assert.equal(data.grade, 'A'); assert.equal(data.stats.visitorReviewsTotal.avg, 12);
  assert.equal(data.stats.saveCount.count, 0); // 비공개 저장수는 0으로 평균에 섞지 않는다.
  assert.equal(calls.filter(url => url.endsWith(`/place/${id}/home`)).length, 1);
  await Promise.all(background);
});

module.exports = { load, kv, detail, feed, id };
if (require.main === module) (async () => {
  for (const [name, fn] of tests) { await fn(); console.log('PASS ' + name); }
  console.log(`${tests.length} regression checks passed; no external requests.`);
})().catch(err => { console.error(err); process.exitCode = 1; });
