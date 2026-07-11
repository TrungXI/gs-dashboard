import type { Match } from '../types/match';
import { h2Score } from './h2Stats';

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // JS Date.getDay(): 0=Sun … 6=Sat

export const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const; // index = getDay()
export const DAY_LABELS_FULL = [
  'Chủ Nhật',
  'Thứ 2',
  'Thứ 3',
  'Thứ 4',
  'Thứ 5',
  'Thứ 6',
  'Thứ 7',
] as const;

export interface DayStats {
  day: DayOfWeek;
  label: string; // Vietnamese label, index === day. 'CN','T2',…,'T7'
  n: number; // matches this team played on this weekday (home OR away)
  wins: number; // TT wins (full-time, team perspective)
  draws: number; // TT draws
  losses: number; // TT losses
  winRate: number; // integer 0..100, = round(wins / n * 100); 0 when n === 0
  h2Wins: number; // H2-only wins (h2 = TT − H1)
  h2WinRate: number; // integer 0..100, = round(h2Wins / n * 100); 0 when n === 0
  goalsFor: number; // TT goals scored by team, summed over the day
  goalsAgainst: number; // TT goals conceded by team, summed over the day
  avgGF: number; // goalsFor / n, 1 decimal (Number, not string); 0 when n === 0
  avgGA: number; // goalsAgainst / n, 1 decimal; 0 when n === 0
}

// Returns exactly 7 entries, index i === day i (0..6, Sun..Sat).
// Days with no matches for this team have n === 0 and all numeric fields 0.
export function teamDayStats(matches: Match[], team: string): DayStats[] {
  // 1. Initialise 7 mutable accumulators, one per weekday.
  const buckets: DayStats[] = DAY_LABELS.map((label, day) => ({
    day: day as DayOfWeek,
    label,
    n: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    winRate: 0,
    h2Wins: 0,
    h2WinRate: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    avgGF: 0,
    avgGA: 0,
  }));

  // 2. Filter to this team's matches.
  const list = matches.filter((m) => m.homeTeam === team || m.awayTeam === team);

  // 3. For each match, extract the weekday from the DD/MM/YYYY date string.
  for (const m of list) {
    const [d, mo, y] = m.date.split('/'); // "27/06/2026" → ["27","06","2026"]
    const day = new Date(`${y}-${mo}-${d}`).getDay(); // ISO "2026-06-27" → 0..6
    const b = buckets[day];

    const isHome = m.homeTeam === team;
    const myTT = isHome ? +m.ttHome : +m.ttAway;
    const opTT = isHome ? +m.ttAway : +m.ttHome;
    const { h2Home, h2Away } = h2Score(m);
    const myH2 = isHome ? h2Home : h2Away;
    const opH2 = isHome ? h2Away : h2Home;

    b.n++;
    b.goalsFor += myTT;
    b.goalsAgainst += opTT;
    if (myTT > opTT) b.wins++;
    else if (myTT === opTT) b.draws++;
    else b.losses++;
    if (myH2 > opH2) b.h2Wins++;
  }

  // 4. Finalise derived fields.
  for (const b of buckets) {
    if (b.n) {
      b.winRate = Math.round((b.wins / b.n) * 100);
      b.h2WinRate = Math.round((b.h2Wins / b.n) * 100);
      b.avgGF = Number((b.goalsFor / b.n).toFixed(1));
      b.avgGA = Number((b.goalsAgainst / b.n).toFixed(1));
    }
  }

  return buckets;
}

// best  = highest winRate among days with n >= 3; null if none qualify.
// worst = lowest  winRate among days with n >= 3; null if none qualify.
// If exactly one day qualifies, best === worst (same object).
// On a tie, first-encountered (lowest day index) wins.
export function bestAndWorstDay(stats: DayStats[]): {
  best: DayStats | null;
  worst: DayStats | null;
} {
  let best: DayStats | null = null;
  let worst: DayStats | null = null;
  for (const s of stats) {
    if (s.n < 3) continue;
    if (best === null || s.winRate > best.winRate) best = s;
    if (worst === null || s.winRate < worst.winRate) worst = s;
  }
  return { best, worst };
}

// Client-only. new Date().getDay() cast to DayOfWeek.
export function todayDayOfWeek(): DayOfWeek {
  return new Date().getDay() as DayOfWeek;
}

// Returns stats[todayDayOfWeek()]; null only if stats has fewer than 7 entries.
export function todayStats(stats: DayStats[]): DayStats | null {
  return stats[todayDayOfWeek()] ?? null;
}
