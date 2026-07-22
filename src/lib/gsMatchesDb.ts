import { Pool } from 'pg';
import type { Match } from '../types/match';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL });
  }
  return pool;
}

const SELECT_COLS = `
  mh.match_time, mh.match_type, mh.league,
  COALESCE(ht.name || ' (' || ht.type || ')', mh.home_team) AS home_team,
  COALESCE(at.name || ' (' || at.type || ')', mh.away_team) AS away_team,
  mh.h1_home, mh.h1_away, mh.tt_home, mh.tt_away
`;

const FROM_JOINS = `
  FROM gs_matches_history mh
  LEFT JOIN gs_teams ht ON ht.id = mh.home_team_id
  LEFT JOIN gs_teams at ON at.id = mh.away_team_id
`;

// The display name the UI works with (e.g. "Barcelona (S)"). Matches SELECT_COLS.
const HOME_NAME_EXPR = `COALESCE(ht.name || ' (' || ht.type || ')', mh.home_team)`;
const AWAY_NAME_EXPR = `COALESCE(at.name || ' (' || at.type || ')', mh.away_team)`;

// Bangkok local date (UTC+7) for a match, as YYYY-MM-DD — used for the `date` filter.
const LOCAL_DATE_EXPR = `to_char(mh.match_time + interval '7 hours', 'YYYY-MM-DD')`;

function rowToMatch(r: {
  match_time: string | Date;
  match_type: string;
  league: string;
  home_team: string;
  away_team: string;
  h1_home: number | string;
  h1_away: number | string;
  tt_home: number | string;
  tt_away: number | string;
}): Match {
  const ms = new Date(r.match_time).getTime() + 7 * 60 * 60 * 1000;
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    date: `${dd}/${mm}/${yyyy}`,
    time: `${dd}/${mm}/${yyyy} ${hh}:${min}`,
    matchType: r.match_type as '20p' | '16p',
    league: r.league,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    h1Home: String(r.h1_home),
    h1Away: String(r.h1_away),
    ttHome: String(r.tt_home),
    ttAway: String(r.tt_away),
  };
}

export async function fetchAllMatches(): Promise<Match[]> {
  const db = getPool();
  const { rows } = await db.query(`
    SELECT ${SELECT_COLS}
    ${FROM_JOINS}
    ORDER BY mh.match_time DESC
  `);
  return rows.map(rowToMatch);
}

export interface MatchQuery {
  type?: string; // 'all' | '20p' | '16p'
  date?: string; // 'all' | 'YYYY-MM-DD'
  team?: string; // 'all' | display name
  team2?: string; // 'all' | display name — when set with `team`, restricts to H2H matches between the two
  limit?: number;
  offset?: number;
}

export interface MatchPage {
  matches: Match[];
  total: number;
}

/**
 * Build the shared WHERE clause + params for a filtered match query.
 * Returns the clause (may be empty) and the ordered param list.
 */
function buildWhere(q: MatchQuery): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (q.type && q.type !== 'all') {
    params.push(q.type);
    clauses.push(`mh.match_type = $${params.length}`);
  }
  if (q.date && q.date !== 'all') {
    params.push(q.date);
    clauses.push(`${LOCAL_DATE_EXPR} = $${params.length}`);
  }
  if (q.team && q.team !== 'all') {
    params.push(q.team);
    const p = `$${params.length}`;
    clauses.push(`(${HOME_NAME_EXPR} = ${p} OR ${AWAY_NAME_EXPR} = ${p})`);
  }
  // Second team → head-to-head. ANDed with the first team's clause, so only
  // matches where BOTH teams appear (i.e. they played each other) survive.
  if (q.team2 && q.team2 !== 'all') {
    params.push(q.team2);
    const p = `$${params.length}`;
    clauses.push(`(${HOME_NAME_EXPR} = ${p} OR ${AWAY_NAME_EXPR} = ${p})`);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

/** Server-side filtered + paginated page of matches, plus total count for the same filters. */
export async function fetchMatchesPage(q: MatchQuery): Promise<MatchPage> {
  const db = getPool();
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const offset = Math.max(q.offset ?? 0, 0);

  const { where, params } = buildWhere(q);

  const countSql = `SELECT COUNT(*)::int AS total ${FROM_JOINS} ${where}`;
  const pageSql = `
    SELECT ${SELECT_COLS}
    ${FROM_JOINS}
    ${where}
    ORDER BY mh.match_time DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const [countRes, pageRes] = await Promise.all([
    db.query(countSql, params),
    db.query(pageSql, [...params, limit, offset]),
  ]);

  return {
    total: countRes.rows[0]?.total ?? 0,
    matches: pageRes.rows.map(rowToMatch),
  };
}

export interface FilterOptions {
  dates: { date: string; label: string; count: number }[]; // label = DD/MM/YYYY, value used by filter = YYYY-MM-DD
  teams: string[];
  count20: number;
  count16: number;
  total: number;
}

/** Distinct dates, teams, and per-type counts — computed once server-side for the filter UI. */
export async function fetchMatchFilterOptions(): Promise<FilterOptions> {
  const db = getPool();

  const datesSql = `
    SELECT ${LOCAL_DATE_EXPR} AS d, COUNT(*)::int AS count
    ${FROM_JOINS}
    GROUP BY ${LOCAL_DATE_EXPR}
    ORDER BY d DESC
  `;
  const teamsSql = `
    SELECT name FROM (
      SELECT DISTINCT ${HOME_NAME_EXPR} AS name ${FROM_JOINS}
      UNION
      SELECT DISTINCT ${AWAY_NAME_EXPR} AS name ${FROM_JOINS}
    ) t
    WHERE name IS NOT NULL
    ORDER BY name ASC
  `;
  const countsSql = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE mh.match_type = '20p')::int AS c20,
      COUNT(*) FILTER (WHERE mh.match_type = '16p')::int AS c16
    ${FROM_JOINS}
  `;

  const [datesRes, teamsRes, countsRes] = await Promise.all([
    db.query(datesSql),
    db.query(teamsSql),
    db.query(countsSql),
  ]);

  const dates = datesRes.rows.map((r: { d: string; count: number }) => {
    const [yyyy, mm, dd] = r.d.split('-');
    return { date: r.d, label: `${dd}/${mm}/${yyyy}`, count: r.count };
  });

  return {
    dates,
    teams: teamsRes.rows.map((r: { name: string }) => r.name),
    count20: countsRes.rows[0]?.c20 ?? 0,
    count16: countsRes.rows[0]?.c16 ?? 0,
    total: countsRes.rows[0]?.total ?? 0,
  };
}

// ── Bet stats (per-match betting outcomes) ──────────────────────────────────
//
// One row per match. Scores come from gs_matches_history (authoritative), the
// betting lines from match_odds_log. gs_matches_history.event_id is mostly 0 so
// it can't join by event_id — instead each history row is matched to the ONE
// match_odds_log event whose home/away team ids + Bangkok match_date agree and
// whose first snapshot (min recorded_at) is closest in time to match_time. A
// 60-minute window drops history rows older than the odds log (which would
// otherwise grab a far-away same-teams event) and keeps the mapping 1:1.

// W = money won (unit stake 1), L = -1, D (push) = 0. `null` when the line is
// missing (no bet could be graded).
export type BetOutcome = 'W' | 'L' | 'D' | null;

export interface BetStatsRow {
  eventId: number;
  date: string; // DD/MM/YYYY (Bangkok)
  weekday: number; // 1=Mon .. 7=Sun (Bangkok)
  matchType: '20p' | '16p';
  homeTeam: string;
  awayTeam: string;
  h1Home: number;
  h1Away: number;
  ttHome: number;
  ttAway: number;
  // Handicap (favorite gives `hcLine`)
  hcFav: 'home' | 'away' | null;
  hcLine: number | null;
  hcResult: BetOutcome;
  hcPnl: number | null;
  // First-half Over/Under — pre-match ou_h1_* line, graded on H1 goals (h1_home+h1_away)
  ouH1Line: number | null;
  overH1Result: BetOutcome;
  overH1Pnl: number | null;
  underH1Result: BetOutcome;
  underH1Pnl: number | null;
  // Full-match Over/Under — pre-match ou_* line, graded on FT total (tt_home+tt_away)
  ouLine: number | null;
  overResult: BetOutcome;
  overPnl: number | null;
  underResult: BetOutcome;
  underPnl: number | null;
  // Start-of-H2 Over/Under (line the book set after H1), graded on full-match total
  h2Line: number | null;
  h2OverOdds: number | null;
  h2UnderOdds: number | null;
  h2OverResult: BetOutcome;
  h2OverPnl: number | null;
  h2UnderResult: BetOutcome;
  h2UnderPnl: number | null;
}

export interface BetStatsSummaryLine {
  n: number; // graded bets (excludes null lines)
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null; // wins / (wins + losses)
  pnl: number; // total units
}

export interface BetStatsSummary {
  hc: BetStatsSummaryLine;
  overH1: BetStatsSummaryLine;
  underH1: BetStatsSummaryLine;
  over: BetStatsSummaryLine;
  under: BetStatsSummaryLine;
  h2Over: BetStatsSummaryLine;
  h2Under: BetStatsSummaryLine;
}

export interface BetStatsPage {
  rows: BetStatsRow[];
  total: number;
  summary: BetStatsSummary;
}

export interface BetStatsQuery {
  type?: string; // 'all' | '20p' | '16p'
  date?: string; // 'all' | 'YYYY-MM-DD'
  team?: string; // 'all' | display name
  team2?: string; // 'all' | display name — H2H with `team`
  weekday?: string; // 'all' | '1'..'7' (Bangkok ISO weekday)
  limit?: number;
  offset?: number;
}

// Malay-odds payout on a WIN, unit stake 1: m>=0 -> +m ; m<0 -> +1/|m|.
function malayWinPayout(m: number): number {
  return m >= 0 ? m : 1 / Math.abs(m);
}

/**
 * Grade one side of an Asian line at `line` with Malay odds `odds`.
 * `edge` = signed margin vs the line: cover when edge > 0, lose when edge < 0,
 * push when edge === 0. Quarter lines (…25/…75) split into two half-stakes.
 * Returns { result, pnl } where pnl is in units (full stake 1).
 */
function gradeAsian(edge: number, odds: number): { result: BetOutcome; pnl: number } {
  const win = malayWinPayout(odds);
  const gradeHalf = (e: number): number => (e > 0 ? win : e < 0 ? -1 : 0);
  // `edge` already carries the line offset baked in, so the two quarter halves
  // are edge shifted by ±0.25 around the whole/half split point.
  const isQuarter = Math.abs(edge * 2 - Math.round(edge * 2)) > 1e-9;
  let pnl: number;
  if (isQuarter) {
    const lo = Math.floor(edge * 2) / 2;
    const hi = Math.ceil(edge * 2) / 2;
    pnl = 0.5 * gradeHalf(lo) + 0.5 * gradeHalf(hi);
  } else {
    pnl = gradeHalf(edge);
  }
  const result: BetOutcome = pnl > 0 ? 'W' : pnl < 0 ? 'L' : 'D';
  return { result, pnl };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface BetStatsDbRow {
  event_id: number;
  match_time: string | Date;
  match_type: string;
  home_team: string;
  away_team: string;
  h1_home: number;
  h1_away: number;
  tt_home: number;
  tt_away: number;
  weekday: number | string;
  local_date: string;
  hc_line: string | null;
  hc_home_odds: string | null;
  hc_away_odds: string | null;
  hc_home_gives: boolean | null;
  ou_h1_line: string | null;
  ou_h1_over: string | null;
  ou_h1_under: string | null;
  ou_line: string | null;
  ou_over: string | null;
  ou_under: string | null;
  h2_line: string | null;
  h2_over: string | null;
  h2_under: string | null;
}

function gradeRow(r: BetStatsDbRow): BetStatsRow {
  const [dd, mm, yyyy] = r.local_date.split('-').reverse();
  const date = `${dd}/${mm}/${yyyy}`;

  const ttHome = Number(r.tt_home);
  const ttAway = Number(r.tt_away);
  const total = ttHome + ttAway;
  const h1Total = Number(r.h1_home) + Number(r.h1_away);

  // ── Handicap ──
  let hcFav: 'home' | 'away' | null = null;
  let hcLine: number | null = null;
  let hcResult: BetOutcome = null;
  let hcPnl: number | null = null;
  const hcL = num(r.hc_line);
  if (hcL !== null && r.hc_home_gives !== null) {
    hcFav = r.hc_home_gives ? 'home' : 'away';
    hcLine = hcL;
    const favMargin = r.hc_home_gives ? ttHome - ttAway : ttAway - ttHome;
    const odds = num(r.hc_home_gives ? r.hc_home_odds : r.hc_away_odds);
    if (odds !== null) {
      const g = gradeAsian(favMargin - hcLine, odds);
      hcResult = g.result;
      hcPnl = g.pnl;
    }
  }

  // ── First-half Over/Under (graded on H1 goals) ──
  let ouH1Line: number | null = null;
  let overH1Result: BetOutcome = null;
  let overH1Pnl: number | null = null;
  let underH1Result: BetOutcome = null;
  let underH1Pnl: number | null = null;
  const ouH1L = num(r.ou_h1_line);
  if (ouH1L !== null) {
    ouH1Line = ouH1L;
    const overH1 = num(r.ou_h1_over);
    const underH1 = num(r.ou_h1_under);
    if (overH1 !== null) {
      const g = gradeAsian(h1Total - ouH1L, overH1);
      overH1Result = g.result;
      overH1Pnl = g.pnl;
    }
    if (underH1 !== null) {
      const g = gradeAsian(ouH1L - h1Total, underH1);
      underH1Result = g.result;
      underH1Pnl = g.pnl;
    }
  }

  // ── Full-match Over/Under ──
  let ouLine: number | null = null;
  let overResult: BetOutcome = null;
  let overPnl: number | null = null;
  let underResult: BetOutcome = null;
  let underPnl: number | null = null;
  const ouL = num(r.ou_line);
  if (ouL !== null) {
    ouLine = ouL;
    const over = num(r.ou_over);
    const under = num(r.ou_under);
    if (over !== null) {
      const g = gradeAsian(total - ouL, over);
      overResult = g.result;
      overPnl = g.pnl;
    }
    if (under !== null) {
      const g = gradeAsian(ouL - total, under);
      underResult = g.result;
      underPnl = g.pnl;
    }
  }

  // ── Start-of-H2 Over/Under (graded on full-match total) ──
  let h2Line: number | null = null;
  let h2OverOdds: number | null = null;
  let h2UnderOdds: number | null = null;
  let h2OverResult: BetOutcome = null;
  let h2OverPnl: number | null = null;
  let h2UnderResult: BetOutcome = null;
  let h2UnderPnl: number | null = null;
  const h2L = num(r.h2_line);
  if (h2L !== null) {
    h2Line = h2L;
    h2OverOdds = num(r.h2_over);
    h2UnderOdds = num(r.h2_under);
    if (h2OverOdds !== null) {
      const g = gradeAsian(total - h2L, h2OverOdds);
      h2OverResult = g.result;
      h2OverPnl = g.pnl;
    }
    if (h2UnderOdds !== null) {
      const g = gradeAsian(h2L - total, h2UnderOdds);
      h2UnderResult = g.result;
      h2UnderPnl = g.pnl;
    }
  }

  return {
    eventId: Number(r.event_id),
    date,
    weekday: Number(r.weekday),
    matchType: r.match_type as '20p' | '16p',
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    h1Home: Number(r.h1_home),
    h1Away: Number(r.h1_away),
    ttHome,
    ttAway,
    hcFav,
    hcLine,
    hcResult,
    hcPnl,
    ouH1Line,
    overH1Result,
    overH1Pnl,
    underH1Result,
    underH1Pnl,
    ouLine,
    overResult,
    overPnl,
    underResult,
    underPnl,
    h2Line,
    h2OverOdds,
    h2UnderOdds,
    h2OverResult,
    h2OverPnl,
    h2UnderResult,
    h2UnderPnl,
  };
}

const EMPTY_LINE = (): BetStatsSummaryLine => ({
  n: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  winRate: null,
  pnl: 0,
});

function accumulate(line: BetStatsSummaryLine, result: BetOutcome, pnl: number | null) {
  if (result === null || pnl === null) return;
  line.n += 1;
  line.pnl += pnl;
  if (result === 'W') line.wins += 1;
  else if (result === 'L') line.losses += 1;
  else line.pushes += 1;
}

function finalizeLine(line: BetStatsSummaryLine): BetStatsSummaryLine {
  const decided = line.wins + line.losses;
  line.winRate = decided > 0 ? line.wins / decided : null;
  line.pnl = Math.round(line.pnl * 1000) / 1000;
  return line;
}

function summarize(rows: BetStatsRow[]): BetStatsSummary {
  const hc = EMPTY_LINE();
  const overH1 = EMPTY_LINE();
  const underH1 = EMPTY_LINE();
  const over = EMPTY_LINE();
  const under = EMPTY_LINE();
  const h2Over = EMPTY_LINE();
  const h2Under = EMPTY_LINE();
  for (const r of rows) {
    accumulate(hc, r.hcResult, r.hcPnl);
    accumulate(overH1, r.overH1Result, r.overH1Pnl);
    accumulate(underH1, r.underH1Result, r.underH1Pnl);
    accumulate(over, r.overResult, r.overPnl);
    accumulate(under, r.underResult, r.underPnl);
    accumulate(h2Over, r.h2OverResult, r.h2OverPnl);
    accumulate(h2Under, r.h2UnderResult, r.h2UnderPnl);
  }
  return {
    hc: finalizeLine(hc),
    overH1: finalizeLine(overH1),
    underH1: finalizeLine(underH1),
    over: finalizeLine(over),
    under: finalizeLine(under),
    h2Over: finalizeLine(h2Over),
    h2Under: finalizeLine(h2Under),
  };
}

// Bangkok ISO weekday (1=Mon .. 7=Sun).
const WEEKDAY_EXPR = `EXTRACT(ISODOW FROM (mh.match_time + interval '7 hours'))::int`;

/**
 * Filtered page of per-match bet outcomes + a summary over the WHOLE filtered
 * set (not just the current page). Reuses the same team/team2/type/date filter
 * semantics as fetchMatchesPage, plus a Bangkok weekday filter.
 */
export async function fetchBetStatsPage(q: BetStatsQuery): Promise<BetStatsPage> {
  const db = getPool();
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const offset = Math.max(q.offset ?? 0, 0);

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (q.type && q.type !== 'all') {
    params.push(q.type);
    clauses.push(`mh.match_type = $${params.length}`);
  }
  if (q.date && q.date !== 'all') {
    params.push(q.date);
    clauses.push(`${LOCAL_DATE_EXPR} = $${params.length}`);
  }
  if (q.team && q.team !== 'all') {
    params.push(q.team);
    const p = `$${params.length}`;
    clauses.push(`(${HOME_NAME_EXPR} = ${p} OR ${AWAY_NAME_EXPR} = ${p})`);
  }
  if (q.team2 && q.team2 !== 'all') {
    params.push(q.team2);
    const p = `$${params.length}`;
    clauses.push(`(${HOME_NAME_EXPR} = ${p} OR ${AWAY_NAME_EXPR} = ${p})`);
  }
  if (q.weekday && q.weekday !== 'all') {
    params.push(Number(q.weekday));
    clauses.push(`${WEEKDAY_EXPR} = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  // Base CTEs: match each history row to its closest (≤60 min) odds event, then
  // pull pre-match HC/OU (first_seen, period 2 = pre-kickoff) and the first
  // start-of-H2 OU snapshot (period 8).
  const baseCte = `
    WITH first_seen AS (
      SELECT event_id, home_team_id, away_team_id, match_date, MIN(recorded_at) AS fs_at
      FROM match_odds_log
      GROUP BY event_id, home_team_id, away_team_id, match_date
    ),
    ev AS (
      SELECT DISTINCT ON (mh.id)
        mh.id AS mh_id, mh.match_time, mh.match_type,
        ${HOME_NAME_EXPR} AS home_team, ${AWAY_NAME_EXPR} AS away_team,
        mh.h1_home, mh.h1_away, mh.tt_home, mh.tt_away,
        ${WEEKDAY_EXPR} AS weekday, ${LOCAL_DATE_EXPR} AS local_date,
        fs.event_id
      FROM gs_matches_history mh
      LEFT JOIN gs_teams ht ON ht.id = mh.home_team_id
      LEFT JOIN gs_teams at ON at.id = mh.away_team_id
      JOIN first_seen fs
        ON fs.home_team_id = mh.home_team_id
       AND fs.away_team_id = mh.away_team_id
       AND fs.match_date = (mh.match_time + interval '7 hours')::date
       AND abs(extract(epoch FROM (fs.fs_at - mh.match_time))) <= 3600
      ${where}
      ORDER BY mh.id, abs(extract(epoch FROM (fs.fs_at - mh.match_time)))
    ),
    pre AS (
      SELECT DISTINCT ON (event_id)
        event_id, hc_line, hc_home_odds, hc_away_odds, hc_home_gives,
        ou_h1_line, ou_h1_over, ou_h1_under,
        ou_line, ou_over, ou_under
      FROM match_odds_log
      WHERE snapshot_type = 'first_seen' AND period = 2
      ORDER BY event_id, recorded_at
    ),
    h2 AS (
      SELECT DISTINCT ON (event_id)
        event_id, ou_line AS h2_line, ou_over AS h2_over, ou_under AS h2_under
      FROM match_odds_log
      WHERE period = 8 AND ou_line IS NOT NULL
      ORDER BY event_id, recorded_at
    ),
    joined AS (
      SELECT
        ev.event_id, ev.match_time, ev.match_type, ev.home_team, ev.away_team,
        ev.h1_home, ev.h1_away, ev.tt_home, ev.tt_away, ev.weekday, ev.local_date,
        pre.hc_line, pre.hc_home_odds, pre.hc_away_odds, pre.hc_home_gives,
        pre.ou_h1_line, pre.ou_h1_over, pre.ou_h1_under,
        pre.ou_line, pre.ou_over, pre.ou_under,
        h2.h2_line, h2.h2_over, h2.h2_under
      FROM ev
      LEFT JOIN pre ON pre.event_id = ev.event_id
      LEFT JOIN h2 ON h2.event_id = ev.event_id
    )
  `;

  // Summary aggregates over the WHOLE filtered set (grade in JS by pulling every
  // joined row's lines — the set is ≤ ~1.5k rows so this is cheap).
  const allSql = `${baseCte} SELECT * FROM joined ORDER BY match_time DESC`;
  const pageSql = `${baseCte}
    SELECT * FROM joined
    ORDER BY match_time DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

  const [allRes, pageRes] = await Promise.all([
    db.query(allSql, params),
    db.query(pageSql, [...params, limit, offset]),
  ]);

  const allRows = (allRes.rows as BetStatsDbRow[]).map(gradeRow);
  const pageRows = (pageRes.rows as BetStatsDbRow[]).map(gradeRow);

  return {
    rows: pageRows,
    total: allRows.length,
    summary: summarize(allRows),
  };
}

// ── H2H Tài/Xỉu heatmap ─────────────────────────────────────────────────────
//
// Over/Under rate per unordered team pair within one league, so the user can
// see which matchups lean Tài (Over) vs Xỉu (Under). Reuses the exact ±60-min
// nearest-time join as fetchBetStatsPage (1:1, no team+date fan-out). A pair is
// keyed by LEAST/GREATEST of the two display names. Over = total > line, Under =
// total < line (both strict; ties are counted in `n` but excluded from over/
// under). `overPct = over / n` (ties dilute toward neutral).

export interface H2HCell {
  t1: string;
  t2: string;
  n: number;
  over: number;
  under: number;
  overPct: number; // over / n, 0..1
}

export interface H2HLeader {
  t1: string;
  t2: string;
  n: number;
  over: number;
  under: number;
  overPct: number;
  underPct: number; // under / n
}

export interface H2HMatrix {
  teams: string[]; // sorted display names present in ≥1 qualifying pair
  cells: H2HCell[]; // pairs with n >= minN
  leadersTai: H2HLeader[]; // top by overPct
  leadersXiu: H2HLeader[]; // top by underPct
}

const H2H_MIN_N = 5;

/**
 * Over/Under heatmap for a single league (`type` = '20p' | '16p'), on the
 * chosen market ('ft' → full-match total vs ou_line, 'h1' → H1 total vs
 * ou_h1_line). Aggregated per unordered team pair.
 */
export async function fetchH2HMatrix(
  type: '20p' | '16p',
  market: 'ft' | 'h1',
): Promise<H2HMatrix> {
  const db = getPool();

  const totalExpr = market === 'h1' ? '(ev.h1_home + ev.h1_away)' : '(ev.tt_home + ev.tt_away)';
  const lineCol = market === 'h1' ? 'ou_h1_line' : 'ou_line';

  // Base rows: resolved match → (unordered pair, total, line). Then aggregate.
  const sql = `
    WITH first_seen AS (
      SELECT event_id, home_team_id, away_team_id, match_date, MIN(recorded_at) AS fs_at
      FROM match_odds_log
      GROUP BY event_id, home_team_id, away_team_id, match_date
    ),
    ev AS (
      SELECT DISTINCT ON (mh.id)
        mh.id AS mh_id,
        ${HOME_NAME_EXPR} AS home_team, ${AWAY_NAME_EXPR} AS away_team,
        mh.h1_home, mh.h1_away, mh.tt_home, mh.tt_away,
        fs.event_id
      FROM gs_matches_history mh
      LEFT JOIN gs_teams ht ON ht.id = mh.home_team_id
      LEFT JOIN gs_teams at ON at.id = mh.away_team_id
      JOIN first_seen fs
        ON fs.home_team_id = mh.home_team_id
       AND fs.away_team_id = mh.away_team_id
       AND fs.match_date = (mh.match_time + interval '7 hours')::date
       AND abs(extract(epoch FROM (fs.fs_at - mh.match_time))) <= 3600
      WHERE mh.match_type = $1
      ORDER BY mh.id, abs(extract(epoch FROM (fs.fs_at - mh.match_time)))
    ),
    pre AS (
      SELECT DISTINCT ON (event_id) event_id, ${lineCol} AS line
      FROM match_odds_log
      WHERE snapshot_type = 'first_seen' AND period = 2
      ORDER BY event_id, recorded_at
    ),
    graded AS (
      SELECT
        LEAST(ev.home_team, ev.away_team) AS t1,
        GREATEST(ev.home_team, ev.away_team) AS t2,
        ${totalExpr} AS total,
        pre.line::numeric AS line
      FROM ev
      JOIN pre ON pre.event_id = ev.event_id
      WHERE pre.line IS NOT NULL AND pre.line <> ''
    )
    SELECT
      t1, t2,
      COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE total > line)::int AS over_c,
      COUNT(*) FILTER (WHERE total < line)::int AS under_c
    FROM graded
    WHERE t1 IS NOT NULL AND t2 IS NOT NULL AND t1 <> t2
    GROUP BY t1, t2
    HAVING COUNT(*) >= ${H2H_MIN_N}
  `;

  const { rows } = await db.query(sql, [type]);

  const cells: H2HCell[] = rows.map((r: { t1: string; t2: string; n: number; over_c: number; under_c: number }) => ({
    t1: r.t1,
    t2: r.t2,
    n: r.n,
    over: r.over_c,
    under: r.under_c,
    overPct: r.n > 0 ? r.over_c / r.n : 0,
  }));

  const teamSet = new Set<string>();
  for (const c of cells) {
    teamSet.add(c.t1);
    teamSet.add(c.t2);
  }
  const teams = Array.from(teamSet).sort((a, b) => a.localeCompare(b));

  const leaders: H2HLeader[] = cells.map((c) => ({
    t1: c.t1,
    t2: c.t2,
    n: c.n,
    over: c.over,
    under: c.under,
    overPct: c.overPct,
    underPct: c.n > 0 ? c.under / c.n : 0,
  }));

  const leadersTai = [...leaders]
    .sort((a, b) => b.overPct - a.overPct || b.n - a.n)
    .slice(0, 10);
  const leadersXiu = [...leaders]
    .sort((a, b) => b.underPct - a.underPct || b.n - a.n)
    .slice(0, 10);

  return { teams, cells, leadersTai, leadersXiu };
}
