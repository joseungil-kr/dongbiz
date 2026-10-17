-- Baseline note: 0001 and the historical manually-applied schema already include
-- collection_mode.  Keep this migration as a recorded no-op so a production DB
-- with an empty d1_migrations table can be adopted without a duplicate-column
-- failure before 0003 performs the schema rebuild.
SELECT 1;
