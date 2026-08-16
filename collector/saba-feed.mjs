// saba-feed.mjs — gs-saba-feed collector (SABA / C-Sport socket.io feed)
//
// SEPARATE process from the K-Sport collector.js. Read-only on the feed (never
// bets, never touches money-config). Writes ONLY saba_* tables.
//
// Protocol decode is per capture/socket-schema-LIVE.md:
//   • field ids are DYNAMIC per bucket — the server sends ["f",base,[names...]]
//     schema frames; data tuples [op,type,idx,val,idx,val,...] index into them.
//     We parse the "f" frames per bucket, build idx→name, then decode by NAME.
//     We do NOT hardcode numeric field ids.
//   • ["c",room,rev,bucketHash] binds a room (c2/c3/c4) → bucket.
//   • route data tuples by type: "m"=match, "o"=odds, "-o"=odds-remove,
//     "st"=streaming.

import 'dotenv/config';
import { Pool } from 'pg';
import { io } from 'socket.io-client';
import { getSession, refreshToken } from './saba-auth.mjs';
import { normalizeTeam } from './team-normalize.mjs';
import {
  SchemaStore, num, computeMinute, computeSeconds,
  matchPatchFromAttrs, oddsFromAttrs, leagueFromAttrs, streamingFromAttrs,
} from './saba-decode.mjs';

const POLL_MS = 2000;

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── Dynamic "f"-schema decode (from saba-decode.mjs) ─────────────────────────
const store = new SchemaStore();
const roomToBucket = new Map(); // room (c2/c3/c4) -> bucket

// ─── In-memory model ──────────────────────────────────────────────────────────
const matches = new Map(); // matchid -> match state
const odds = new Map(); // oddsid -> odds state (incl. matchid ref, bettype)
const dirty = new Set(); // matchids whose odds/score/period changed since flush
const prevKey = new Map(); // matchid -> last flushed change-key
const teamCache = new Map(); // saba team name -> saba_teams.id
const leagues = new Map(); // leagueid -> { nameEn, nameVn, leagueGroupId, displayCat, countryCode, raw }
const streamingMaps = new Map(); // matchid -> { [streamingsrc]: entry } full streaming map
const leaguesDirty = new Set(); // leagueids changed since last flush

// Firehose buffer — EVERY tuple as received (no filter/dedup). Drained per flush.
const rawBuffer = [];

// Merge a decoded "m" patch into the match state Map.
function upsertMatchState(attrs) {
  const patch = matchPatchFromAttrs(attrs);
  if (patch.matchId == null) return;
  const cur = matches.get(patch.matchId) ?? { matchId: patch.matchId, scoreHome: 0, scoreAway: 0 };
  // merge raw across deltas rather than overwriting
  const mergedRaw = { ...(cur.raw ?? {}), ...(patch.raw ?? {}) };
  Object.assign(cur, patch);
  cur.raw = mergedRaw;
  cur.scoreHome ??= 0;
  cur.scoreAway ??= 0;
  backfillLeagueNames(cur);
  matches.set(cur.matchId, cur);
  dirty.add(cur.matchId);
}

// The 'm' record has leagueid but NOT the league name — names arrive on the 'l'
// league-dictionary frame. Fill league_name/league_name_vn from the dict when the
// match record itself didn't carry them.
function backfillLeagueNames(m) {
  if (m.leagueId == null) return;
  const dict = leagues.get(m.leagueId);
  if (!dict) return;
  if (m.leagueName == null && dict.nameEn != null) m.leagueName = dict.nameEn;
  if (m.leagueNameVn == null && dict.nameVn != null) m.leagueNameVn = dict.nameVn;
  if (m.leagueGroupId == null && dict.leagueGroupId != null) m.leagueGroupId = dict.leagueGroupId;
  if (m.countryCode == null && dict.countryCode != null) m.countryCode = dict.countryCode;
}

// Merge a decoded "l" league-dictionary frame into the league Map. Also re-backfill
// any already-seen match in that league whose name was still missing.
function upsertLeague(attrs) {
  const lg = leagueFromAttrs(attrs);
  if (!lg) return;
  const cur = leagues.get(lg.leagueId) ?? {};
  // keep the richest values seen (never overwrite a name with null)
  leagues.set(lg.leagueId, {
    nameEn: lg.nameEn ?? cur.nameEn ?? null,
    nameVn: lg.nameVn ?? cur.nameVn ?? null,
    leagueGroupId: lg.leagueGroupId ?? cur.leagueGroupId ?? null,
    displayCat: lg.displayCat ?? cur.displayCat ?? null,
    countryCode: lg.countryCode ?? cur.countryCode ?? null,
    raw: lg.raw,
  });
  leaguesDirty.add(lg.leagueId);
  for (const m of matches.values()) {
    if (m.leagueId === lg.leagueId && (m.leagueName == null || m.leagueNameVn == null)) {
      backfillLeagueNames(m);
      dirty.add(m.matchId);
    }
  }
}

function upsertOddsState(attrs) {
  const prev = odds.get(num(attrs.oddsid));
  // merge partial deltas so we re-decode with the full accumulated field set
  const merged = prev?.raw ? { ...prev.raw, ...attrs } : attrs;
  const o = oddsFromAttrs(merged);
  if (!o) return; // out-of-scope market — skip
  odds.set(o.oddsId, o);
  dirty.add(o.matchId);
}

function removeOdds(oddsId) {
  const o = odds.get(oddsId);
  if (!o) return;
  o.suspended = true;
  o.removed = true;
  dirty.add(o.matchId);
}

function upsertStreaming(attrs) {
  const s = streamingFromAttrs(attrs);
  if (!s) return;
  const { matchId, src, entry } = s;
  const cur = matches.get(matchId) ?? { matchId, scoreHome: 0, scoreAway: 0 };
  // Build the FULL streaming map keyed by streamingsrc (the video player needs the
  // whole object, not a single id/src). Each 'st' frame contributes one source.
  const map = streamingMaps.get(matchId) ?? {};
  map[String(src)] = entry;
  streamingMaps.set(matchId, map);
  cur.streamingJson = map;
  // Keep single-source fields for back-compat (first/primary source seen).
  if (cur.streamingId == null && entry.streamingid != null) cur.streamingId = entry.streamingid;
  if (cur.streamingSrc == null) cur.streamingSrc = src;
  cur.hasStreaming = Object.values(map).some(
    (e) => e.streamingid != null && e.streamingid !== '' && e.streamingid !== '999'
  );
  matches.set(matchId, cur);
  dirty.add(matchId);
}

// Buffer one firehose row (no filter/dedup). Stored verbatim in saba_feed_raw.
function bufferRaw(bucket, evtType, decodedOrTuple) {
  const a = decodedOrTuple && !Array.isArray(decodedOrTuple) ? decodedOrTuple : null;
  rawBuffer.push({
    bucket,
    evtType,
    matchId: a ? num(a.matchid) : null,
    oddsId: a ? num(a.oddsid) : null,
    bettype: a ? num(a.bettype) : null,
    raw: decodedOrTuple,
  });
}

// ─── Frame processing ─────────────────────────────────────────────────────────
function handleMFrame(bucket, deltas) {
  for (const d of deltas) {
    if (typeof d === 'string') continue; // "reset"/"empty"/"done" lifecycle tokens
    if (!Array.isArray(d)) continue;
    // Control: ["c",room,rev,bucketHash] — bind room→bucket. bucketHash ends -bNNN.
    if (d[0] === 'c') {
      const room = d[1];
      const hash = String(d[3] ?? '');
      const m = hash.match(/-(b\d+)$/);
      if (room && m) roomToBucket.set(room, m[1]);
      bufferRaw(bucket, 'c', d);
      continue;
    }
    // Schema: ["f",base,[names...]]
    if (d[0] === 'f') {
      store.applySchema(bucket, d[1], d[2] ?? []);
      bufferRaw(bucket, 'f', d);
      continue;
    }
    // Data: [op,type,idx,val,...]
    if (d[0] === 0 && typeof d[1] === 'string') {
      const type = d[1];
      if (type === '-o') { removeOdds(num(d[3])); bufferRaw(bucket, '-o', d); continue; }
      if (type.startsWith('-')) { bufferRaw(bucket, type, d); continue; }
      const dec = store.decodeTuple(bucket, d);
      // Firehose: store EVERY decoded tuple verbatim, NO bettype/market filter.
      bufferRaw(bucket, type, dec ? dec.attrs : d);
      if (!dec) continue;
      if (dec.type === 'm' || dec.type === 'ls') upsertMatchState(dec.attrs);
      else if (dec.type === 'o') upsertOddsState(dec.attrs);
      else if (dec.type === 'st') upsertStreaming(dec.attrs);
      else if (dec.type === 'l') upsertLeague(dec.attrs);
    }
  }
}

// ─── Change detection ─────────────────────────────────────────────────────────
function matchOddsFor(matchId) {
  const out = [];
  for (const o of odds.values()) if (o.matchId === matchId && !o.removed) out.push(o);
  return out;
}

function changeKey(m, os) {
  const parts = os
    .map(o => `${o.market}:${o.half}:${o.line}:${o.homePrice}:${o.awayPrice}:${o.drawPrice}:${o.suspended ? 1 : 0}`)
    .sort();
  return JSON.stringify({ s: `${m.scoreHome}-${m.scoreAway}`, p: m.period ?? null, o: parts });
}

function snapshotType(matchId, m, prevParsed) {
  if (!prevParsed) return 'first_seen';
  const [ph, pa] = String(prevParsed.s).split('-').map(Number);
  if ((m.scoreHome ?? 0) > ph || (m.scoreAway ?? 0) > pa) return 'goal';
  if ((prevParsed.p ?? null) !== (m.period ?? null)) return 'period';
  return 'change';
}

// ─── Flush ────────────────────────────────────────────────────────────────────
async function ensureTeam(name, providerId) {
  if (!name) return null;
  const cacheKey = name;
  if (teamCache.has(cacheKey)) return teamCache.get(cacheKey);
  const { rows } = await pool.query(
    `INSERT INTO saba_teams (name, saba_provider_id) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET last_seen = now(),
       saba_provider_id = COALESCE(saba_teams.saba_provider_id, EXCLUDED.saba_provider_id)
     RETURNING id`,
    [name, providerId ?? null]
  );
  const id = rows[0]?.id ?? null;
  if (id != null) {
    teamCache.set(cacheKey, id);
    const guess = normalizeTeam(name);
    await pool.query(
      `INSERT INTO saba_team_map (saba_team_id, saba_name, saba_provider_id, auto_guess)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (saba_name) DO UPDATE SET
         saba_provider_id = COALESCE(saba_team_map.saba_provider_id, EXCLUDED.saba_provider_id)`,
      [id, name, providerId ?? null, guess]
    );
  }
  return id;
}

async function flushMatch(matchId) {
  const m = matches.get(matchId);
  if (!m || !m.homeTeamRaw || !m.awayTeamRaw) return;

  const homeSabaId = await ensureTeam(m.homeTeamRaw, m.homeId);
  const awaySabaId = await ensureTeam(m.awayTeamRaw, m.awayId);
  const minute = computeMinute(m.livetimer);

  await pool.query(
    `INSERT INTO saba_matches (
       match_id, home_team, away_team, home_team_vn, away_team_vn,
       home_saba_team_id, away_saba_team_id, home_id, away_id,
       league_id, league_name, league_name_vn, league_group_id,
       league_display_cat, country_code, play_format, pes_version, kickoff_at,
       score_home, score_away, period, minute, is_live,
       home_red, away_red, goal_team, pen_status, injury_time,
       live_period, game_status, event_status, is_ht, is_fulltime, raw,
       streaming_id, streaming_src, has_streaming, section_id,
       parent_id, child_match_type, gv, streaming_json, in_play, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       to_timestamp(NULLIF($18,'')::double precision),
       $19,$20,$21,$22,$23,
       $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
       $35,$36,$37,$38,
       $39,$40,$41,$42,$43, now()
     )
     ON CONFLICT (match_id) DO UPDATE SET
       home_team = EXCLUDED.home_team, away_team = EXCLUDED.away_team,
       home_team_vn = EXCLUDED.home_team_vn, away_team_vn = EXCLUDED.away_team_vn,
       home_saba_team_id = EXCLUDED.home_saba_team_id, away_saba_team_id = EXCLUDED.away_saba_team_id,
       home_id = EXCLUDED.home_id, away_id = EXCLUDED.away_id,
       league_id = EXCLUDED.league_id,
       league_name = COALESCE(EXCLUDED.league_name, saba_matches.league_name),
       league_name_vn = COALESCE(EXCLUDED.league_name_vn, saba_matches.league_name_vn),
       league_group_id = EXCLUDED.league_group_id,
       league_display_cat = EXCLUDED.league_display_cat, country_code = EXCLUDED.country_code,
       section_id = EXCLUDED.section_id,
       play_format = EXCLUDED.play_format, pes_version = EXCLUDED.pes_version,
       score_home = EXCLUDED.score_home, score_away = EXCLUDED.score_away,
       period = EXCLUDED.period, minute = EXCLUDED.minute, is_live = EXCLUDED.is_live,
       home_red = EXCLUDED.home_red, away_red = EXCLUDED.away_red,
       goal_team = EXCLUDED.goal_team, pen_status = EXCLUDED.pen_status,
       injury_time = EXCLUDED.injury_time, live_period = EXCLUDED.live_period,
       game_status = EXCLUDED.game_status, event_status = EXCLUDED.event_status,
       is_ht = EXCLUDED.is_ht, is_fulltime = EXCLUDED.is_fulltime,
       raw = EXCLUDED.raw,
       streaming_id = COALESCE(EXCLUDED.streaming_id, saba_matches.streaming_id),
       streaming_src = COALESCE(EXCLUDED.streaming_src, saba_matches.streaming_src),
       has_streaming = EXCLUDED.has_streaming,
       parent_id = EXCLUDED.parent_id, child_match_type = EXCLUDED.child_match_type,
       gv = COALESCE(EXCLUDED.gv, saba_matches.gv),
       streaming_json = COALESCE(EXCLUDED.streaming_json, saba_matches.streaming_json),
       in_play = EXCLUDED.in_play,
       updated_at = now()`,
    [
      m.matchId, m.homeTeamRaw, m.awayTeamRaw, m.homeTeamVn ?? null, m.awayTeamVn ?? null,
      homeSabaId, awaySabaId, m.homeId ?? null, m.awayId ?? null,
      m.leagueId ?? null, m.leagueName ?? null, m.leagueNameVn ?? null, m.leagueGroupId ?? null,
      m.leagueDisplayCat ?? null, m.countryCode ?? null, m.playFormat ?? null, m.pesVersion ?? null,
      m.kickoffAt != null ? String(m.kickoffAt) : '',
      m.scoreHome ?? 0, m.scoreAway ?? 0, m.period ?? null, minute, !!m.isLive,
      m.homeRed ?? 0, m.awayRed ?? 0, m.goalTeam ?? null, m.penStatus ?? null, m.injuryTime ?? null,
      m.period ?? null, m.gameStatus ?? null, m.eventStatus ?? null, m.isHt ?? null, m.isFulltime ?? null,
      m.raw ? JSON.stringify(m.raw) : null,
      m.streamingId ?? null, m.streamingSrc ?? null, !!m.hasStreaming,
      m.leagueGroupId ?? null, // section_id = leaguegroupid
      m.parentId ?? null, m.childMatchType ?? null, m.gv ?? null,
      m.streamingJson ? JSON.stringify(m.streamingJson) : null, !!m.inPlay,
    ]
  );

  // Only append odds snapshots for live/today matches whose state changed.
  const os = matchOddsFor(matchId);
  const key = changeKey(m, os);
  const prev = prevKey.get(matchId);
  if (prev === key) return;
  const prevParsed = prev ? JSON.parse(prev) : null;
  const snap = snapshotType(matchId, m, prevParsed);
  prevKey.set(matchId, key);

  if (os.length === 0) return;
  const seconds = computeSeconds(m.livetimer);
  for (const o of os) {
    await pool.query(
      `INSERT INTO saba_odds (
         match_id, snapshot_type, market, half, line,
         home_price, away_price, draw_price, home_gives,
         suspended, score_home, score_away, minute, seconds_elapsed, period,
         odds_id, raw
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        matchId, snap, o.market, o.half, o.line,
        o.homePrice, o.awayPrice, o.drawPrice, o.homeGives,
        !!o.suspended, m.scoreHome ?? 0, m.scoreAway ?? 0, minute, seconds, m.period ?? null,
        o.oddsId, o.raw ? JSON.stringify(o.raw) : null,
      ]
    );
  }
}

// Drain the firehose buffer to saba_feed_raw. Multi-row insert; drops nothing.
// Chunked so a single INSERT never exceeds Postgres' 65535-param limit.
async function flushRaw() {
  if (rawBuffer.length === 0) return;
  const batch = rawBuffer.splice(0, rawBuffer.length);
  const CHUNK = 500; // 500 rows × 6 params = 3000 params/statement
  for (let start = 0; start < batch.length; start += CHUNK) {
    const chunk = batch.slice(start, start + CHUNK);
    const rowsSql = chunk
      .map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`)
      .join(',');
    const flat = [];
    for (const r of chunk) {
      flat.push(r.bucket, r.evtType, r.matchId, r.oddsId, r.bettype, r.raw != null ? JSON.stringify(r.raw) : null);
    }
    try {
      await pool.query(
        `INSERT INTO saba_feed_raw (bucket, evt_type, match_id, odds_id, bettype, raw)
         VALUES ${rowsSql}`,
        flat
      );
    } catch (e) {
      console.error('[RAW FLUSH ERROR]', e.message);
    }
  }
}

// Persist changed league-dictionary rows to saba_leagues.
async function flushLeagues() {
  if (leaguesDirty.size === 0) return;
  const ids = [...leaguesDirty];
  leaguesDirty.clear();
  for (const id of ids) {
    const lg = leagues.get(id);
    if (!lg) continue;
    try {
      await pool.query(
        `INSERT INTO saba_leagues (
           league_id, name_en, name_vn, league_group_id, display_cat, country_code, raw, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (league_id) DO UPDATE SET
           name_en = COALESCE(EXCLUDED.name_en, saba_leagues.name_en),
           name_vn = COALESCE(EXCLUDED.name_vn, saba_leagues.name_vn),
           league_group_id = COALESCE(EXCLUDED.league_group_id, saba_leagues.league_group_id),
           display_cat = COALESCE(EXCLUDED.display_cat, saba_leagues.display_cat),
           country_code = COALESCE(EXCLUDED.country_code, saba_leagues.country_code),
           raw = EXCLUDED.raw, updated_at = now()`,
        [id, lg.nameEn ?? null, lg.nameVn ?? null, lg.leagueGroupId ?? null,
         lg.displayCat ?? null, lg.countryCode ?? null, lg.raw ? JSON.stringify(lg.raw) : null]
      );
    } catch (e) {
      console.error('[LEAGUE FLUSH ERROR]', id, e.message);
    }
  }
}

async function flush() {
  await flushRaw();
  await flushLeagues();
  if (dirty.size === 0) return;
  const ids = [...dirty];
  dirty.clear();
  for (const id of ids) {
    try {
      await flushMatch(id);
    } catch (e) {
      console.error('[FLUSH ERROR]', id, e.message);
    }
  }
}

// ─── Socket lifecycle ─────────────────────────────────────────────────────────
let socket = null;
let refreshTimer = null;
let currentToken = null; // token the live socket is using (for change-detection)

// Confirmed cadence: LoginCheckin/Index every ~60s keeps the 1h JWT fresh.
// On a new `at`, hot-swap it into the live socket via changeRID (no reconnect);
// fall back to a reconnect if changeRID isn't available.
const REFRESH_MS = 60000;
function scheduleRefresh(rt) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const next = await refreshToken(rt);
      if (next.token && next.token !== currentToken) {
        currentToken = next.token;
        rt = next.rt || rt;
        if (socket && typeof socket.emit === 'function') {
          socket.emit('changeRID', 'jwt', next.token); // hot-swap, no reconnect
        }
      }
    } catch (e) {
      console.warn('[SABA] refresh failed:', e.message);
    } finally {
      scheduleRefresh(rt); // keep looping
    }
  }, REFRESH_MS);
}

let backoff = 1000;

async function connect() {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    // No usable token (expired / not pasted). Idle — do NOT crash. Retry slowly;
    // the user pastes a fresh token in the UI → saba_config → picked up here.
    console.warn('[SABA]', e.message);
    setTimeout(() => { connect(); }, 10000);
    return;
  }
  const { socketHost, gid, id, token, rt } = session;
  currentToken = token;

  if (socket) { try { socket.close(); } catch { /* noop */ } socket = null; }

  const url = `wss://${socketHost}`;
  socket = io(url, {
    path: '/socket.io/',
    transports: ['websocket'],
    query: { gid, token, id, rid: 'jwt', EIO: 4 },
    reconnection: false,
  });

  socket.on('connect', () => {
    backoff = 1000;
    console.log(`[SABA] connected → ${socketHost}`);
    socket.emit('init', { gid, token, id, rid: 'jwt', v: 2 });
    subscribe();
    scheduleRefresh(rt);
  });

  // "m" event carries control/schema/data tuples per bucket.
  socket.on('m', (bucket, deltas) => {
    if (typeof bucket !== 'string' || !/^b\d/.test(bucket)) return;
    if (!Array.isArray(deltas)) return;
    handleMFrame(bucket, deltas);
  });

  socket.on('disconnect', (reason) => {
    console.warn('[SABA] disconnect:', reason);
    scheduleReconnect();
  });
  socket.on('connect_error', (err) => {
    console.warn('[SABA] connect_error:', err?.message ?? err);
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  const wait = backoff;
  backoff = Math.min(backoff * 2, 30000);
  console.log(`[SABA] reconnect in ${wait / 1000}s`);
  setTimeout(() => { connect(); }, wait);
}

// Subscribe to soccer live (c2) + today (c3) odds + streaming (c4), per capture §3.
function subscribe() {
  const bettype = [1, 2, 3, 5, 7, 8, 15, 22, 301, 302, 303, 304, 394, 396, 400,
    470, 471, 461, 462, 24, 448, 393, 390, 381, 382, 482, 483, 413];
  socket.emit('subscribe', [
    ['spread', [{ id: 'c0', rev: '', sorting: 0, condition: {} }]],
    ['odds', [
      { id: 'c1', rev: '', sorting: 0, condition: { sporttype: 1, no_stream: true, source: 'hotleaguewall', mini: 1, bettype: [1, 3] } },
      { id: 'c2', rev: '', sorting: 'n', condition: { sporttype: 1, marketid: 'L', no_stream: true, bettype, source: null } },
      { id: 'c3', rev: '', sorting: 'n', condition: { sporttype: 1, marketid: 'T', no_stream: true, bettype, source: null } },
    ]],
  ]);
  socket.emit('subscribe', [['streaming', [{ id: 'c4', rev: '', sorting: 0, condition: { sporttype: 1 } }]]]);
}

// Poll saba_config every 10s; if the user re-pasted a different token, reconnect.
async function pollConfig() {
  try {
    const next = await refreshToken(null);
    if (next.token && currentToken && next.token !== currentToken) {
      console.warn('[SABA] token changed in saba_config — reconnecting');
      await connect();
    }
  } catch (e) {
    console.warn('[SABA] config poll failed:', e.message);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
console.log('gs-saba-feed started — flush every 2s');
console.log(`DB: ${process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://<hidden>@')}`);
connect();
setInterval(() => { flush().catch(e => console.error('[FLUSH LOOP]', e.message)); }, POLL_MS);
setInterval(() => { pollConfig(); }, 10000);
