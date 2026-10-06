-- Curated commentary for public rank pages. Existing observations remain untouched.
CREATE TABLE IF NOT EXISTS rank_page_comments (
  keyword TEXT PRIMARY KEY,
  comment_text TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '조강사',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
  approved INTEGER NOT NULL DEFAULT 1 CHECK (approved IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
