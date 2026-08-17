# SABA collector + API backend fixes — summary

Worktree: `/private/tmp/gs-dashboard-saba-fe` (branch `saba-football-pages-fe`).
All facts below verified against the live `gs_db` firehose (`saba_feed_raw`).
Decode self-test ran green (12/12) against real rows; `next build` PASS (exit 0).

## Files changed
- `collector/saba-decode.mjs` — league-dict decode, streaming-source decode, sub-market discriminator, in-play detection.
- `collector/saba-feed.mjs` — capture `l` league frames → `saba_leagues` + backfill match league names; aggregate `st` frames → full `streaming_json` map; persist `parent_id`/`child_match_type`/`gv`/`in_play`.
- `collector/schema-saba.sql` — new columns (idempotent `ADD COLUMN IF NOT EXISTS`) + `saba_leagues` table.
- `src/app/api/gs-saba-live/route.ts` — in-play + parent-only filter, real league names.
- `src/app/api/gs-saba-video/route.ts` — in-play + parent-only + has-stream filter, `playerBase` + per-match streaming payload.

## Root-cause findings (from `saba_feed_raw`)

### 1. League names — NULL because they arrive in a SEPARATE `l` frame
- The `m` match record carries only `leagueid` — NOT the name.
- League NAMES arrive on `evt_type='l'` frames (33k+ rows), keyed by `leagueid`, carrying `leaguenameen`/`leaguenamevn`/`leaguegroupid`/`leaguedisplaycat`/`countrycode`.
- These `l` tuples already flow through `handleMFrame` (decoded, firehosed) but were never consumed. Now routed to `upsertLeague` → `saba_leagues` + denormalized onto `saba_matches.league_name`/`league_name_vn`. Join verified: `saba_matches.league_id = l.leagueid` matches 1:1.
- Example real name: `SABA CLUB FRIENDLY Virtual PES 21 - 15 Mins Play` (leagueid 95730, leaguegroupid 42).
- `leaguedisplaycat`: 0 = real league, 3 = CORNERS sub-market league (advisory; the real sub-market filter is `parent_id`, below).

### 2. Prop/sub-market pollution — discriminator CONFIRMED
- Sub-markets ("Arsenal - Over", "Arsenal 7th Corner", "Arsenal Total Bookings") have `parentid` NON-ZERO **and** `childmatchtype` set (e.g. 204/205/207/209).
- Real matches: `parentid` empty/0.
- Stored as `parent_id` (null for real) + `child_match_type`. Both live + video APIs filter `WHERE parent_id IS NULL`.

### 3. Not-actually-live — `marketid`/`eventstatus` are USELESS
- Every `m` record reports `marketid='T'`, `eventstatus='running'`, `timestatus=0` regardless of play state — so the old `is_live` was meaningless.
- The reliable signal is **`liveperiod`**: `0` = pre-game/between/ended, `1` = H1 (playing), `2` = H2 (playing).
- Half-time: `liveperiod` resets to `0` but `isht=true` (verified: all `isht=true` rows have liveperiod 0, gamestatus 0) — still in-play.
- Ended: `gamestatus='6'` (liveperiod back to 0). `isfulltime` also ends.
- **Rule implemented:** `in_play = (liveperiod ∈ {1,2} OR isht=true) AND NOT (gamestatus='6' OR isfulltime)`.
- New `in_play` column added; `is_live` kept as an alias (same value) for back-compat. APIs gate on `in_play`.

### 4. Video fields — full streaming map is the AGGREGATE of `st` frames
- There is NO single `streaming` JSON key anywhere in the feed. Each `st` frame is ONE source for ONE match, keyed by `streamingsrc`. A match has up to 4 (`11,19,30,31`).
- The full map the player needs (`{"11":{…},"19":{…}}`) is built by collecting every `st` frame per match. Now aggregated in-memory and stored as `streaming_json jsonb`.
- Placeholder streams: srcs `30`/`31` often carry `streamingid="999"` (no real stream). `has_streaming` now = "any source with a real, non-`999` streamingid".
- `gv` (gameversion) on the `m` record = the `&GV=` URL param (observed value: `2`). Stored as `gv`.
- `home_id`/`away_id` (feed `homeid`/`awayid`) already captured → the `&Hid=`/`&Aid=` params.

## Video URL contract (for the FE lane)

`playerBase` is derived at request time from `saba_config.index_url` (the user's pasted live session): origin + the `(S(<session>))` path segment. Fallback: `session_b_host` + `session_b`.
Live example → `https://c0z0ia.bp7xvs95.com/(S(Tesqedixadf08af3056a4daa9b4b02a287359dd9))`.

**FE builds the URL as:**
```
<playerBase>/Streaming/Schedule?streamingType=SB&id=<matchId>&noMenu=false&Hid=<homeId>&Aid=<awayId>&sportType=1&GV=<gv>&display=streaming&isLive=true&matchId3Rd=&parentMatchId=0&vocalStreaming=&streaming=<encodeURIComponent(JSON.stringify(streamingJson))>&isSingleMatch=false&lang=vn&generalStreamingType=Match&focusSourceType=2
```

### `/api/gs-saba-video` response shape (EXACT)
```jsonc
{
  "ok": true,
  "playerBase": "https://c0z0ia.<domain>/(S(<session>))",   // string | null
  "matches": [
    {
      "matchId": 132397665,
      "homeTeam": "…",            // canonical if mapped, else raw
      "awayTeam": "…",
      "leagueName": "SABA CLUB FRIENDLY Virtual PES 21 - 15 Mins Play",
      "leagueNameVn": "…",        // string | null
      "homeId": 6,                // number | null  → &Hid=
      "awayId": 83,               // number | null  → &Aid=
      "gv": 2,                    // number | null  → &GV=
      "streamingJson": {          // Record<src, source> | null → &streaming= (URL-encode this whole object)
        "11": { "streamingsrc": 11, "streamingid": "783", "streamingfixing": false },
        "19": { "streamingsrc": 19, "streamingid": "60494753", "streamingfixing": false, "streamingofferto": 1 }
      },
      "streamingId": "783",       // back-compat single source | null
      "streamingSrc": 11,         // back-compat | null
      "score_home": 0,
      "score_away": 0,
      "minute": 7                 // number | null
    }
  ]
}
```
Notes for FE:
- Use `playerBase` + per-match fields to assemble the URL above. `streaming=` must be `encodeURIComponent(JSON.stringify(match.streamingJson))`.
- If `playerBase` is `null` (config not seeded) → prompt the user to re-paste the SABA link (same UX as token expiry).
- `matches` already excludes props, scheduled/ended, and no-stream matches.

## `/api/gs-saba-live` changes
- Now returns **in-play parent matches only** (`WHERE in_play = true AND parent_id IS NULL`), ordered by league group / league name.
- `leagueName`/`leagueNameVn` now carry the real dictionary names (no more "C-Sport" collapse); `leagues[]` summary carries real names too.
- `isLive` on each match now reflects `in_play`.
- Response shape (`matches[]` / `leagues[]`) is otherwise unchanged — no FE break.

## Schema migration (orchestrator re-runs on live gs_db)
`collector/schema-saba.sql` adds (all idempotent):
- `saba_matches`: `parent_id bigint`, `child_match_type int`, `streaming_json jsonb`, `gv int`, `in_play bool DEFAULT false`, `league_name_vn text`, `home_id bigint`, `away_id bigint` (last three no-op if present).
- Index `idx_saba_matches_inplay ON (in_play) WHERE parent_id IS NULL`.
- New table `saba_leagues (league_id PK, name_en, name_vn, league_group_id, display_cat, country_code, raw, …)`.

**After migration, `in_play` starts `false` for existing rows** — the collector re-populates it on the next `m` frame per match (seconds). No backfill needed.

## Verification
- Decode self-test (deleted after): 12/12 PASS against real `saba_feed_raw` rows — league name (en+vn), streaming map (multi-source, keyed by src), in-play (pre=false, H1=true, HT=true), prop discriminator (parentId+childMatchType set; real=null).
- `node --check` clean on both collector files.
- `npm run build` → exit 0, `✓ Compiled successfully`; both saba routes compiled.
- Did NOT restart pm2, did NOT apply schema on VPS, did NOT commit/push.
