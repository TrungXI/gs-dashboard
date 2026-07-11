import type { Match } from '../types/match';

export function toVnTime(iso: string): { date: string; time: string } {
  const ms = new Date(iso).getTime() + 7 * 60 * 60 * 1000;
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    date: `${dd}/${mm}/${yyyy}`,
    // "DD/MM/YYYY HH:MM" — 24-hour, lexicographic sort works within same month/year
    time: `${dd}/${mm}/${yyyy} ${hh}:${min}`,
  };
}

const renameTeam = (name: string): string =>
  name.replace(/ \(V\)$/, ' (20)').replace(/ \(S\)$/, ' (16)');

export function apiToRow(m: Record<string, unknown>): Match {
  const { date, time } = toVnTime(m['0'] as string);
  const league = m['1'] as string;
  const matchType = league.includes('20 minutes') ? '20p' : '16p';
  return {
    date,
    time,
    matchType,
    league,
    homeTeam: renameTeam(m['2'] as string),
    awayTeam: renameTeam(m['3'] as string),
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
  // time is "DD/MM/YYYY HH:MM" — must parse as timestamp, not localeCompare
  // (e.g. "11/07/2026" < "30/06/2026" lexicographically but July > June)
  const parseTime = (t: string): number => {
    const [datePart, timePart = '00:00'] = t.split(' ');
    const [d, mo, y] = datePart.split('/');
    const [h, min] = timePart.split(':');
    return Date.UTC(+y, +mo - 1, +d, +h, +min);
  };
  return [...matches].sort((a, b) => parseTime(b.time) - parseTime(a.time));
}
