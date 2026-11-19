-- D1 읽기 예산(하루 500만 rows read) 방어용 인덱스 (2026-11-19)
--
-- 배경: /rank·/rank/:keyword·/sitemap.xml 이 rank_snapshots 전체(약 12만 행)를 훑는
-- 집계 쿼리를 요청마다 실행해, 페이지뷰 40여 회로 하루 한도를 태웠다.
-- 집계 쿼리 자체는 코드에서 10분 캐시(cache.ts의 edge_cache)로 막았고, 여기서는
-- 남은 쿼리들이 인덱스를 타도록 한다.
--
-- 적용: wrangler d1 execute dongbiz-db --remote --file=./migrations/0004_read_budget_indexes.sql
-- (여러 번 실행해도 안전)

-- 1) /rank/:keyword — 키워드별 스냅샷을 collected_at 순으로 읽는다.
--    기존 (keyword, place_id) 인덱스는 정렬을 못 받쳐 TEMP B-TREE가 붙었다.
CREATE INDEX IF NOT EXISTS idx_rank_snapshots_kw_collected
  ON rank_snapshots(keyword, collected_at);

-- 2) /admin 진단 리스트 — created_at DESC 정렬에 인덱스가 없어 search_histories 전체를
--    스캔하고 정렬했다(raw_data JSON 포함). 최신 100건만 읽도록 바꾼다.
CREATE INDEX IF NOT EXISTS idx_search_histories_created
  ON search_histories(created_at);

-- 3) 텍스트 수집 크론의 "최근 30일 내 받아둔 업체" 조회.
CREATE INDEX IF NOT EXISTS idx_place_texts_updated
  ON place_texts(updated_at);

-- 4) 스키마 드리프트 기록: 코드는 아래 컬럼을 쓰지만 schema.sql/기존 마이그레이션에는 없다.
--    (실 DB에는 이미 존재. 새 DB를 schema.sql로 만들 때를 대비한 기록)
--      rank_snapshots.sort_mode TEXT
--      rank_snapshots.is_ad INTEGER
--      rank_snapshots.total_review_count INTEGER
--      rank_snapshots.image_count INTEGER
--      rank_snapshots.save_count_raw INTEGER
--      rank_snapshots.save_count_min INTEGER
