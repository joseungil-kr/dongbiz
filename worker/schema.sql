-- Cloudflare D1 Database Schema for DongBiz
-- 적용: npx wrangler d1 execute dongbiz-db --file=./schema.sql

-- 1. 유저 테이블 (SaaS 구독 관리)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,             -- UUID
    phone_number TEXT UNIQUE,        -- 전화번호 (로그인/식별자)
    tier TEXT DEFAULT 'FREE',        -- FREE, PRO, AGENCY 등
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 플레이스 테이블 (네이버 스마트플레이스 기본 정보)
CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,             -- 네이버 플레이스 ID (예: 2058645213)
    name TEXT NOT NULL,              -- 상호명
    category TEXT,                   -- 업종
    road_address TEXT,               -- 도로명 주소
    talktalk_active BOOLEAN,         -- 톡톡 활성화 여부
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 검색 히스토리 및 진단 기록 (고유 공유 링크용)
CREATE TABLE IF NOT EXISTS search_histories (
    share_id TEXT PRIMARY KEY,       -- 고유 링크용 ID
    user_id TEXT,                    -- 검색한 유저 (익명일 경우 NULL 허용)
    place_id TEXT NOT NULL,          -- 대상 플레이스
    target_keyword TEXT NOT NULL,    -- 진단 키워드 (사용자 직접 입력)
    my_rank INTEGER,                 -- 당시 내 순위 (1~14, 14위 밖이면 NULL)
    top10_avg_reviews INTEGER,       -- 상위 10개 업체(본인 제외) 방문자 리뷰 평균
    top10_median_reviews INTEGER,    -- 상위 10개 업체(본인 제외) 방문자 리뷰 중앙값 (§7.6 평균 왜곡 방어)
    rank_boundary_reviews INTEGER,   -- 10위 업체(1페이지 진입선) 방문자 리뷰 수
    my_reviews INTEGER,              -- 내 리뷰 수
    grade_reviews TEXT,              -- A, B, C 등급
    raw_data JSON,                   -- 스크래핑 당시 전체 JSON 스냅샷 (프론트엔드 복원용)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(place_id) REFERENCES places(id)
);

-- 4. 순위 스냅샷 (리버스 엔지니어링용 시계열 원자료).
-- 사용자가 /api/gap을 호출할 때마다 그 시점의 키워드-업체-순위-전지표 조합을 한 행씩 남긴다.
-- Phase D의 daily_ranks 스텁(순위+리뷰수만)을 대체 — 처음부터 전지표를 평탄화해서 쌓아야
-- "순위가 바뀔 때 어떤 지표가 움직였는가"를 나중에 SQL 한 줄로 물어볼 수 있다.
-- place_id에 FK를 걸지 않는다 — 경쟁사는 places 테이블에 upsert하지 않으므로(§B9 교훈:
-- FK 제약은 두 진입점이 서로 다른 upsert 타이밍을 가질 때 조용히 깨진다) 여기서는 단순 TEXT로 둔다.
CREATE TABLE IF NOT EXISTS rank_snapshots (
    id TEXT PRIMARY KEY,                    -- UUID
    keyword TEXT NOT NULL,
    place_id TEXT NOT NULL,
    place_name TEXT,
    rank INTEGER,                           -- 1~14, 순위 밖이면 NULL
    visitor_reviews INTEGER,
    blog_reviews INTEGER,
    vote_count INTEGER,
    photo_count INTEGER,
    review_score REAL,
    review_medias_total INTEGER,            -- 사진 첨부 리뷰 수
    coupon_count INTEGER,
    has_booking BOOLEAN,
    has_smart_order BOOLEAN,
    has_review_penalty BOOLEAN,
    is_new_opening BOOLEAN,
    is_good_store BOOLEAN,
    is_open_now BOOLEAN,
    is_biz_hour_missing BOOLEAN,
    description_length INTEGER,
    name_contains_keyword BOOLEAN,
    category_matches_keyword BOOLEAN,
    distance_from_me_km REAL,               -- 스냅샷을 유발한 내 매장 기준 거리(참고용)
    source TEXT DEFAULT 'user',             -- 'user'(사용자 진단) | 'cron'(자동 재수집)
    collected_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. 리서치용 고정 키워드 시장 통계 (특정 업체 식별 없이 순위 통계만).
-- 강남맛집류 8개 고정 키워드를 매일 자동 수집하되, 개별 업체 지표는 저장하지 않고
-- 그 시점 상위 10곳의 평균/중앙값/비율만 한 행으로 남긴다. rank_snapshots(업체별 세부)보다
-- 훨씬 가볍고, "이 시장이 전반적으로 얼마나 경쟁적인가"를 보는 용도.
-- category='medical'(성형외과 등)은 의료광고법상 랭킹 로직이 다를 수 있어 일반 분석에서 분리한다.
CREATE TABLE IF NOT EXISTS keyword_rank_stats (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general', -- 'general' | 'medical'
    organic_count INTEGER,           -- 실제 발견된 오가닉 업체 수
    avg_visitor_reviews REAL, median_visitor_reviews REAL,
    avg_blog_reviews REAL, median_blog_reviews REAL,
    avg_vote_count REAL, median_vote_count REAL,
    avg_photo_count REAL, median_photo_count REAL,
    avg_review_score REAL, median_review_score REAL,
    avg_review_medias_total REAL,
    avg_coupon_count REAL,
    booking_rate REAL,               -- 예약연동 업체 비율 (0~1)
    smart_order_rate REAL,
    review_penalty_rate REAL,
    new_opening_rate REAL,
    collected_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_search_histories_place ON search_histories(place_id);
CREATE INDEX IF NOT EXISTS idx_rank_snapshots_keyword_place ON rank_snapshots(keyword, place_id);
CREATE INDEX IF NOT EXISTS idx_rank_snapshots_collected ON rank_snapshots(collected_at);
CREATE INDEX IF NOT EXISTS idx_keyword_rank_stats_keyword ON keyword_rank_stats(keyword);
CREATE INDEX IF NOT EXISTS idx_keyword_rank_stats_collected ON keyword_rank_stats(collected_at);
