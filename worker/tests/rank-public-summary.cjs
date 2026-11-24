'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {DatabaseSync} = require('node:sqlite');
const root = path.join(__dirname, '..');
const deps = process.env.DONGBIZ_DEPS || path.join(root, 'node_modules');
const {buildSync} = createRequire(path.join(deps, 'esbuild', 'package.json'))('esbuild');
const source = path.join(root, 'src', 'index.ts');
const migration = fs.readFileSync(path.join(root, 'migrations', '0005_rank_public_summary.sql'), 'utf8');
const fixtures = new DatabaseSync(':memory:');
fixtures.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
for (const file of ['0003_edge_cache.sql','0004_read_budget_indexes.sql']) {
  fixtures.exec(fs.readFileSync(path.join(root,'migrations',file),'utf8'));
}
fixtures.exec('ALTER TABLE rank_snapshots ADD COLUMN sort_mode TEXT; ALTER TABLE rank_snapshots ADD COLUMN is_ad INTEGER; ALTER TABLE rank_snapshots ADD COLUMN total_review_count INTEGER; ALTER TABLE rank_snapshots ADD COLUMN image_count INTEGER; ALTER TABLE rank_snapshots ADD COLUMN save_count_raw TEXT; ALTER TABLE rank_snapshots ADD COLUMN save_count_min INTEGER');
const insert = fixtures.prepare('INSERT INTO rank_snapshots(id,keyword,place_id,place_name,rank,collected_at,sort_mode,source,is_ad) VALUES(?,?,?,?,?,?,?,?,?)');
let id=0;
function write(k,ts,p='1234567',src='cron',sort='popular',ad=0,rank=1) {
  insert.run('id-'+(++id),k,p,'Fixture store',rank,ts,sort,src,ad);
}
const first='2026-11-20 01:00:00', second='2026-11-20 02:00:00', third='2026-11-20 03:00:00';
fixtures.exec('BEGIN');
for(let i=0;i<120000;i++) write('키워드 '+(i%80),i%11===0?first:second,String(1100000+i%90));
for(const [k,t,extra] of [
  ['안산 맛집',first],['안산 맛집',second],['안산맛집',first],['안산맛집',third],
  ['동점 a',first],['동점 a',third],['동점a',first],['동점a',third],
  ['순위시험',first],['미등록 이력',first],['미등록 이력',second],
  ['애널리틱스',first,'analytics'],['애널리틱스',second,'analytics'],
]) write(k,t,'1234567',extra);
fixtures.exec('COMMIT');
function vm(file, text) {
  const output = buildSync({
    stdin:{contents:text,resolveDir:path.dirname(file),loader:'ts',sourcefile:file},
    bundle:true, platform:'node', format:'cjs', write:false, nodePaths:[deps],
  }).outputFiles[0].text;
  const mod = {exports:{}};
  new Function('module','exports','require',output)(mod,mod.exports,require);
  return mod.exports;
}
const baselineText=fs.existsSync(source+'.baseline') ? fs.readFileSync(source+'.baseline','utf8') : require('node:child_process').execFileSync('git',['show','d5b05df6616aeab918d7a437bf5e19742c22fbcf:worker/src/index.ts'],{cwd:root,encoding:'utf8'});
const baseline=vm(source,baselineText).default;
const candidateText=fs.readFileSync(source,'utf8');
const candidate=vm(source,candidateText).default;
const summary=vm(path.join(root,'src','rank-public-summary.ts'),fs.readFileSync(path.join(root,'src','rank-public-summary.ts'),'utf8'));
let stats, failRead=false, failBatch=false, fetches=0; const captured=[];
globalThis.fetch=async (url,init)=> {
  assert.match(String(url), /indexnow/i,'no real network');
  fetches++; captured.push(JSON.parse(init.body));
  return new Response('fixture accepted',{status:200});
};
function dbFor() {
 const db = {prepare(sql) {
    const q=()=>fixtures.prepare(sql);
    let args=[];
    function measure(){
      const fromHistory=/FROM\s+rank_snapshots\b/i.test(sql);
      if(fromHistory) {
        const plan=fixtures.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(r=>r.detail).join('; ');
        const global=!plan.match(/SEARCH.*keyword=\?/i);
        if(global){stats.scans++;stats.plan=plan;stats.estimatedRows+=fixtures.prepare('SELECT COUNT(*) AS n FROM rank_snapshots').get().n;}
        else {stats.scopedQueries++;stats.scopedPlan=plan;stats.estimatedRows+=fixtures.prepare('SELECT COUNT(*) AS n FROM rank_snapshots WHERE keyword=?').get(args[0]).n;}
      } else if(/SELECT value FROM edge_cache WHERE cache_key/i.test(sql) && args[0]==='rank-keywords:v1') {
        stats.cacheProbeRows+=fixtures.prepare('SELECT COUNT(*) AS n FROM edge_cache WHERE cache_key=?').get(args[0]).n;
      } else if(/SELECT keyword,obs,last_at,places FROM rank_public_summary/i.test(sql)) {
        if(failRead)throw Error('fixture read failure');
        stats.summaryReads++;
        stats.estimatedRows+=fixtures.prepare('SELECT COUNT(*) AS n FROM rank_public_summary').get().n;
      }
    }
    return {
      bind(...v){args=v;return this;},
      async all(){measure();return {results:q().all(...args)};},
      async first(){measure();return q().get(...args)??null;},
      async run(){measure();return {success:true,meta:q().run(...args)};},
      _execute(){measure();return q().run(...args);},
    };
 },async batch(seq) {
   fixtures.exec('BEGIN');
   try{
     for(let i=0;i<seq.length;i++){
       if(failBatch && i===1)throw Error('fixture refresh failure after summary delete');
       seq[i]._execute();
     }
     fixtures.exec('COMMIT');return [];
   }catch(err){fixtures.exec('ROLLBACK');throw err;}
 }};
 return db;
}
const db=dbFor();
const env={DB:db,ADMIN_USER:'test',ADMIN_PASS:'test'};
const rank=k=>'/rank/'+encodeURIComponent(k);
const routes=['/rank',rank('안산맛집'),rank('동점a'),'/sitemap.xml','/admin/cron/run/indexnow'];
function reset(){stats={scans:0,scopedQueries:0,summaryReads:0,cacheProbeRows:0,estimatedRows:0};return stats;}
function req(app,url,method='GET',envOverride=env){
 return app.fetch(new Request('https://dongbiz.com'+url,{method,headers:{Authorization:'Basic '+btoa('test:test')}}),envOverride,{waitUntil(){}});
}
(async()=>{
 let before=reset(),old=[],updated=[];
 for(const route of routes){
   fixtures.exec("DELETE FROM edge_cache WHERE cache_key='rank-keywords:v1'");
   const r=await req(baseline,route);old.push([r.status,await r.text()]);
 }
 fixtures.exec(migration);
 let after=reset();
 for(const route of routes){const r=await req(candidate,route);updated.push([r.status,await r.text()]);}
 assert.deepEqual(old,updated);
 assert.equal(fetches,2); assert.deepEqual(captured[0],captured[1]);
 assert.equal(before.scans,5);
 assert.equal(after.scans,0);
 assert.equal(after.summaryReads,5);
 assert.match(old[0][1],/관측 2회 · 업체/);
 assert.match(old[0][1],/미등록 이력/);
 assert.match(old[3][1],/\/cost\//);
 assert.match(old[1][1],/rel="canonical" href="https:\/\/dongbiz\.com\/rank\/%EC%95%88%EC%82%B0%EB%A7%9B%EC%A7%91"/);
 assert.match(old[2][1],/rel="canonical" href="https:\/\/dongbiz\.com\/rank\/%EB%8F%99%EC%A0%90%20a"/);
 let warmBefore=reset();
 const warm1=await req(baseline,'/rank');
 const warm1Text=await warm1.text();
 let warmAfter=reset();
 const warm2=await req(candidate,'/rank');
 assert.equal(await warm2.text(),warm1Text);
 assert.equal(warmBefore.scans,0);
 assert.equal(warmBefore.cacheProbeRows,1);
 assert.equal(warmAfter.scans,0);
 assert.equal(warmAfter.estimatedRows,85);
 let cases=reset();
 write('순위시험',second);
 failBatch=true;
 await summary.refreshRankPublicSummary(db,'순위시험');
 assert.equal((await summary.readRankPublicSummary(db)).find(x=>x.keyword==='순위시험'),undefined);
 assert.equal(fixtures.prepare('SELECT COUNT(*) n FROM rank_public_summary_dirty WHERE keyword=?').get('순위시험').n,1);
 failBatch=false;
 await summary.retryRankPublicSummary(db);
 assert.equal((await summary.readRankPublicSummary(db)).find(x=>x.keyword==='순위시험').obs,2);
 // Popular collection commits before later analytics failure: simulate that boundary
 // on the very same SQLite database; execute the actual summary refresh.
 write('분리저장',first);write('분리저장',second);
 await summary.refreshRankPublicSummary(db,'분리저장');
 assert.equal((await summary.readRankPublicSummary(db)).find(x=>x.keyword==='분리저장').obs,2);
 write('분리저장',third,'1234567','analytics');
 assert.equal(fixtures.prepare('SELECT COUNT(*) n FROM rank_public_summary_dirty WHERE keyword=?').get('분리저장').n,0);
 const warmed=await req(candidate,'/rank'); assert.match(await warmed.text(),/분리저장/);
 failRead=true;
 const stale=await req(candidate,'/rank');
 assert.equal(stale.status,200);assert.match(await stale.text(),/분리저장/);
 const cold=await req(candidate,'/rank','GET',{...env,DB:dbFor()});
 assert.equal(cold.status,500);
 failRead=false;
 // Exercise the actual admin collection handler, substituting only Naver fetches.
 const hookedText=candidateText.replace('getOrganicRanking, getPlaceList,','getOrganicRanking as realGetOrganicRanking, getPlaceList as realGetPlaceList,');
 assert.notEqual(hookedText,candidateText);
 const periodic=vm(source,hookedText+'\n'+
   "const getPlaceList = async () => [{placeId:'1234567',name:'Fixture place',rank:1,visitorReviewCount:5,blogCafeReviewCount:1,totalReviewCount:6,imageCount:1,saveCountRaw:null,saveCountMin:null,isAd:false,hasBooking:false}];\n"+
   "const getOrganicRanking = async () => { throw Error('FIXTURE_DETAIL_FAILED'); };").default;
 write('실제수집시험',first);
 fixtures.prepare("INSERT INTO periodic_keywords(keyword,category) VALUES(?, 'restaurant')").run('실제수집시험');
 const partial=await req(periodic,'/admin/periodic-keywords/run','POST');
 assert.equal(partial.status,303);
 assert.match(partial.headers.get('location'),/FIXTURE_DETAIL_FAILED/);
 assert.equal(fixtures.prepare('SELECT last_error_code FROM periodic_keywords WHERE keyword=?').get('실제수집시험').last_error_code,'FIXTURE_DETAIL_FAILED');
 assert.match(await (await req(periodic,'/rank')).text(),/실제수집시험/);
 const deleted=await req(candidate,'/admin/analytics/'+encodeURIComponent('안산맛집'),'DELETE');
 assert.equal(deleted.status,200);
 const hub=await req(candidate,'/rank');
 const next=await hub.text();assert.ok(next.includes(rank('안산 맛집')));assert.ok(!next.includes(rank('안산맛집')));
 const sitemap=await req(candidate,'/sitemap.xml');
 assert.ok(!(await sitemap.text()).includes(rank('안산맛집')));
 assert.equal(cases.scans,0);
 assert.match(cases.scopedPlan,/SEARCH.*keyword=\?/i);
 console.log(JSON.stringify({fixtureSnapshots:120013,routePairs:routes.length,identicalBodies:old.length,actualNetworkCalls:0,mockedIndexNowCalls:fetches,before,after,warmBefore,warmAfter,writeScenarios:cases},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});