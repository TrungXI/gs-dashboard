CREATE TABLE IF NOT EXISTS gs_matches_history (
  id bigserial PRIMARY KEY,
  match_time timestamptz NOT NULL,
  match_type varchar(4),
  league text,
  home_team text NOT NULL,
  away_team text NOT NULL,
  h1_home integer DEFAULT 0,
  h1_away integer DEFAULT 0,
  tt_home integer DEFAULT 0,
  tt_away integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (match_time, home_team, away_team)
);
CREATE INDEX IF NOT EXISTS idx_gs_matches_history_time ON gs_matches_history (match_time DESC);
