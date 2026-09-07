-- Cloudflare D1 Database Schema for DongBiz

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
    share_id TEXT PRIMARY KEY,       -- 고유 링크용 ID (예: 짧은 UUID 또는 나노 ID)
    user_id TEXT,                    -- 검색한 유저 (익명일 경우 NULL 허용)
    place_id TEXT NOT NULL,          -- 대상 플레이스
    target_keyword TEXT NOT NULL,    -- 진단 키워드 (예: '안산 스카이차')
    my_rank INTEGER,                 -- 당시 내 순위
    top10_avg_reviews INTEGER,       -- 상위 10개 업체 평균 리뷰
    my_reviews INTEGER,              -- 내 리뷰 수
    grade_reviews TEXT,              -- A, B, C 등급
    raw_data JSON,                   -- 스크래핑 당시 전체 JSON 스냅샷 (프론트엔드 복원용)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(place_id) REFERENCES places(id)
);

-- 4. 데일리 랭킹 트래킹 (SaaS 유료 회원을 위한 매일 자동 수집)
CREATE TABLE IF NOT EXISTS daily_ranks (
    id TEXT PRIMARY KEY,             -- UUID
    place_id TEXT NOT NULL,
    target_keyword TEXT NOT NULL,
    rank INTEGER,                    -- 유기적 순위 (1~14 등)
    total_reviews INTEGER,           -- 리뷰 수 변동 추적용
    tracked_date DATE DEFAULT CURRENT_DATE, -- 측정 일자
    FOREIGN KEY(place_id) REFERENCES places(id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_search_histories_place ON search_histories(place_id);
CREATE INDEX IF NOT EXISTS idx_daily_ranks_place_keyword ON daily_ranks(place_id, target_keyword);
CREATE INDEX IF NOT EXISTS idx_daily_ranks_date ON daily_ranks(tracked_date);
