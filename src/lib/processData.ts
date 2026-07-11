import rawData from '../gs-raw-all.json';
import type { Match } from '../types/match';

function toVnTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() + 7);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  let hh = d.getUTCHours();
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  return {
    date: `${dd}/${mm}/${yyyy}`,
    time: `${dd}/${mm}/${yyyy} ${String(hh).padStart(2, '0')}:${min} ${ampm}`,
  };
}

function apiToRow(m: Record<string, unknown>): Match {
  const { date, time } = toVnTime(m['0'] as string);
  const league = m['1'] as string;
  const matchType = league.includes('20 minutes') ? '20p' : '16p';
  return {
    date,
    time,
    matchType,
    league,
    homeTeam: m['2'] as string,
    awayTeam: m['3'] as string,
    h1Home: String(m['4']),
    h1Away: String(m['5']),
    ttHome: String(m['6']),
    ttAway: String(m['7']),
  };
}

// Cached — only processed once at build/startup
const raw = rawData as unknown as Record<string, Record<string, unknown>[]>;
export const ALL_MATCHES: Match[] = [
  ...raw.matches11.map(apiToRow),
  ...raw.matches10.map(apiToRow),
  ...raw.matches09.map(apiToRow),
  ...raw.matches08.map(apiToRow),
  ...raw.matches07.map(apiToRow),
  ...raw.matches06.map(apiToRow),
  ...raw.matches05.map(apiToRow),
];
