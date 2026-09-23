const fs = require('fs');
let content = fs.readFileSync('c:/project/대행사 에이젼시 기획/worker/src/index.ts', 'utf8');

const target1 = '<td><a href="/admin/analytics/$'+'{encodeURIComponent(r.keyword)}">순위 추이 보기 →</a></td>';
const replace1 = '<td><a href="/admin/analytics/$'+'{encodeURIComponent(r.keyword)}">순위 추이 보기</a> <button onclick="if(confirm(\''+ '이 키워드의 모든 관측 데이터를 삭제하시겠습니까?' + '\')) fetch(\'/admin/analytics/$'+'{encodeURIComponent(r.keyword)}\', {method:\'DELETE\'}).then(()=>location.reload())" style="margin-left:8px;color:#EF4444;background:none;border:1px solid #EF4444;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;">삭제</button></td>';

content = content.replace(target1, replace1);

const target2_lf = '});\n\n// 관리자: 진단 1건 상세';
const replace2_lf = '});\n\napp.delete(\'/admin/analytics/:keyword\', async (c) => {\n  const keyword = c.req.param(\'keyword\');\n  const db = c.env.DB;\n  if (!db) return c.text(\'DB missing\', 500);\n  await db.prepare(\'DELETE FROM rank_snapshots WHERE keyword = ?\').bind(keyword).run();\n  return c.json({ success: true });\n});\n\n// 관리자: 진단 1건 상세';

const target2 = '});\r\n\r\n// 관리자: 진단 1건 상세';
const replace2 = replace2_lf.replace(/\n/g, '\r\n');

content = content.replace(target2, replace2).replace(target2_lf, replace2_lf);

fs.writeFileSync('c:/project/대행사 에이젼시 기획/worker/src/index.ts', content, 'utf8');
