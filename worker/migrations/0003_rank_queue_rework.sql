-- Split public rank collection into cheap list observations and a later detail pass.
-- Rebuild is required because the original category CHECK did not allow `place`.
CREATE TABLE periodic_keywords_new (
  keyword TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('restaurant', 'hairshop', 'place')),
  market TEXT NOT NULL CHECK (market IN ('legal', 'medical', 'food', 'local_service')),
  collection_mode TEXT NOT NULL DEFAULT 'rank' CHECK (collection_mode IN ('rank', 'analytics')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  interval_hours INTEGER NOT NULL DEFAULT 48 CHECK (interval_hours BETWEEN 24 AND 72),
  last_attempt_at DATETIME,
  last_success_at DATETIME,
  last_error_code TEXT,
  next_run_at DATETIME,
  detail_due_at DATETIME,
  detail_completed_at DATETIME,
  empty_result_count INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO periodic_keywords_new (keyword, category, market, collection_mode, active, interval_hours, last_attempt_at, last_success_at, last_error_code, next_run_at, created_at, updated_at)
SELECT keyword, category, CASE WHEN category = 'restaurant' THEN 'food' ELSE 'local_service' END, collection_mode, active,
       CASE WHEN interval_hours > 72 THEN 72 ELSE interval_hours END, last_attempt_at, last_success_at, last_error_code, next_run_at, created_at, updated_at
FROM periodic_keywords;
DROP TABLE periodic_keywords;
ALTER TABLE periodic_keywords_new RENAME TO periodic_keywords;

-- Seeds are deliberately INSERT OR IGNORE: an existing inactive keyword remains inactive.
INSERT OR IGNORE INTO periodic_keywords (keyword, category, market, interval_hours) VALUES
  ('강남 변호사','place','legal',48),('서초 변호사','place','legal',48),('송파 변호사','place','legal',48),('수원 변호사','place','legal',48),('안산 변호사','place','legal',48),('인천 변호사','place','legal',48),('부천 변호사','place','legal',48),('성남 변호사','place','legal',48),('용인 변호사','place','legal',48),('고양 변호사','place','legal',48),('평택 변호사','place','legal',48),('화성 변호사','place','legal',48),('의정부 변호사','place','legal',48),('남양주 변호사','place','legal',48),('광명 변호사','place','legal',48),('시흥 변호사','place','legal',48),('안양 변호사','place','legal',48),('파주 변호사','place','legal',48),('김포 변호사','place','legal',48),('하남 변호사','place','legal',48),
  ('강남 치과','place','medical',48),('서초 치과','place','medical',48),('송파 치과','place','medical',48),('수원 치과','place','medical',48),('안산 치과','place','medical',48),('인천 치과','place','medical',48),('부천 치과','place','medical',48),('성남 치과','place','medical',48),('용인 치과','place','medical',48),('고양 치과','place','medical',48),('평택 치과','place','medical',48),('화성 치과','place','medical',48),('의정부 치과','place','medical',48),('남양주 치과','place','medical',48),('광명 치과','place','medical',48),('시흥 치과','place','medical',48),('안양 치과','place','medical',48),('파주 치과','place','medical',48),('김포 치과','place','medical',48),('하남 치과','place','medical',48),
  ('강남 맛집','restaurant','food',48),('서초 맛집','restaurant','food',48),('송파 맛집','restaurant','food',48),('수원 맛집','restaurant','food',48),('안산 맛집','restaurant','food',48),('인천 맛집','restaurant','food',48),('성남 맛집','restaurant','food',48),('용인 맛집','restaurant','food',48),
  ('강남 누수탐지','place','local_service',48),('서초 누수탐지','place','local_service',48),('송파 누수탐지','place','local_service',48),('수원 누수탐지','place','local_service',48),('안산 누수탐지','place','local_service',48),('인천 누수탐지','place','local_service',48),('성남 누수탐지','place','local_service',48),('용인 누수탐지','place','local_service',48),('강남 청소','place','local_service',48),('수원 청소','place','local_service',48),('안산 도어락','place','local_service',48),('인천 인테리어','place','local_service',48);
