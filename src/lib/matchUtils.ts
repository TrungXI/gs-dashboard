import type { Match } from '../types/match';

export function toVnTime(iso: string): { date: string; time: string } {
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

export function apiToRow(m: Record<string, unknown>): Match {
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

/** YYYY-MM-DD → DD/MM/YYYY */
export function apiDateToDisplay(d: string): string {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

/** Sort matches newest first */
export function sortMatchesDesc(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => b.time.localeCompare(a.time));
}
