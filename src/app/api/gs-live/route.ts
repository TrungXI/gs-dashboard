import { NextRequest, NextResponse } from 'next/server';

const GS_LEAGUE_IDS = new Set([2140, 2125]); // 16p and 20p virtual leagues

export interface GsLiveMatch {
  leagueId: number;
  leagueName: string;
  matchType: '16p' | '20p';
  eventId: number;
  startTime: string;      // ISO
  homeTeam: string;
  awayTeam: string;
  h1Home: number;
  h1Away: number;
  minuteElapsed: number | null;
  bettingOpen: boolean;   // false = H2 underway / locked
  isLive: boolean;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '69-6aed7dc417eb4882d88c6899ae3c0ae1';

  try {
    const res = await fetch(
      'https://be.sb21.net/api/v2/getEvent?sportType=3_1&timezoneOffset=-420',
      { headers: { token, accept: 'application/json', lng: 'vi' }, cache: 'no-store' }
    );
    if (!res.ok) return NextResponse.json({ ok: false, error: `upstream ${res.status}` }, { status: 502 });

    const data = await res.json() as unknown[][];
    const liveSection: unknown[] = Array.isArray(data[0]) ? data[0] : [];

    const matches: GsLiveMatch[] = [];
    for (const league of liveSection) {
      const l = league as Record<string, unknown>;
      const leagueId = l['0'] as number;
      if (!GS_LEAGUE_IDS.has(leagueId)) continue;
      const leagueName = l['1'] as string;
      const matchType: '16p' | '20p' = leagueId === 2125 ? '20p' : '16p';
      const events = (l['2'] as Record<string, unknown>[]) ?? [];
      for (const ev of events) {
        const score = (ev['4'] as Record<string, number>) ?? {};
        matches.push({
          leagueId,
          leagueName,
          matchType,
          eventId: ev['8'] as number,
          startTime: ev['0'] as string,
          homeTeam: ev['2'] as string,
          awayTeam: ev['3'] as string,
          h1Home: score['0'] ?? 0,
          h1Away: score['1'] ?? 0,
          minuteElapsed: typeof ev['5'] === 'number' ? ev['5'] : null,
          bettingOpen: ev['11'] !== true,
          isLive: ev['1'] === true,
        });
      }
    }

    return NextResponse.json({ ok: true, matches });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
