import { NextRequest, NextResponse } from 'next/server';

// 2140 = GS Ảo 16p, 2125 = GS Ảo 20p
const GS_LEAGUE_IDS = new Set([2140, 2125]);

type MatchType = '16p' | '20p' | '8p' | '12p';

const MATCH_TYPE: Record<number, MatchType> = {
  2140: '16p',
  2125: '20p',
};

export interface GsLiveMatch {
  leagueId: number;
  leagueName: string;
  matchType: MatchType;
  eventId: number;
  startTime: string;      // ISO
  homeTeam: string;
  awayTeam: string;
  h1Home: number;
  h1Away: number;
  minuteElapsed: number | null;
  secondsElapsed: number | null; // e-sports: ms elapsed in current period → seconds
  bettingOpen: boolean;   // false = H2 underway / locked
  isLive: boolean;
  // 1X2 odds (decimal). null when the market is unavailable.
  oddsHome: number | null;
  oddsAway: number | null;
  oddsDraw: number | null;
  // Malay-format odds strings (e.g. "-4.76", "+9.00"). null when unavailable.
  malayHome: string | null;
  malayAway: string | null;
  malayDraw: string | null;
  // Kèo Chấp (Asian Handicap) — market '5'. Values already in Malay format.
  hcLine: string | null;       // e.g. "0.25", "0.5"
  hcHome: string | null;       // Malay e.g. "0.82"
  hcAway: string | null;       // Malay e.g. "0.89"
  // Tài Xỉu (Over/Under) — market '3'. Values already in Malay format.
  ouLine: string | null;       // e.g. "2.25"
  ouOver: string | null;       // Malay e.g. "0.87"
  ouUnder: string | null;      // Malay e.g. "0.83"
}

/** Decimal → Malay odds string. Positive = "stake 1 to win N"; negative = "stake N to win 1". */
function decToMalay(dec: number): string {
  if (dec >= 2.0) return `+${(dec - 1).toFixed(2)}`;
  return (-(1 / (dec - 1))).toFixed(2); // negative means "stake this to win 1"
}

/**
 * Parse the 1X2 market from ev['7']['1'].
 * Each entry looks like "1.47*SELECTION_IDh 6.0*SELECTION_IDa 3.7*SELECTION_IDd ..."
 * — split by space, then by '*' to get [decimalOdds, selectionId+suffix].
 * The trailing char of the selection id encodes the side: h = home, a = away, d = draw.
 */
function parse1x2(
  market7: unknown,
): { home: number | null; away: number | null; draw: number | null } {
  const empty = { home: null, away: null, draw: null };
  if (!market7 || typeof market7 !== 'object') return empty;
  const m = (market7 as Record<string, unknown>)['1'];
  if (m == null) return empty;

  // The market may be a single string or an array of strings.
  const entries: string[] = Array.isArray(m)
    ? (m as unknown[]).map(String)
    : String(m).split(/\s+/);

  const out: { home: number | null; away: number | null; draw: number | null } = { ...empty };
  for (const raw of entries) {
    for (const token of raw.trim().split(/\s+/)) {
      const [oddsStr, sel] = token.split('*');
      if (!oddsStr || !sel) continue;
      const dec = Number(oddsStr);
      if (!Number.isFinite(dec)) continue;
      const side = sel.slice(-1);
      if (side === 'h' && out.home == null) out.home = dec;
      else if (side === 'a' && out.away == null) out.away = dec;
      else if (side === 'd' && out.draw == null) out.draw = dec;
    }
  }
  return out;
}

/**
 * Parse markets '3' (Tài Xỉu) and '5' (Kèo Chấp).
 * Entry format: "LINE VAL*SELIDh VAL*SELIDa ..."
 * Values are already in Malay format (no conversion needed).
 */
function parseAsianMarket(
  market7: unknown,
  key: '3' | '5',
): { line: string | null; home: string | null; away: string | null } {
  const empty = { line: null, home: null, away: null };
  if (!market7 || typeof market7 !== 'object') return empty;
  const raw = (market7 as Record<string, unknown>)[key];
  if (raw == null) return empty;

  const entries = Array.isArray(raw) ? (raw as unknown[]).map(String) : [String(raw)];
  // Use the first entry (primary line)
  const first = entries[0]?.trim();
  if (!first) return empty;

  const tokens = first.split(/\s+/);
  let line: string | null = null;
  let home: string | null = null;
  let away: string | null = null;

  for (const token of tokens) {
    if (token.includes('*')) {
      const [val, sel] = token.split('*');
      if (!val || !sel) continue;
      const side = sel.slice(-1);
      if (side === 'h' && home == null) home = val;
      else if (side === 'a' && away == null) away = val;
    } else if (line == null && /^-?[\d.]+$/.test(token)) {
      line = token;
    }
  }
  return { line, home, away };
}

function buildMatch(
  leagueId: number,
  leagueName: string,
  ev: Record<string, unknown>,
): GsLiveMatch {
  const score = (ev['4'] as Record<string, number>) ?? {};
  const odds = parse1x2(ev['7']);
  const hc = parseAsianMarket(ev['7'], '5');
  const ou = parseAsianMarket(ev['7'], '3');
  const isEsports = leagueId === 1203 || leagueId === 1204;

  return {
    leagueId,
    leagueName,
    matchType: MATCH_TYPE[leagueId] ?? '16p',
    eventId: ev['8'] as number,
    startTime: ev['0'] as string,
    homeTeam: ev['2'] as string,
    awayTeam: ev['3'] as string,
    h1Home: score['0'] ?? 0,
    h1Away: score['1'] ?? 0,
    minuteElapsed: typeof ev['5'] === 'number' ? ev['5'] : null,
    secondsElapsed:
      isEsports && typeof ev['6'] === 'number' ? Math.floor((ev['6'] as number) / 1000) : null,
    bettingOpen: ev['11'] !== true,
    isLive: ev['1'] === true,
    oddsHome: odds.home,
    oddsAway: odds.away,
    oddsDraw: odds.draw,
    malayHome: odds.home != null ? decToMalay(odds.home) : null,
    malayAway: odds.away != null ? decToMalay(odds.away) : null,
    malayDraw: odds.draw != null ? decToMalay(odds.draw) : null,
    hcLine: hc.line,
    hcHome: hc.home,
    hcAway: hc.away,
    ouLine: ou.line,
    ouOver: ou.home,
    ouUnder: ou.away,
  };
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '69-6aed7dc417eb4882d88c6899ae3c0ae1';

  try {
    const res = await fetch(
      'https://be.sb21.net/api/v2/getEvent?sportType=3_1&timezoneOffset=-420',
      { headers: { token, accept: 'application/json', lng: 'vi' }, cache: 'no-store' }
    );
    if (!res.ok) return NextResponse.json({ ok: false, error: `upstream ${res.status}` }, { status: 502 });

    const json = (await res.json()) as unknown;
    const matches: GsLiveMatch[] = [];

    // Old GS Ảo format: { data: { "2140": [...events...], "2125": [...] } }
    const asObj = json as Record<string, unknown>;
    if (asObj && typeof asObj === 'object' && !Array.isArray(json) && asObj.data) {
      const data = asObj.data as Record<string, unknown>;
      for (const [key, list] of Object.entries(data)) {
        const leagueId = Number(key);
        if (!GS_LEAGUE_IDS.has(leagueId)) continue;
        const events = (list as Record<string, unknown>[]) ?? [];
        for (const ev of events) {
          const leagueName = (ev['1'] as string) ?? MATCH_TYPE[leagueId] ?? String(leagueId);
          matches.push(buildMatch(leagueId, leagueName, ev));
        }
      }
    } else {
      // New list format: [[{league_dict}, ...], [...]] where league_dict['2'] is the events array.
      const arr = json as unknown[][];
      const liveSection: unknown[] = Array.isArray(arr[0]) ? arr[0] : [];
      for (const league of liveSection) {
        const l = league as Record<string, unknown>;
        const leagueId = l['0'] as number;
        if (!GS_LEAGUE_IDS.has(leagueId)) continue;
        const leagueName = l['1'] as string;
        const events = (l['2'] as Record<string, unknown>[]) ?? [];
        for (const ev of events) {
          matches.push(buildMatch(leagueId, leagueName, ev));
        }
      }
    }

    return NextResponse.json({ ok: true, matches });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
