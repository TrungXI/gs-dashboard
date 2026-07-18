import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { DAY_LABELS, type DayStats, type DayOfWeek } from '../../../lib/dayStats';

export type { DayStats };

export const dynamic = 'force-dynamic';

// Cap the raw match list shipped to the client. The UI only ever renders the
// last-100 per team (FormList) plus the H2H subset, so 400 combined newest rows
// across both teams is comfortably enough — everything past that only fed
// aggregates, which are now computed server-side below.
const RAW_MATCH_LIMIT = 400;

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL });
  return pool;
}

// Vietnamese/alternate → canonical English (same map as match-analysis)
const VN_TO_EN: Record<string, string> = {
  'Nhật Bản': 'Japan', 'Hàn Quốc': 'Korea Republic', 'Trung Quốc': 'China',
  'Thái Lan': 'Thailand', 'Việt Nam': 'Vietnam', 'Ả Rập Xê Út': 'Saudi Arabia',
  'Ả Rập Saudi': 'Saudi Arabia', 'Úc': 'Australia', 'Ấn Độ': 'India',
  'Campuchia': 'Cambodia', 'Lào': 'Laos', 'Nga': 'Russia', 'Đức': 'Germany',
  'Pháp': 'France', 'Tây Ban Nha': 'Spain', 'Bồ Đào Nha': 'Portugal',
  'Hà Lan': 'Netherlands', 'Bỉ': 'Belgium', 'Thụy Sĩ': 'Switzerland(CHE)',
  'Thụy Điển': 'Sweden', 'Na Uy': 'Norway', 'Áo': 'Austria', 'Ý': 'Italy',
  'Anh': 'England', 'Maroc': 'Morocco', 'Mỹ': 'USA',
  'Viet Nam': 'Vietnam', 'South Korea': 'Korea Republic',
  'Republic of Korea': 'Korea Republic', 'DPR Korea': 'North Korea',
  'Korea DPR': 'North Korea', 'IR Iran': 'Iran', 'Islamic Republic of Iran': 'Iran',
  'Brunei Darussalam': 'Brunei',
};

/** Resolve raw team name (may be Vietnamese or alternate English) → gs_teams.id */
async function resolveTeamId(db: Pool, name: string): Promise<number | null> {
  const m = name.trim().match(/^(.+?)\s+\(([VS])\)$/);
  if (!m) return null;
  const raw = m[1].trim();
  const base = VN_TO_EN[raw] ?? raw;
  const type = m[2];
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM gs_teams WHERE name = $1 AND type = $2',
    [base, type],
  );
  return rows[0]?.id ?? null;
}

interface Match {
  date: string;
  time: string;
  matchType: '20p' | '16p';
  league: string;
  homeTeam: string;
  awayTeam: string;
  h1Home: string;
  h1Away: string;
  ttHome: string;
  ttAway: string;
}

/** Per-team form + hold aggregates, computed over every match involving `team`. */
export interface FormAgg {
  n: number;
  W: number;
  D: number;
  L: number;
  avgGoals: number;    // TT goals scored / n, rounded to 1 decimal
  avgConceded: number; // TT goals conceded / n, rounded to 1 decimal
  holdW: number;       // matches led at H1 AND won full-time
  holdTotal: number;   // matches led at H1
  dayStats: DayStats[]; // 7 entries, index === weekday (0..6, Sun..Sat)
}

export interface H2HAgg {
  n: number;
  homeW: number; // wins for the `home` param team
  draws: number;
  awayW: number; // wins for the `away` param team
}

export interface TeamAnalysisAgg {
  home: FormAgg;
  away: FormAgg;
  h2h: H2HAgg;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Weekday 0..6 (Sun..Sat) from a DD/MM/YYYY date string. */
function weekdayOf(date: string): number {
  const [d, mo, y] = date.split('/');
  return new Date(`${y}-${mo}-${d}`).getDay();
}

/** Form + hold + day-of-week aggregate over `team`'s matches. */
function formAgg(matches: Match[], team: string): FormAgg {
  const list = matches.filter((m) => m.homeTeam === team || m.awayTeam === team);

  let W = 0, D = 0, L = 0, goals = 0, conceded = 0, holdW = 0, holdTotal = 0;

  const buckets: DayStats[] = DAY_LABELS.map((label, day) => ({
    day: day as DayOfWeek, label, n: 0, wins: 0, draws: 0, losses: 0, winRate: 0,
    h2Wins: 0, h2WinRate: 0, goalsFor: 0, goalsAgainst: 0, avgGF: 0, avgGA: 0,
  }));

  for (const m of list) {
    const isHome = m.homeTeam === team;
    const my = +(isHome ? m.ttHome : m.ttAway);
    const op = +(isHome ? m.ttAway : m.ttHome);
    const myH1 = +(isHome ? m.h1Home : m.h1Away);
    const opH1 = +(isHome ? m.h1Away : m.h1Home);

    goals += my;
    conceded += op;
    if (my > op) W++;
    else if (my === op) D++;
    else L++;

    // Hold rate: led at H1, and how often that lead was converted to a FT win.
    if (myH1 > opH1) {
      holdTotal++;
      if (my > op) holdW++;
    }

    // Day-of-week bucket
    const b = buckets[weekdayOf(m.date)];
    const myH2 = my - myH1;
    const opH2 = op - opH1;
    b.n++;
    b.goalsFor += my;
    b.goalsAgainst += op;
    if (my > op) b.wins++;
    else if (my === op) b.draws++;
    else b.losses++;
    if (myH2 > opH2) b.h2Wins++;
  }

  for (const b of buckets) {
    if (b.n) {
      b.winRate = Math.round((b.wins / b.n) * 100);
      b.h2WinRate = Math.round((b.h2Wins / b.n) * 100);
      b.avgGF = round1(b.goalsFor / b.n);
      b.avgGA = round1(b.goalsAgainst / b.n);
    }
  }

  const n = list.length;
  return {
    n, W, D, L,
    avgGoals: n ? round1(goals / n) : 0,
    avgConceded: n ? round1(conceded / n) : 0,
    holdW, holdTotal,
    dayStats: buckets,
  };
}

/** Head-to-head record between the two param teams, FT scores. */
function h2hAgg(matches: Match[], homeName: string, awayName: string): H2HAgg {
  const list = matches.filter((m) =>
    (m.homeTeam === homeName && m.awayTeam === awayName) ||
    (m.homeTeam === awayName && m.awayTeam === homeName),
  );
  let homeW = 0, draws = 0, awayW = 0;
  for (const m of list) {
    const hs = +m.ttHome;
    const as = +m.ttAway;
    if (hs === as) { draws++; continue; }
    const winner = hs > as ? m.homeTeam : m.awayTeam;
    if (winner === homeName) homeW++;
    else awayW++;
  }
  return { n: list.length, homeW, draws, awayW };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const home = searchParams.get('home') ?? '';
  const away = searchParams.get('away') ?? '';
  if (!home || !away)
    return NextResponse.json({ ok: false, error: 'missing params' }, { status: 400 });

  try {
    const db = getPool();

    // Resolve both teams to IDs — query by ID, no string matching
    const [homeId, awayId] = await Promise.all([
      resolveTeamId(db, home),
      resolveTeamId(db, away),
    ]);

    if (!homeId || !awayId) {
      const missing = [!homeId && home, !awayId && away].filter(Boolean).join(', ');
      return NextResponse.json({ ok: false, error: `Team not found: ${missing}` }, { status: 404 });
    }

    // Fetch all matches involving either team (newest first)
    const { rows } = await db.query(
      `SELECT match_time, match_type, league,
              ht.name || ' (' || ht.type || ')' AS home_team,
              at.name || ' (' || at.type || ')' AS away_team,
              h1_home, h1_away, tt_home, tt_away
       FROM gs_matches_history mh
       JOIN gs_teams ht ON ht.id = mh.home_team_id
       JOIN gs_teams at ON at.id = mh.away_team_id
       WHERE mh.home_team_id = $1 OR mh.away_team_id = $1
          OR mh.home_team_id = $2 OR mh.away_team_id = $2
       ORDER BY match_time DESC`,
      [homeId, awayId],
    );

    const matches: Match[] = rows.map((r) => {
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
        league: r.league as string,
        homeTeam: r.home_team as string,
        awayTeam: r.away_team as string,
        h1Home: String(r.h1_home),
        h1Away: String(r.h1_away),
        ttHome: String(r.tt_home),
        ttAway: String(r.tt_away),
      };
    });

    // Compute aggregates over the FULL result set (before capping the raw list).
    // `home`/`away` params are already in canonical "Name (V|S)" display form —
    // the same form the JOIN emits — so they match m.homeTeam / m.awayTeam.
    const aggregates = {
      home: formAgg(matches, home),
      away: formAgg(matches, away),
      h2h: h2hAgg(matches, home, away),
    };

    // Only ship a bounded raw list; the client renders at most the last 100
    // per team. Aggregates above already used every row.
    const cappedMatches = matches.slice(0, RAW_MATCH_LIMIT);

    return NextResponse.json({ ok: true, matches: cappedMatches, aggregates });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
