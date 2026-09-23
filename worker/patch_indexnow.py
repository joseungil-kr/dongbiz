import os

filepath = 'src/index.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add IndexNow Route after sitemap.xml
sitemap_target = """  return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
});"""
sitemap_replacement = sitemap_target + """

// IndexNow Key Route
const INDEXNOW_KEY = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
app.get(`/${INDEXNOW_KEY}.txt`, (c) => c.text(INDEXNOW_KEY));

// IndexNow Ping Route
app.get('/admin/cron/run/indexnow', async (c) => {
  const db = c.env.DB;
  const keywords = db ? await eligibleRankKeywords(db) : [];
  const urlList = [
    'https://dongbiz.com/',
    'https://dongbiz.com/guide',
    'https://dongbiz.com/rank',
    ...GUIDES.map(g => `https://dongbiz.com/guide/${encodeURIComponent(g.slug)}`),
    ...keywords.map(k => `https://dongbiz.com/rank/${encodeURIComponent(k)}`)
  ];

  const payload = {
    host: 'dongbiz.com',
    key: INDEXNOW_KEY,
    keyLocation: `https://dongbiz.com/${INDEXNOW_KEY}.txt`,
    urlList: urlList
  };

  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const body = await res.text();
    return c.json({ success: res.ok, status: res.status, urlCount: urlList.length, response: body });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});"""
content = content.replace(sitemap_target, sitemap_replacement)

# 2. Add to ADMIN_NAV
nav_target = """  ${navItem('/admin/cron/run/place-texts', '텍스트수집', '누르면 즉시 실행 · 키워드별 상위 10곳의 개별 페이지에서 대표키워드·상세설명·메뉴명·투표키워드를 받아온다. 목록수집에는 이 4개가 없다. 최근 30일 안에 받아둔 업체는 건너뛰므로 두 번째부터는 거의 즉시 끝난다. 자동으로는 매일 17:00 KST.')}
</nav>`;"""
nav_replacement = """  ${navItem('/admin/cron/run/place-texts', '텍스트수집', '누르면 즉시 실행 · 키워드별 상위 10곳의 개별 페이지에서 대표키워드·상세설명·메뉴명·투표키워드를 받아온다. 목록수집에는 이 4개가 없다. 최근 30일 안에 받아둔 업체는 건너뛰므로 두 번째부터는 거의 즉시 끝난다. 자동으로는 매일 17:00 KST.')}
  <span class="sep">연동</span>
  ${navItem('/admin/cron/run/indexnow', 'IndexNow 통보', '누르면 즉시 실행 · 사이트맵의 모든 URL을 IndexNow(네이버, 빙 등)에 실시간으로 색인(Indexing) 통보합니다.')}
</nav>`;"""
content = content.replace(nav_target, nav_replacement)

# 3. Add background task in /api/gap
gap_target = """        if (rankObservation?.source !== 'naver-map') await logRankSnapshots(c.env.DB, displayLabel, ranking, myStore, myRank, competitors, 'user', nameVolumes);
      })());
    }
    c.executionCtx.waitUntil(Promise.all(bgTasks));"""
gap_replacement = """        if (rankObservation?.source !== 'naver-map') await logRankSnapshots(c.env.DB, displayLabel, ranking, myStore, myRank, competitors, 'user', nameVolumes);
      })());

      // IndexNow 실시간 자동 통보 (백그라운드)
      bgTasks.push((async () => {
        try {
          const rankUrl = `https://dongbiz.com/rank/${encodeURIComponent(displayLabel)}`;
          await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
              host: 'dongbiz.com',
              key: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
              keyLocation: 'https://dongbiz.com/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.txt',
              urlList: [rankUrl]
            })
          });
        } catch (e) { console.error('IndexNow Auto-Ping Error:', e); }
      })());
    }
    c.executionCtx.waitUntil(Promise.all(bgTasks));"""
content = content.replace(gap_target, gap_replacement)

with open(filepath, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)
print("Done.")
