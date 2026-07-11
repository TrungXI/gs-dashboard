-- GS match data stored per date (date_key = 'matches20260627' format)
CREATE TABLE IF NOT EXISTS gs_matches_cache (
  date_key TEXT PRIMARY KEY,
  matches JSONB NOT NULL DEFAULT '[]',
  match_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Volta matches stored individually for accumulation
CREATE TABLE IF NOT EXISTS volta_matches_cache (
  match_id BIGINT PRIMARY KEY,
  match_data JSONB NOT NULL,
  match_date TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Allow anon reads (no writes from client)
ALTER TABLE gs_matches_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE volta_matches_cache ENABLE ROW LEVEL SECURITY;

-- Postgres has no "CREATE POLICY IF NOT EXISTS"; drop-then-create keeps this idempotent.
DROP POLICY IF EXISTS anon_read_gs ON gs_matches_cache;
DROP POLICY IF EXISTS anon_read_volta ON volta_matches_cache;

CREATE POLICY anon_read_gs ON gs_matches_cache FOR SELECT USING (true);
CREATE POLICY anon_read_volta ON volta_matches_cache FOR SELECT USING (true);
