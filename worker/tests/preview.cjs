// Offline browser fixture. No production bindings, credentials or Naver requests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { load, kv, detail, feed, id } = require('./collection.cjs');
const { candidateHtml, graphql, fakeDB } = require('./search.cjs');
const env = { CACHE: kv(), DB: fakeDB() };
const app = load('src/index.ts', async (url, init) => {
  if (url.includes('search.naver')) return new Response(candidateHtml());
  if (url.includes('pcmap-api')) {
    const start = JSON.parse(init.body)[0].variables.input.start;
    return graphql(Array.from({length:50},(_,i)=>({id:start+i===137?id:String(8000000+start+i),name:'비교업체 '+(start+i)})),500);
  }
  if (url.endsWith('/feed')) return new Response(feed);
  const match = url.match(/place\/(\d+)\/home/);
  if (!match) throw new Error('Unexpected fixture URL');
  return new Response(detail.replaceAll(id,match[1]).replace('Test Store','같은상호 안산점'));
}).default;
const publicRoot = path.resolve(__dirname,'../public');
http.createServer(async(req,res)=>{
  try {
    if(req.url.startsWith('/api/')) {
      const result=await app.fetch(new Request('http://127.0.0.1:8789'+req.url),env,{waitUntil(p){p.catch(console.error);}});
      res.writeHead(result.status, Object.fromEntries(result.headers));res.end(await result.text());return;
    }
    const pathname = new URL(req.url,'http://local').pathname;
    const file=path.resolve(publicRoot,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.jpg')?'image/jpeg':'application/octet-stream');
    res.end(fs.readFileSync(file));
  }catch(e){res.writeHead(500);res.end(e.message);}
}).listen(8789,'127.0.0.1',()=>console.log('Offline preview at http://127.0.0.1:8789'));
