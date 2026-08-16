-- ─────────────────────────────────────────────────────────────────────────────
-- SABA (C-Sport) schema — NEW TABLES ONLY.
--
-- ISOLATION GUARANTEE: this file creates ONLY `saba_*` tables. It performs ZERO
-- writes / ZERO DDL (ALTER/DROP/INDEX) against any existing K-Sport `gs_*` table
-- (gs_teams, gs_matches_history, match_odds_log, gs_tx_paper, ...). The C-Sport
-- dataset is 100% self-contained. `saba_team_map` references a canonical GS team
-- only as PLAIN string/int columns — NO foreign key to gs_teams.
--
-- Apply (manual, on the VPS gs_db — same as collector/schema.sql):
--   psql "postgresql://gs_user:Gs2024VPS@localhost:5432/gs_db" -f collector/schema-saba.sql
--
-- Do NOT auto-apply from CI or from the Next app.
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.0 saba_config — key/value store for the SABA connection. Written by
-- /api/gs-saba-token (user pastes the NewIndex URL / at-rt seed), read+updated by
-- saba-auth.mjs (pure-Node LoginCheckin/Index refresh loop). Own table only.
-- Keys: index_url, at (JWT), rt (refresh GUID), session_b (c0z0ia S(...) path),
--       push_node (wss host), member_id, gid, [socket_url (back-compat)].
CREATE TABLE IF NOT EXISTS saba_config (
  key         text PRIMARY KEY,
  value       text,
  updated_at  timestamptz DEFAULT now()
);

-- 3.1 saba_teams — C-Sport team dimension (isolated; NOT gs_teams)
CREATE TABLE IF NOT EXISTS saba_teams (
  id               bigserial PRIMARY KEY,
  name             text NOT NULL,         -- raw C-Sport team name as seen on feed (English)
  saba_provider_id bigint,                -- stable SABA-internal team id (homeid/awayid); names vary, id is stable
  first_seen       timestamptz DEFAULT now(),
  last_seen        timestamptz DEFAULT now(),
  UNIQUE (name)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saba_teams_provider ON saba_teams (saba_provider_id) WHERE saba_provider_id IS NOT NULL;

-- 3.2 saba_team_map — C-Sport → canonical GS mapping (join bridge; NO FK to gs_teams)
CREATE TABLE IF NOT EXISTS saba_team_map (
  saba_team_id         bigint PRIMARY KEY REFERENCES saba_teams(id),
  saba_name            text NOT NULL,         -- denormalized copy of saba_teams.name for easy joins
  saba_provider_id     bigint,                -- stable SABA-internal team id (copy of saba_teams.saba_provider_id)
  canonical_name       text,                  -- canonical GS/K-Sport team name (e.g. 'Japan'); NULL until mapped
  canonical_gs_team_id int,                   -- optional plain int copy of gs_teams.id; NO FK; may go stale
  mapped               bool NOT NULL DEFAULT false,  -- false = auto-stub awaiting manual mapping
  auto_guess           text,                  -- best-effort normalized guess (advisory only)
  updated_at           timestamptz DEFAULT now(),
  UNIQUE (saba_name)
);

-- 3.3 saba_matches — C-Sport match dimension + live state
CREATE TABLE IF NOT EXISTS saba_matches (
  match_id      bigint PRIMARY KEY,        -- SABA matchId (feed <id>, video id=)
  home_team     text NOT NULL,             -- raw C-Sport name (English)
  away_team     text NOT NULL,             -- raw C-Sport name (English)
  home_team_vn  text,                      -- Vietnamese display name (hteamnamevn)
  away_team_vn  text,                      -- Vietnamese display name (ateamnamevn)
  home_saba_team_id bigint REFERENCES saba_teams(id),
  away_saba_team_id bigint REFERENCES saba_teams(id),
  home_id       bigint,                    -- C-Sport internal team id (homeid)
  away_id       bigint,                    -- C-Sport internal team id (awayid)

  league_id         bigint,                -- SABA league id (leagueid); nullable
  league_name       text,                  -- English league name (leaguenameen) — stored VERBATIM/full
  league_name_vn    text,                  -- Vietnamese league name (leaguenamevn) — stored VERBATIM/full
  league_group_id   bigint,                -- SABA league group id (leaguegroupid); groups related sections
  section_id        bigint,                -- SABA section id = leaguegroupid (stable section grouping id)
  league_display_cat text,                 -- leaguedisplaycat if present; advisory
  country_code      text,                  -- countrycode / hteamcountrycode
  play_format       text,                  -- derived from league name: '5min'|'15min'|'20min'|'penalty'|NULL
  pes_version       text,                  -- derived from 'Virtual PES <NN>': '21'|'23'|'26'|NULL

  kickoff_at    timestamptz,               -- start time if provided by feed (nullable)
  score_home    int NOT NULL DEFAULT 0,
  score_away    int NOT NULL DEFAULT 0,
  period        int,                       -- liveperiod
  minute        int,                       -- running minute derived from livetimer epoch anchor
  is_live       bool NOT NULL DEFAULT false,

  -- Match-event / state columns (decoded from the "m" record field names)
  home_red      int NOT NULL DEFAULT 0,    -- homered (RED CARDS)
  away_red      int NOT NULL DEFAULT 0,    -- awayred (RED CARDS)
  goal_team     text,                      -- goalteam — which side scored last
  pen_status    text,                      -- sabapenst — SABA penalty status (PENALTY SHOOTOUTS leagues)
  injury_time   int,                       -- injurytime
  live_period   int,                       -- liveperiod (raw)
  game_status   text,                      -- gamestatus
  event_status  text,                      -- eventstatus
  is_ht         bool,                      -- isht
  is_fulltime   bool,                      -- isfulltime

  raw           jsonb,                     -- full decoded name→value "m" record (nothing lost)

  streaming_id  text,                      -- from 'st' delta (streamingid); NULL if none
  streaming_src int,                       -- from 'st' delta (streamingsrc)
  has_streaming bool NOT NULL DEFAULT false,

  first_seen    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saba_matches_live    ON saba_matches (is_live);
CREATE INDEX IF NOT EXISTS idx_saba_matches_updated ON saba_matches (updated_at);
CREATE INDEX IF NOT EXISTS idx_saba_matches_league  ON saba_matches (league_group_id, league_name, match_id);

-- 3.3a saba_matches column additions (idempotent — safe to re-run on live gs_db).
--   parent_id / child_match_type : sub-market discriminator. Real (parent) matches
--     have parent_id NULL/0; corner/booking/over sub-markets have parent_id set AND
--     child_match_type set. The live/video APIs filter these OUT.
--   streaming_json : FULL streaming source map, keyed by streamingsrc — built by
--     aggregating every 'st' frame for the match, e.g.
--       {"11":{"streamingsrc":11,"streamingid":"783",...},"19":{...},"30":{...}}
--     The video player URL needs this whole object (URL-encoded), not one id/src.
--   gv : gameversion (raw 'gv' on the m record) → the &GV= player URL param.
--   in_play : TRUE only when the match is actually being played (liveperiod 1|2 or
--     half-time), NOT scheduled/pre-game/ended. is_live is kept for back-compat but
--     the APIs now gate on in_play.
ALTER TABLE saba_matches ADD COLUMN IF NOT EXISTS parent_id        bigint;
ALTER TABLE saba_matches ADD COLUMN IF NOT EXISTS child_match_type int;
ALTER TABLE saba_matches ADD COLUMN IF NOT EXISTS streaming_json   jsonb;
ALTER TABLE saba_matches ADD COLUMN IF NOT EXISTS gv               int;
ALTER TABLE saba_matches ADD COLUMN IF NOT EXISTS in_play          bool NOT NULL DEFAULT false;
ALTER TABLE saba_matches ADD COLUMN IF NOT EXISTS league_name_vn   text;
ALTER TABLE saba_matches ADD COLUMN IF NOT EXISTS home_id          bigint;
ALTER TABLE saba_matches ADD COLUMN IF NOT EXISTS away_id          bigint;
-- Real-match, in-play index for the live/video APIs (parent matches only).
CREATE INDEX IF NOT EXISTS idx_saba_matches_inplay ON saba_matches (in_play) WHERE parent_id IS NULL;

-- 3.3b saba_leagues — SABA league dictionary (keyed by leagueid). Populated from
-- the 'l' league-dictionary frames on the feed, which carry the localized league
-- NAMES that the 'm' match record does NOT. The collector upserts here and also
-- denormalizes name_en/name_vn back onto saba_matches.league_name/league_name_vn.
CREATE TABLE IF NOT EXISTS saba_leagues (
  league_id     bigint PRIMARY KEY,        -- SABA leagueid
  name_en       text,                      -- leaguenameen (full, verbatim)
  name_vn       text,                      -- leaguenamevn (full, verbatim)
  league_group_id bigint,                  -- leaguegroupid
  display_cat   int,                       -- leaguedisplaycat (0 = real; 3 = corners; etc.)
  country_code  text,                      -- countrycode
  raw           jsonb,                     -- full decoded 'l' record
  first_seen    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- 3.4 saba_odds — C-Sport odds tick log. Tick-level completeness modelled on
-- gs_16p_ticks: append a row on EVERY meaningful change the socket pushes (one
-- row per (market, half) per tick — no change is dropped). Each row carries the
-- full odds state for that market/half at that instant + a raw jsonb of the
-- decoded odds record so the row is 100% reconstructable later.
CREATE TABLE IF NOT EXISTS saba_odds (
  id            bigserial PRIMARY KEY,
  match_id      bigint NOT NULL REFERENCES saba_matches(match_id),

  snapshot_type text NOT NULL,             -- 'first_seen' | 'change' | 'goal' | 'period'
  market        text NOT NULL,             -- 'HDP' | 'OU' | '1X2' (core soccer markets only)
  half          text NOT NULL DEFAULT 'FT',-- 'FT' | 'H1'
  line          text,                      -- HDP/OU line as feed string (hdp1 − hdp2)
  home_price    text,                      -- HDP home / OU over / 1X2 home  (Malay, verbatim)
  away_price    text,                      -- HDP away / OU under / 1X2 away (Malay, verbatim)
  draw_price    text,                      -- 1X2 draw only (NULL otherwise)
  home_gives    bool,                      -- HDP: true = home favourite gives
  suspended     bool NOT NULL DEFAULT false,
  score_home    int NOT NULL DEFAULT 0,    -- score at snapshot
  score_away    int NOT NULL DEFAULT 0,
  minute        int,                       -- running minute
  seconds_elapsed int,                     -- running seconds (finer than minute; cf. gs_16p_ticks)
  period        int,                       -- match period at snapshot
  odds_id       bigint,                    -- SABA oddsId (for traceability)
  raw           jsonb,                     -- full decoded name→value odds record for this tick
  recorded_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saba_odds_match_time ON saba_odds (match_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_saba_odds_market     ON saba_odds (match_id, market, half);

-- 3.5 saba_feed_raw — complete firehose. EVERY socket data tuple stored verbatim:
-- NO bettype filter, NO dedup, NO change-detection. Guaranteed-complete source of
-- truth (all markets: HDP/OU/1X2/corners/exotic/HT/everything). Disk-heavy by
-- design (same philosophy as gs_16p_ticks) — see backend-summary.md for retention.
CREATE TABLE IF NOT EXISTS saba_feed_raw (
  id           bigserial PRIMARY KEY,
  received_at  timestamptz DEFAULT now(),
  bucket       text,                       -- server bucket id (bNNN)
  evt_type     text,                       -- 'm' | 'o' | '-o' | 'st' | 'f' | 'c' | ...
  match_id     bigint,                     -- resolved matchid where present (nullable)
  odds_id      bigint,                     -- resolved oddsid where present (nullable)
  bettype      int,                        -- odds bettype where present (nullable)
  raw          jsonb                       -- decoded name→value object, or raw tuple array for f/c frames
);
CREATE INDEX IF NOT EXISTS idx_saba_feed_raw_time  ON saba_feed_raw (received_at);
CREATE INDEX IF NOT EXISTS idx_saba_feed_raw_match ON saba_feed_raw (match_id, received_at);
