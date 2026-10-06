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
  ('강남역 이혼전문 변호사','place','legal',48),('서초동 이혼전문 변호사','place','legal',48),('교대역 이혼전문 변호사','place','legal',48),('수원 이혼전문 변호사','place','legal',48),('봉명동 이혼전문 변호사','place','legal',48),('부천 이혼전문 변호사','place','legal',48),('일산 이혼전문 변호사','place','legal',48),('분당 이혼전문 변호사','place','legal',48),('서초 형사 변호사','place','legal',48),('수원 형사 변호사','place','legal',48),('인천 형사 변호사','place','legal',48),('부천 형사 변호사','place','legal',48),('인천 개인회생 변호사','place','legal',48),('수원 개인회생 변호사','place','legal',48),('부천 개인회생 변호사','place','legal',48),('안산 개인회생 변호사','place','legal',48),('안산 음주운전 변호사','place','legal',48),('수원 음주운전 변호사','place','legal',48),('강남역 상속 변호사','place','legal',48),('서초동 부동산 변호사','place','legal',48),
  ('종로 다이어트 한의원','place','medical',48),('강남역 쌍꺼풀 성형외과','place','medical',48),('강남역 코성형 성형외과','place','medical',48),('압구정 리프팅 피부과','place','medical',48),('강남역 피부과','place','medical',48),('신사역 피부과','place','medical',48),('수원 임플란트 치과','place','medical',48),('안산 임플란트 치과','place','medical',48),('부천 임플란트 치과','place','medical',48),('분당 임플란트 치과','place','medical',48),('분당 교정 치과','place','medical',48),('수원 교정 치과','place','medical',48),('수원 교통사고 한의원','place','medical',48),('안산 교통사고 한의원','place','medical',48),('안산 다이어트 한의원','place','medical',48),('수원 다이어트 한의원','place','medical',48),('분당 정형외과','place','medical',48),('수원 정형외과','place','medical',48),('강남역 안과','place','medical',48),('수원 산부인과','place','medical',48),
  ('봉명동 삼겹살','restaurant','food',48),('봉명동 칼국수','restaurant','food',48),('안산 보리밥','restaurant','food',48),('수원 보리밥','restaurant','food',48),('강남역 회식 맛집','restaurant','food',48),('수원역 회식 맛집','restaurant','food',48),('분당 한식 맛집','restaurant','food',48),('안산 가족모임 식당','restaurant','food',48),
  ('봉명동 미용실','hairshop','local_service',48),('강남역 미용실','hairshop','local_service',48),('안산 누수탐지','place','local_service',48),('수원 누수탐지','place','local_service',48),('부천 누수탐지','place','local_service',48),('수원 입주청소','place','local_service',48),('안산 입주청소','place','local_service',48),('동탄 입주청소','place','local_service',48),('동탄 스카이차','place','local_service',48),('안산 스카이차','place','local_service',48),('수원 도어락','place','local_service',48),('안산 에어컨청소','place','local_service',48);
