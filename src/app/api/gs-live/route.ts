import { NextRequest, NextResponse } from 'next/server';

// Vietnamese → English team name normalization
// Live API sometimes sends Vietnamese names OR alternate English spellings; DB stores canonical English
const VN_TO_EN: Record<string, string> = {
  // Vietnamese names
  'Nhật Bản': 'Japan',
  'Hàn Quốc': 'Korea Republic',
  'Trung Quốc': 'China',
  'Thái Lan': 'Thailand',
  'Việt Nam': 'Vietnam',
  'Nga': 'Russia',
  'Đức': 'Germany',
  'Pháp': 'France',
  'Tây Ban Nha': 'Spain',
  'Bồ Đào Nha': 'Portugal',
  'Hà Lan': 'Netherlands',
  'Bỉ': 'Belgium',
  'Thụy Sĩ': 'Switzerland(CHE)',
  'Thụy Điển': 'Sweden',
  'Na Uy': 'Norway',
  'Áo': 'Austria',
  'Ý': 'Italy',
  'Anh': 'England',
  'Maroc': 'Morocco',
  'Mỹ': 'USA',
  'Ả Rập Xê Út': 'Saudi Arabia',
  'Úc': 'Australia',
  'Ấn Độ': 'India',
  'Campuchia': 'Cambodia',
  'Lào': 'Laos',
  // English alternate spellings (live API with lng=en may differ from DB canonical)
  'Viet Nam': 'Vietnam',
  'South Korea': 'Korea Republic',
  'Republic of Korea': 'Korea Republic',
  'DPR Korea': 'North Korea',
  'Korea DPR': 'North Korea',
  'New Zealand': 'New Zealand', // already correct, explicit for clarity
};

function normalizeTeam(name: string): string {
  const m = name.trim().match(/^(.+?)(\s+\([VS]\))?$/);
  if (!m) return name.trim();
  const base = m[1].trim();
  const suffix = m[2]?.trim() ? ` ${m[2].trim()}` : '';
  return ((VN_TO_EN[base] ?? base) + suffix).trim();
}

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
  totalMsElapsed: number | null; // raw ms elapsed in current period (used by frontend for realtime interpolation)
  bettingOpen: boolean;
  period: number;          // ev['10']: 2=H1, 4=Halftime, 8=H2
  isH2: boolean;           // true = second half underway (ev['10']===8)
  suspended: boolean;     // true = market locked, show --- for all odds
  isLive: boolean;
  // 1X2 odds (decimal). null when the market is unavailable.
  oddsHome: number | null;
  oddsAway: number | null;
  oddsDraw: number | null;
  // Malay-format odds strings (e.g. "-4.76", "+9.00"). null when unavailable.
  malayHome: string | null;
  malayAway: string | null;
  malayDraw: string | null;
  // Kèo Chấp (Asian Handicap) — market '5' TT, '15' H1. 2 lines. Values in Malay format.
  // homeGives=true → home team gives handicap (line shown in home row); false → away gives.
  hcLines: { line: string | null; home: string | null; away: string | null; homeGives: boolean }[];
  hcH1Lines: { line: string | null; home: string | null; away: string | null; homeGives: boolean }[];
  // Tài Xỉu (Over/Under) — market '3' TT, '13' H1. 2 lines. Values in Malay format.
  ouLines: { line: string | null; over: string | null; under: string | null }[];
  ouH1Lines: { line: string | null; over: string | null; under: string | null }[];
  // Cards & corners from score object: '7'=yellow home, '8'=yellow away, '2'=red home, '3'=red away
  yellowHome: number;
  yellowAway: number;
  redHome: number;
  redAway: number;
  cornersHome: number;
  cornersAway: number;
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
 * Parse one entry from an Asian market (HC or O/U).
 * Entry format: "LINE VAL*SELIDh VAL*SELIDa INDICATOR ..."
 * INDICATOR is a standalone 'h' or 'a' token (no '*') that encodes which team gives handicap.
 * Values are already in Malay format.
 * LINE can look like "0", "0.25", "0-0.5", "2.5", "2.5-3".
 */
function parseAsianEntry(raw: string): {
  line: string | null; h: string | null; a: string | null; suspended: boolean; indicator: 'h' | 'a' | null;
} {
  const tokens = raw.trim().split(/\s+/);
  let line: string | null = null;
  let h: string | null = null;
  let a: string | null = null;
  let indicator: 'h' | 'a' | null = null;
  // Last token '1' = market suspended/locked by bookmaker
  const suspended = tokens[tokens.length - 1] === '1';

  for (const token of tokens) {
    if (token.includes('*')) {
      const starIdx = token.indexOf('*');
      const val = token.slice(0, starIdx);
      const sel = token.slice(starIdx + 1);
      const side = sel.slice(-1);
      if (side === 'h' && h == null) h = val;
      else if (side === 'a' && a == null) a = val;
    } else if (token === 'h' || token === 'a') {
      // Standalone 'h'/'a' = which team gives handicap
      if (indicator == null) indicator = token as 'h' | 'a';
    } else if (line == null && /^-?[\d.]+([-][\d.]+)?$/.test(token)) {
      line = token;
    }
  }
  return { line, h, a, suspended, indicator };
}

/** Parse up to 2 lines from an Asian market (HC or O/U) by market key. */
function parseAsianMarket(
  market7: unknown,
  key: string,
): { line: string | null; home: string | null; away: string | null; suspended: boolean; homeGives: boolean }[] {
  if (!market7 || typeof market7 !== 'object') return [];
  const raw = (market7 as Record<string, unknown>)[key];
  if (raw == null) return [];

  const entries = Array.isArray(raw) ? (raw as unknown[]).map(String) : [String(raw)];
  return entries.slice(0, 2).map((e) => {
    const { line, h, a, suspended, indicator } = parseAsianEntry(e);
    // indicator 'h' = home gives, 'a' = away gives. Fall back to positive-line = home gives.
    const homeGives = indicator != null ? indicator === 'h' : (line == null || parseFloat(line) >= 0);
    return { line, home: h, away: a, suspended, homeGives };
  });
}

function buildMatch(
  leagueId: number,
  leagueName: string,
  ev: Record<string, unknown>,
): GsLiveMatch {
  const score = (ev['4'] as Record<string, number>) ?? {};
  const yellowHome = score['7'] ?? 0;
  const yellowAway = score['8'] ?? 0;
  // score['2'] = red cards home, score['3'] = red cards away (verified live vs user observation)
  const redHome = score['2'] ?? 0;
  const redAway = score['3'] ?? 0;
  const cornersHome = score['5'] ?? 0;
  const cornersAway = score['6'] ?? 0;
  const odds = parse1x2(ev['7']);
  const hcRaw = parseAsianMarket(ev['7'], '5');
  const ouRaw = parseAsianMarket(ev['7'], '3');
  // H1 market keys: '6' = HC H1, '4' = OU H1 (different from pre-match keys '15'/'13')
  const hcH1Raw = parseAsianMarket(ev['7'], '6');
  const ouH1Raw = parseAsianMarket(ev['7'], '4');
  const suspended = hcRaw.length > 0 ? hcRaw[0].suspended : false;

  // ev['6'] = elapsed virtual game clock in ms, resets to 0 at each half start.
  // ceil(ev[6] / 60000) = current virtual minute within the half.
  const ev6ms = typeof ev['6'] === 'number' ? (ev['6'] as number) : null;
  const minuteElapsed = ev6ms !== null ? Math.ceil(ev6ms / 60000) : null;

  // ev['10'] encodes the current period: 2 = H1 live, 8 = H2 live.
  // ev['15'] is NOT reliable for H2 detection (observed to stay false even in H2).
  const isH2 = ev['10'] === 8;

  return {
    leagueId,
    leagueName,
    matchType: MATCH_TYPE[leagueId] ?? '16p',
    eventId: ev['8'] as number,
    startTime: ev['0'] as string,
    homeTeam: normalizeTeam(ev['2'] as string),
    awayTeam: normalizeTeam(ev['3'] as string),
    h1Home: score['0'] ?? 0,
    h1Away: score['1'] ?? 0,
    minuteElapsed,
    secondsElapsed: ev6ms !== null ? Math.floor(ev6ms / 1000) % 60 : null,
    totalMsElapsed: ev6ms,
    bettingOpen: ev['11'] !== true,
    period: typeof ev['10'] === 'number' ? (ev['10'] as number) : 0,
    isH2,
    suspended,
    isLive: ev['1'] === true,
    oddsHome: odds.home,
    oddsAway: odds.away,
    oddsDraw: odds.draw,
    malayHome: odds.home != null ? decToMalay(odds.home) : null,
    malayAway: odds.away != null ? decToMalay(odds.away) : null,
    malayDraw: odds.draw != null ? decToMalay(odds.draw) : null,
    hcLines: hcRaw.map(({ line, home, away, homeGives }) => ({ line, home, away, homeGives })),
    hcH1Lines: hcH1Raw.map(({ line, home, away, homeGives }) => ({ line, home, away, homeGives })),
    ouLines: ouRaw.map((r) => ({ line: r.line, over: r.home, under: r.away })),
    ouH1Lines: ouH1Raw.map((r) => ({ line: r.line, over: r.home, under: r.away })),
    yellowHome,
    yellowAway,
    redHome,
    redAway,
    cornersHome,
    cornersAway,
  };
}

export async function GET(req: NextRequest) {
  // Token lấy từ env (NEXT_PUBLIC_GS_TOKEN) — không nhập tay nữa; vẫn nhận ?token= để override khi cần.
  const token = process.env.NEXT_PUBLIC_GS_TOKEN || req.nextUrl.searchParams.get('token') || '';

  try {
    const res = await fetch(
      'https://be.sb21.net/api/v2/getEvent?sportType=3_1&timezoneOffset=-420',
      { headers: { token, accept: 'application/json', lng: 'en' }, cache: 'no-store' }
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
