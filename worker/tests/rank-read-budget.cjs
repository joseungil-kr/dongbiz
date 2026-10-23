const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { load } = require('./collection.cjs');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE periodic_keywords(keyword TEXT PRIMARY KEY, collection_mode TEXT, active INTEGER);
  CREATE TABLE rank_snapshots(keyword TEXT, place_id TEXT, place_name TEXT, rank INTEGER,
    visitor_reviews INTEGER, blog_reviews INTEGER, vote_count INTEGER, photo_count INTEGER,
    source TEXT, collected_at TEXT, sort_mode TEXT, is_ad INTEGER);
  CREATE INDEX idx_rank_snapshots_keyword_place ON rank_snapshots(keyword, place_id);
  CREATE TABLE rank_page_comments(keyword TEXT PRIMARY KEY, comment_text TEXT, author TEXT,
    source TEXT, approved INTEGER, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
let queries = [], payload, holdNext;
const db = { prepare(sql) {
  queries.push(sql);
  assert.doesNotMatch(sql, /COUNT\(DISTINCT|GROUP BY keyword/, 'global history aggregation must not run');
  const statement = sqlite.prepare(sql);
  let args = [];
  return {
    bind(...values) { args = values; return this; },
    async all() {
      const results = statement.all(...args), hold = holdNext;
      holdNext = undefined;
      if (hold) await hold;
      return { results };
    },
    async first() { return statement.get(...args) || null; },
    async run() { statement.run(...args); return { success: true }; },
  };
} };
const env = { DB: db, ADMIN_USER: 'test', ADMIN_PASS: 'test', CACHE: {
  get() { throw Error('KV unavailable'); }, put() { throw Error('KV unavailable'); }, delete() { throw Error('KV unavailable'); },
} };
const app = load('src/index.ts', async (_, init) => {
  payload = JSON.parse(init.body); return new Response('ok');
}).default;
const request = (path, body, auth = true) => app.fetch(new Request('https://local' + path, {
  method: body ? 'POST' : 'GET',
  headers: auth ? { Authorization: 'Basic ' + btoa('test:test') } : {},
  ...(body ? { body: new URLSearchParams(body) } : {}),
}), env, { waitUntil() {} });
const register = (keyword, mode = 'rank', active = 1) => sqlite.prepare('INSERT INTO periodic_keywords VALUES (?, ?, ?)').run(keyword, mode, active);
const observe = (keyword, { source = 'cron', sort = 'popular', ad = 0, at = '2026-10-20 00:00:00', rank = 1 } = {}) =>
  sqlite.prepare('INSERT INTO rank_snapshots VALUES (?, ?, ?, ?, 12, 3, 1, 2, ?, ?, ?, ?)').run(keyword, '1234567', 'Store', rank, source, at, sort, ad);
const comment = (keyword, text, approved = 1) => sqlite.prepare('INSERT OR REPLACE INTO rank_page_comments(keyword,comment_text,approved) VALUES (?,?,?)').run(keyword, text, approved);
const rankPath = keyword => '/rank/' + encodeURIComponent(keyword);

(async () => {
  let response = await request('/rank');
  assert.equal(response.status, 200, 'rank directory must work without history aggregation');
  assert.match(await response.text(), /등록 키워드/);
  register('안산 맛집'); observe('안산 맛집'); observe('안산 맛집');
  register('안산맛집'); observe('안산맛집');
  register('inactive', 'rank', 0); observe('inactive', { source: null, sort: null, ad: null });
  for (const [keyword, options] of [
    ['advert', { ad: 1 }], ['analytics-row', { source: 'analytics' }], ['saved-sort', { sort: 'saved' }],
    ['null-date', { at: null }], ['no-rank', { rank: null }], ['__watch__', {}],
  ]) { register(keyword); observe(keyword, options); }
  register('analytics-registry', 'analytics'); observe('analytics-registry');
  register('pending'); observe('legacy');
  for (const keyword of ['__watch__', 'null-date', 'advert', 'analytics-row', 'saved-sort', 'no-rank', 'pending']) {
    assert.equal((await request(rankPath(keyword))).status, 404, keyword);
  }
  queries = [];
  response = await request('/rank');
  const hub = await response.text();
  assert.equal(response.status, 200);
  for (const keyword of ['안산 맛집', '안산맛집', 'inactive']) assert.ok(hub.includes(rankPath(keyword)));
  for (const keyword of ['advert', 'analytics-row', 'saved-sort', 'null-date', 'no-rank', '__watch__', 'analytics-registry', 'pending', 'legacy']) assert.ok(!hub.includes(rankPath(keyword)), keyword);
  assert.doesNotMatch(hub, /관측 \d+회 · 업체/);
  const directorySql = queries.find(sql => sql.includes('FROM periodic_keywords'));
  assert.ok(directorySql);
  const plan = sqlite.prepare('EXPLAIN QUERY PLAN ' + directorySql).all().map(row => row.detail).join('\n');
  assert.match(plan, /SEARCH.*idx_rank_snapshots_keyword_place/);
  assert.doesNotMatch(plan, /SCAN (?:rs|rank_snapshots)/);
  console.log('PASS SQLite directory filters, duplicate/NULL/empty data, indexed EXISTS plan:\n' + plan);
  const sitemap = await (await request('/sitemap.xml')).text();
  assert.ok(sitemap.includes('https://dongbiz.com' + rankPath('안산 맛집')));
  assert.ok(!sitemap.includes('/rank/legacy'));
  assert.equal((await request('/admin/cron/run/indexnow')).status, 200);
  assert.ok(payload.urlList.includes('https://dongbiz.com' + rankPath('안산 맛집')));

  comment('안산맛집', '<script>shared</script>');
  response = await request(rankPath('안산 맛집') + '?utm_source=test');
  let html = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /noindex/);
  assert.ok(html.includes('<link rel="canonical" href="https://dongbiz.com' + rankPath('안산 맛집') + '">'));
  assert.match(html, /&lt;script&gt;shared&lt;\/script&gt;/);
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  html = await (await request('/admin' + rankPath('안산 맛집'))).text();
  assert.ok(html.includes('action="/admin' + rankPath('안산맛집') + '"'));
  assert.match(html, /수정하면 해당 코멘트에 반영됩니다/);
  assert.match(html, /noindex,nofollow/);
  assert.equal((await request('/admin' + rankPath('안산맛집'), { comment_text: 'updated', approved: '1' })).status, 303);
  assert.equal(sqlite.prepare('SELECT comment_text FROM rank_page_comments WHERE keyword=?').get('안산맛집').comment_text, 'updated');
  comment('안산 맛집', 'exact private', 0);
  html = await (await request(rankPath('안산 맛집'))).text();
  assert.doesNotMatch(html, /exact private|updated/);
  assert.match(await (await request(rankPath('안산맛집'))).text(), /updated/);
  observe('안 산 맛집');
  html = await (await request(rankPath('안 산 맛집'))).text();
  assert.doesNotMatch(html, /exact private|updated/); // ambiguous aliases must not be reassigned
  assert.equal((await request('/admin' + rankPath('legacy'), { comment_text: 'legacy note', approved: '1' })).status, 303);
  html = await (await request('/admin/rank-comments')).text();
  assert.match(html, /legacy/);
  assert.equal((await request('/admin' + rankPath('pending'), { comment_text: 'invalid' })).status, 400);
  assert.equal((await request('/admin' + rankPath('안산맛집'), { comment_text: 'denied' }, false)).status, 401);
  assert.equal((await request('/admin/rank-comments/' + encodeURIComponent('안산맛집') + '/toggle', { action: 'toggle' })).status, 303);
  assert.doesNotMatch(await (await request(rankPath('안산맛집'))).text(), /updated/);
  console.log('PASS public self canonical, unique legacy alias comment, exact/private/ambiguous keys, admin save/toggle/auth and unregistered history');

  const start = queries.length;
  const responses = await Promise.all(Array.from({ length: 12 }, () => request('/rank')));
  assert.ok(responses.every(r => r.status === 200));
  assert.equal(queries.length - start, 12);
  let release;
  holdNext = new Promise(resolve => { release = resolve; });
  const oldRequest = request('/rank');
  await Promise.resolve();
  register('new-data'); observe('new-data');
  assert.match(await (await request('/rank')).text(), /new-data/);
  release();
  assert.doesNotMatch(await (await oldRequest).text(), /new-data/);
  assert.match(await (await request('/rank')).text(), /new-data/);
  sqlite.exec('DROP TABLE rank_page_comments');
  assert.equal((await request(rankPath('안산맛집'))).status, 200);
  console.log('PASS failed KV, 12 concurrent directories, late previous read cannot recache, missing comment-table compatibility');
  sqlite.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
