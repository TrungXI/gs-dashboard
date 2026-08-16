import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let singleton: Pool | null = null;
function db(): Pool | null {
  const url = process.env.ANALYSIS_DATABASE_URL;
  if (!url) return null;
  if (!singleton) singleton = new Pool({ connectionString: url, max: 2 });
  return singleton;
}

type OddsRow = {
  match_id: string;
  market: string;
  half: string;
  line: string | null;
  home_price: string | null;
  away_price: string | null;
  draw_price: string | null;
  home_gives: boolean | null;
  suspended: boolean;
};

// Structurally compatible with the GsLiveMatch subset RankingLive's card uses.
export interface SabaLiveMatch {
  matchId: number;
  eventId: number;
  leagueId: number | null;
  sectionId: number | null;
  homeId: number | null;
  awayId: number | null;
  leagueName: string;
  leagueNameVn: string | null;
  leagueGroupId: number | null;
  countryCode: string | null;
  playFormat: string | null;
  pesVersion: string | null;
  matchType: 'saba';
  homeTeam: string;
  awayTeam: string;
  homeTeamRaw: string;
  awayTeamRaw: string;
  mappedHome: boolean;
  mappedAway: boolean;
  h1Home: number;
  h1Away: number;
  minuteElapsed: number | null;
  period: number;
  isH2: boolean;
  isLive: boolean;
  bettingOpen: boolean;
  suspended: boolean;
  homeRed: number;
  awayRed: number;
  goalTeam: string | null;
  penStatus: string | null;
  oddsHome: number | null;
  oddsAway: number | null;
  oddsDraw: number | null;
  malayHome: string | null;
  malayAway: string | null;
  malayDraw: string | null;
  hcLines: { line: string | null; home: string | null; away: string | null; homeGives: boolean; favoriteSide: 'home' | 'away' | null }[];
  hcH1Lines: { line: string | null; home: string | null; away: string | null; homeGives: boolean; favoriteSide: 'home' | 'away' | null }[];
  ouLines: { line: string | null; over: string | null; under: string | null; suspended?: boolean }[];
  ouH1Lines: { line: string | null; over: string | null; under: string | null; suspended?: boolean }[];
  hasStreaming: boolean;
}

export interface SabaLeagueSummary {
  leagueId: number | null;
  leagueName: string;
  leagueGroupId: number | null;
  countryCode: string | null;
  playFormat: string | null;
  count: number;
}

function favoriteSide(homeGives: boolean | null, line: string | null): 'home' | 'away' | null {
  if (homeGives == null || line == null) return null;
  return homeGives ? 'home' : 'away';
}

export async function GET() {
  const pool = db();
  if (!pool) return Response.json({ ok: false, error: 'no db' });
  try {
    // In-play PARENT matches only (exclude prop/corner/booking sub-markets, which
    // carry a non-null parent_id, and exclude scheduled/ended matches, which are
    // NOT in_play). LEFT JOIN team map for canonical names.
    const { rows: matchRows } = await pool.query(`
      SELECT m.match_id, m.home_team, m.away_team, m.league_id, m.section_id,
             m.home_id, m.away_id, m.league_name,
             m.league_name_vn, m.league_group_id, m.country_code,
             m.play_format, m.pes_version,
             m.score_home, m.score_away, m.period, m.minute, m.in_play,
             m.home_red, m.away_red, m.goal_team, m.pen_status, m.has_streaming,
             hm.canonical_name AS home_canon, hm.mapped AS home_mapped,
             am.canonical_name AS away_canon, am.mapped AS away_mapped
      FROM saba_matches m
      LEFT JOIN saba_team_map hm ON hm.saba_name = m.home_team
      LEFT JOIN saba_team_map am ON am.saba_name = m.away_team
      WHERE m.in_play = true AND m.parent_id IS NULL AND m.league_name ILIKE 'SABA%'
      ORDER BY m.league_group_id NULLS LAST, m.league_name NULLS LAST, m.match_id
    `);

    // Latest odds per (match, market, half) for the in-play parent matches.
    const { rows: oddsRows } = await pool.query<OddsRow>(`
      SELECT DISTINCT ON (o.match_id, o.market, o.half)
             o.match_id, o.market, o.half, o.line,
             o.home_price, o.away_price, o.draw_price, o.home_gives, o.suspended
      FROM saba_odds o
      JOIN saba_matches m ON m.match_id = o.match_id AND m.in_play = true AND m.parent_id IS NULL AND m.league_name ILIKE 'SABA%'
      ORDER BY o.match_id, o.market, o.half, o.recorded_at DESC
    `);

    const oddsByMatch = new Map<string, OddsRow[]>();
    for (const r of oddsRows) {
      const arr = oddsByMatch.get(r.match_id) ?? [];
      arr.push(r);
      oddsByMatch.set(r.match_id, arr);
    }

    const matches: SabaLiveMatch[] = matchRows.map((m) => {
      const os = oddsByMatch.get(m.match_id) ?? [];
      const hcFt = os.find((o) => o.market === 'HDP' && o.half === 'FT');
      const hcH1 = os.find((o) => o.market === 'HDP' && o.half === 'H1');
      const ouFt = os.find((o) => o.market === 'OU' && o.half === 'FT');
      const ouH1 = os.find((o) => o.market === 'OU' && o.half === 'H1');
      const x2 = os.find((o) => o.market === '1X2' && o.half === 'FT');

      const homeMapped = m.home_mapped === true;
      const awayMapped = m.away_mapped === true;
      const period = m.period != null ? Number(m.period) : 0;

      return {
        matchId: Number(m.match_id),
        eventId: Number(m.match_id),
        leagueId: m.league_id != null ? Number(m.league_id) : null,
        sectionId: m.section_id != null ? Number(m.section_id) : null,
        homeId: m.home_id != null ? Number(m.home_id) : null,
        awayId: m.away_id != null ? Number(m.away_id) : null,
        leagueName: m.league_name ?? 'C-Sport',
        leagueNameVn: m.league_name_vn ?? null,
        leagueGroupId: m.league_group_id != null ? Number(m.league_group_id) : null,
        countryCode: m.country_code ?? null,
        playFormat: m.play_format ?? null,
        pesVersion: m.pes_version ?? null,
        matchType: 'saba',
        homeTeam: (homeMapped && m.home_canon) ? m.home_canon : m.home_team,
        awayTeam: (awayMapped && m.away_canon) ? m.away_canon : m.away_team,
        homeTeamRaw: m.home_team,
        awayTeamRaw: m.away_team,
        mappedHome: homeMapped,
        mappedAway: awayMapped,
        h1Home: Number(m.score_home ?? 0),
        h1Away: Number(m.score_away ?? 0),
        minuteElapsed: m.minute != null ? Number(m.minute) : null,
        period,
        isH2: period >= 2,
        isLive: m.in_play === true,
        bettingOpen: !(hcFt?.suspended ?? false),
        suspended: hcFt?.suspended ?? false,
        homeRed: Number(m.home_red ?? 0),
        awayRed: Number(m.away_red ?? 0),
        goalTeam: m.goal_team ?? null,
        penStatus: m.pen_status ?? null,
        oddsHome: null,
        oddsAway: null,
        oddsDraw: null,
        malayHome: x2?.home_price ?? null,
        malayAway: x2?.away_price ?? null,
        malayDraw: x2?.draw_price ?? null,
        hcLines: hcFt
          ? [{ line: hcFt.line, home: hcFt.home_price, away: hcFt.away_price, homeGives: hcFt.home_gives ?? false, favoriteSide: favoriteSide(hcFt.home_gives, hcFt.line) }]
          : [],
        hcH1Lines: hcH1
          ? [{ line: hcH1.line, home: hcH1.home_price, away: hcH1.away_price, homeGives: hcH1.home_gives ?? false, favoriteSide: favoriteSide(hcH1.home_gives, hcH1.line) }]
          : [],
        ouLines: ouFt
          ? [{ line: ouFt.line, over: ouFt.home_price, under: ouFt.away_price, suspended: ouFt.suspended }]
          : [],
        ouH1Lines: ouH1
          ? [{ line: ouH1.line, over: ouH1.home_price, under: ouH1.away_price, suspended: ouH1.suspended }]
          : [],
        hasStreaming: m.has_streaming === true,
      };
    });

    // League section index / filter summary (live matches only).
    const leagueMap = new Map<string, SabaLeagueSummary>();
    for (const m of matches) {
      const key = `${m.leagueGroupId}|${m.leagueName}`;
      const cur = leagueMap.get(key);
      if (cur) cur.count += 1;
      else leagueMap.set(key, {
        leagueId: m.leagueId,
        leagueName: m.leagueName,
        leagueGroupId: m.leagueGroupId,
        countryCode: m.countryCode,
        playFormat: m.playFormat,
        count: 1,
      });
    }
    const leagues = [...leagueMap.values()];

    return Response.json({ ok: true, matches, leagues });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) });
  }
}
