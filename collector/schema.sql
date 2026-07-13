CREATE TABLE IF NOT EXISTS match_odds_log (
  id            bigserial PRIMARY KEY,

  event_id      int  NOT NULL,
  match_type    text NOT NULL,
  home_team     text NOT NULL,
  away_team     text NOT NULL,
  match_date    date NOT NULL,

  snapshot_type text NOT NULL,
  period        int  NOT NULL,
  minute        int,
  is_h2         bool NOT NULL DEFAULT false,
  score_home    int  NOT NULL,
  score_away    int  NOT NULL,
  suspended     bool NOT NULL DEFAULT false,
  betting_open  bool NOT NULL DEFAULT true,

  odds_home     numeric(6,3),
  odds_away     numeric(6,3),
  odds_draw     numeric(6,3),
  malay_home    text,
  malay_away    text,
  malay_draw    text,

  hc_line       text,
  hc_home_odds  text,
  hc_away_odds  text,
  hc_home_gives bool,

  hc_h1_line       text,
  hc_h1_home_odds  text,
  hc_h1_away_odds  text,
  hc_h1_home_gives bool,

  ou_line   text,
  ou_over   text,
  ou_under  text,

  ou_h1_line  text,
  ou_h1_over  text,
  ou_h1_under text,

  yellow_home   int NOT NULL DEFAULT 0,
  yellow_away   int NOT NULL DEFAULT 0,
  red_home      int NOT NULL DEFAULT 0,
  red_away      int NOT NULL DEFAULT 0,
  corners_home  int NOT NULL DEFAULT 0,
  corners_away  int NOT NULL DEFAULT 0,

  recorded_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mol_event_time ON match_odds_log (event_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_mol_date       ON match_odds_log (match_date);
CREATE INDEX IF NOT EXISTS idx_mol_type       ON match_odds_log (snapshot_type);
CREATE INDEX IF NOT EXISTS idx_mol_score      ON match_odds_log (score_home, score_away);
