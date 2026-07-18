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
