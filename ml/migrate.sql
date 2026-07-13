-- Live odds snapshots — captured every 2min by collector during in-progress matches
-- Used to build feature-rich training data (Model B) after 1000+ rows accumulate
CREATE TABLE IF NOT EXISTS gs_match_odds_log (
  id SERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  event_id BIGINT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  match_type TEXT,
  h1_home INT, h1_away INT,
  score_home INT, score_away INT,
  is_h2 BOOL,
  minute_elapsed INT,
  hc_line REAL,
  hc_home_odds REAL,
  hc_away_odds REAL,
  ou_line REAL,
  ou_over_odds REAL,
  ou_under_odds REAL,
  yellow_home INT DEFAULT 0,
  yellow_away INT DEFAULT 0,
  red_home INT DEFAULT 0,
  red_away INT DEFAULT 0,
  corners_home INT DEFAULT 0,
  corners_away INT DEFAULT 0,
  tt_home INT,
  tt_away INT,
  outcome_filled BOOL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_gs_match_odds_log_teams
  ON gs_match_odds_log(home_team, away_team, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_gs_match_odds_log_outcome
  ON gs_match_odds_log(outcome_filled) WHERE NOT outcome_filled;

-- ML prediction log — one row per prediction served to the UI
CREATE TABLE IF NOT EXISTS gs_ml_predictions (
  id SERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  match_type TEXT,
  h1_home INT,
  h1_away INT,
  is_h2 BOOL,
  minute_elapsed INT,
  home_form_pts INT,
  away_form_pts INT,
  h2h_home_win_rate REAL,
  hc_line REAL,
  hc_home_odds REAL,
  ou_line REAL,
  red_home INT DEFAULT 0,
  red_away INT DEFAULT 0,
  predicted_home_pct INT,
  predicted_away_pct INT,
  model_version INT,
  -- filled after match ends by a background job
  actual_winner TEXT,   -- 'home' | 'away' | 'draw'
  tt_home INT,
  tt_away INT,
  outcome_recorded BOOL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_gs_ml_predictions_teams
  ON gs_ml_predictions(home_team, away_team);

CREATE INDEX IF NOT EXISTS idx_gs_ml_predictions_outcome
  ON gs_ml_predictions(outcome_recorded) WHERE NOT outcome_recorded;
