-- Normalize all team names to original API format: "Team (V)" / "Team (S)"
-- Old:  "Vietnam (20p)"      → "Vietnam (V)"
-- Mid:  "Vietnam (V) (20p)"  → "Vietnam (V)"
-- New rows already correct.

-- home_team
UPDATE gs_matches_history SET home_team = REGEXP_REPLACE(home_team, ' \(V\) \(20p\)$', ' (V)') WHERE home_team LIKE '% (V) (20p)';
UPDATE gs_matches_history SET home_team = REGEXP_REPLACE(home_team, ' \(S\) \(16p\)$', ' (S)') WHERE home_team LIKE '% (S) (16p)';
UPDATE gs_matches_history SET home_team = REGEXP_REPLACE(home_team, ' \(20p\)$', ' (V)')        WHERE home_team LIKE '% (20p)';
UPDATE gs_matches_history SET home_team = REGEXP_REPLACE(home_team, ' \(16p\)$', ' (S)')        WHERE home_team LIKE '% (16p)';

-- away_team
UPDATE gs_matches_history SET away_team = REGEXP_REPLACE(away_team, ' \(V\) \(20p\)$', ' (V)') WHERE away_team LIKE '% (V) (20p)';
UPDATE gs_matches_history SET away_team = REGEXP_REPLACE(away_team, ' \(S\) \(16p\)$', ' (S)') WHERE away_team LIKE '% (S) (16p)';
UPDATE gs_matches_history SET away_team = REGEXP_REPLACE(away_team, ' \(20p\)$', ' (V)')        WHERE away_team LIKE '% (20p)';
UPDATE gs_matches_history SET away_team = REGEXP_REPLACE(away_team, ' \(16p\)$', ' (S)')        WHERE away_team LIKE '% (16p)';

-- Verify
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE home_team LIKE '% (V)') AS v_teams,
  COUNT(*) FILTER (WHERE home_team LIKE '% (S)') AS s_teams,
  COUNT(*) FILTER (WHERE home_team LIKE '% (20p)') AS old_20p_remaining,
  COUNT(*) FILTER (WHERE home_team LIKE '% (16p)') AS old_16p_remaining
FROM gs_matches_history;
