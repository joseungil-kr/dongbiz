const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'index.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add IndexNow Route after sitemap.xml
const target1 = "  });\n});";
const replacement1 = `  });\n});\n\n// IndexNow Key Route\nconst INDEXNOW_KEY = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';\napp.get(\`/\${INDEXNOW_KEY}.txt\`, (c) => c.text(INDEXNOW_KEY));\n\n// IndexNow Ping Route\napp.get('/admin/cron/run/indexnow', async (c) => {\n  const db = c.env.DB;\n  const keywords = db ? await eligibleRankKeywords(db) : [];\n  const urlList = [\n    'https://dongbiz.com/',\n    'https://dongbiz.com/guide',\n    'https://dongbiz.com/rank',\n    ...GUIDES.map(g => \`https://dongbiz.com/guide/\${encodeURIComponent(g.slug)}\`),\n    ...keywords.map(k => \`https://dongbiz.com/rank/\${encodeURIComponent(k)}\`)\n  ];\n\n  const payload = {\n    host: 'dongbiz.com',\n    key: INDEXNOW_KEY,\n    keyLocation: \`https://dongbiz.com/\${INDEXNOW_KEY}.txt\`,\n    urlList: urlList\n  };\n\n  try {\n    const res = await fetch('https://api.indexnow.org/indexnow', {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json; charset=utf-8' },\n      body: JSON.stringify(payload)\n    });\n    const body = await res.text();\n    return c.json({ success: res.ok, status: res.status, urlCount: urlList.length, response: body });\n  } catch (e: any) {\n    return c.json({ error: e.message }, 500);\n  }\n});`;

content = content.replace(target1, replacement1);

// 2. Add to ADMIN_NAV
const target2 = `  \${navItem('/admin/cron/run/place-texts', '텍스트수집', '누르면 즉시 실행 · 키워드별 상위 10곳의 개별 페이지에서 대표키워드·상세설명·메뉴명·투표키워드를 받아온다. 목록수집에는 이 4개가 없다. 최근 30일 안에 받아둔 업체는 건너뛰므로 두 번째부터는 거의 즉시 끝난다. 자동으로는 매일 17:00 KST.')}\n</nav>\`;`;
const replacement2 = `  \${navItem('/admin/cron/run/place-texts', '텍스트수집', '누르면 즉시 실행 · 키워드별 상위 10곳의 개별 페이지에서 대표키워드·상세설명·메뉴명·투표키워드를 받아온다. 목록수집에는 이 4개가 없다. 최근 30일 안에 받아둔 업체는 건너뛰므로 두 번째부터는 거의 즉시 끝난다. 자동으로는 매일 17:00 KST.')}\n  <span class="sep">연동</span>\n  \${navItem('/admin/cron/run/indexnow', 'IndexNow 통보', '누르면 즉시 실행 · 사이트맵의 모든 URL을 IndexNow(네이버, 빙 등)에 실시간으로 색인(Indexing) 통보합니다.')}\n</nav>\`;`;

content = content.replace(target2, replacement2);

// 3. Add background task in /api/gap
const target3 = `        if (rankObservation?.source !== 'naver-map') await logRankSnapshots(c.env.DB, displayLabel, ranking, myStore, myRank, competitors, 'user', nameVolumes);\n      })());\n    }\n    c.executionCtx.waitUntil(Promise.all(bgTasks));`;
const replacement3 = `        if (rankObservation?.source !== 'naver-map') await logRankSnapshots(c.env.DB, displayLabel, ranking, myStore, myRank, competitors, 'user', nameVolumes);\n      })());\n\n      // IndexNow 실시간 자동 통보 (백그라운드)\n      bgTasks.push((async () => {\n        try {\n          const rankUrl = \`https://dongbiz.com/rank/\${encodeURIComponent(displayLabel)}\`;\n          await fetch('https://api.indexnow.org/indexnow', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json; charset=utf-8' },\n            body: JSON.stringify({\n              host: 'dongbiz.com',\n              key: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',\n              keyLocation: 'https://dongbiz.com/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.txt',\n              urlList: [rankUrl]\n            })\n          });\n        } catch (e) { console.error('IndexNow Auto-Ping Error:', e); }\n      })());\n    }\n    c.executionCtx.waitUntil(Promise.all(bgTasks));`;

content = content.replace(target3, replacement3);

// Replace CRLF to handle Windows newline variations if they exist, but target1,2,3 uses '\n' so it might fail if the file is CRLF.
// Let's normalize content to LF first, then do replacements, then save.
let normalizedContent = fs.readFileSync(filePath, 'utf8').replace(/\\r\\n/g, '\\n');
normalizedContent = normalizedContent.replace(target1, replacement1);
normalizedContent = normalizedContent.replace(target2, replacement2);
normalizedContent = normalizedContent.replace(target3, replacement3);

fs.writeFileSync(filePath, normalizedContent, 'utf8');
console.log('Patch complete.');
