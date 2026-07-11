import type { Match } from '../types/match';

// ---- internal helpers -------------------------------------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 100) : 0;
}

type GSResult = 'H' | 'D' | 'A';

function ttResult(m: Match): GSResult {
  const h = +m.ttHome;
  const a = +m.ttAway;
  return h > a ? 'H' : h === a ? 'D' : 'A';
}

function h1Key(m: Match): string {
  return `${m.h1Home}-${m.h1Away}`;
}

function ttKey(m: Match): string {
  return `${m.ttHome}-${m.ttAway}`;
}

function totalGoals(m: Match): number {
  return +m.ttHome + +m.ttAway;
}

function hourOf(m: Match): number {
  return Number(m.time.slice(11, 13));
}

/** Oldest → newest. GS `matches` prop arrives newest-first. */
function chronoAsc(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => a.time.localeCompare(b.time));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---- 5.1 Score pattern sequences (H1 → TT distribution) --------------------

export interface TTOutcome {
  ttScore: string;
  count: number;
  pct: number;
}

export interface H1Group {
  h1Score: string;
  total: number;
  outcomes: TTOutcome[];
}

export function scorePatterns(matches: Match[]): H1Group[] {
  const groups = new Map<string, Map<string, number>>();
  for (const m of matches) {
    const h1 = h1Key(m);
    const tt = ttKey(m);
    const g = groups.get(h1) ?? (groups.set(h1, new Map()), groups.get(h1)!);
    g.set(tt, (g.get(tt) ?? 0) + 1);
  }

  const result: H1Group[] = [];
  for (const [h1Score, ttMap] of groups) {
    const total = [...ttMap.values()].reduce((s, c) => s + c, 0);
    if (total < 3) continue;

    const sorted = [...ttMap.entries()]
      .map(([ttScore, count]) => ({ ttScore, count }))
      .sort((a, b) => b.count - a.count);

    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6);
    const outcomes: TTOutcome[] = top.map((o) => ({
      ttScore: o.ttScore,
      count: o.count,
      pct: pct(o.count, total),
    }));
    if (rest.length > 0) {
      const restCount = rest.reduce((s, o) => s + o.count, 0);
      outcomes.push({ ttScore: 'khác', count: restCount, pct: pct(restCount, total) });
    }

    result.push({ h1Score, total, outcomes });
  }

  return result.sort((a, b) => b.total - a.total);
}

// ---- 5.2 Rolling home-win window -------------------------------------------

export interface RollingPoint {
  index: number;
  date: string;
  homeWinPct: number;
}

export interface RollingHomeWin {
  windowSize: number;
  points: RollingPoint[];
  firstPct: number;
  lastPct: number;
  trend: 'up' | 'down' | 'flat';
}

export function rollingHomeWin(matches: Match[], windowSize = 20): RollingHomeWin {
  const seq = chronoAsc(matches);
  const bin = seq.map((m) => (ttResult(m) === 'H' ? 1 : 0));
  const n = bin.length;
  const points: RollingPoint[] = [];

  if (n >= windowSize) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += bin[i];
      if (i >= windowSize) sum -= bin[i - windowSize];
      if (i >= windowSize - 1) {
        points.push({
          index: i,
          date: seq[i].date,
          homeWinPct: Math.round((sum / windowSize) * 100),
        });
      }
    }
  }

  const firstPct = points.length ? points[0].homeWinPct : 0;
  const lastPct = points.length ? points[points.length - 1].homeWinPct : 0;
  const delta = lastPct - firstPct;
  const trend: 'up' | 'down' | 'flat' = delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat';

  return { windowSize, points, firstPct, lastPct, trend };
}

// ---- 5.3 Match type comparison (20p vs 16p) --------------------------------

export interface TypeAgg {
  type: '20p' | '16p';
  n: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  avgGoals: number;
  avgH1Goals: number;
}

export interface TypeComparison {
  p20: TypeAgg;
  p16: TypeAgg;
}

function aggregateType(matches: Match[], type: '20p' | '16p'): TypeAgg {
  const subset = matches.filter((m) => m.matchType === type);
  const n = subset.length;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let goalsSum = 0;
  let h1GoalsSum = 0;

  for (const m of subset) {
    const r = ttResult(m);
    if (r === 'H') homeWins++;
    else if (r === 'D') draws++;
    else awayWins++;
    goalsSum += totalGoals(m);
    h1GoalsSum += +m.h1Home + +m.h1Away;
  }

  return {
    type,
    n,
    homeWins,
    draws,
    awayWins,
    homeWinPct: pct(homeWins, n),
    drawPct: pct(draws, n),
    awayWinPct: pct(awayWins, n),
    avgGoals: n ? round1(goalsSum / n) : 0,
    avgH1Goals: n ? round1(h1GoalsSum / n) : 0,
  };
}

export function typeComparison(matches: Match[]): TypeComparison {
  return {
    p20: aggregateType(matches, '20p'),
    p16: aggregateType(matches, '16p'),
  };
}

// ---- 5.4 High/low scoring streaks ------------------------------------------

export interface ScoringSplit {
  threshold: number;
  high: { count: number; pct: number; avgGoals: number };
  low: { count: number; pct: number; avgGoals: number };
  longestHighStreak: number;
  longestLowStreak: number;
  currentStreakType: 'high' | 'low' | null;
  currentStreakLength: number;
}

export function scoringStreaks(matches: Match[]): ScoringSplit {
  const seq = chronoAsc(matches);
  const totals = seq.map(totalGoals);
  const threshold = Math.round(median(totals));

  let highCount = 0;
  let lowCount = 0;
  let highGoals = 0;
  let lowGoals = 0;

  for (const t of totals) {
    if (t >= threshold) {
      highCount++;
      highGoals += t;
    } else {
      lowCount++;
      lowGoals += t;
    }
  }

  const total = seq.length;

  // walk chronologically for longest & current streaks
  let longestHighStreak = 0;
  let longestLowStreak = 0;
  let runType: 'high' | 'low' | null = null;
  let runLen = 0;
  for (const t of totals) {
    const kind: 'high' | 'low' = t >= threshold ? 'high' : 'low';
    if (kind === runType) {
      runLen++;
    } else {
      runType = kind;
      runLen = 1;
    }
    if (kind === 'high') longestHighStreak = Math.max(longestHighStreak, runLen);
    else longestLowStreak = Math.max(longestLowStreak, runLen);
  }

  return {
    threshold,
    high: { count: highCount, pct: pct(highCount, total), avgGoals: highCount ? round1(highGoals / highCount) : 0 },
    low: { count: lowCount, pct: pct(lowCount, total), avgGoals: lowCount ? round1(lowGoals / lowCount) : 0 },
    longestHighStreak,
    longestLowStreak,
    currentStreakType: total ? runType : null,
    currentStreakLength: total ? runLen : 0,
  };
}

// ---- 5.5 Time-of-day patterns ----------------------------------------------

export interface SlotAgg {
  slot: 'morning' | 'afternoon' | 'evening';
  label: string;
  n: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  homeWinPct: number;
  upsetPct: number;
  avgGoals: number;
}

export function timeOfDay(matches: Match[]): SlotAgg[] {
  const defs: { slot: SlotAgg['slot']; label: string; test: (h: number) => boolean }[] = [
    { slot: 'morning', label: 'Sáng', test: (h) => h < 12 },
    { slot: 'afternoon', label: 'Chiều', test: (h) => h >= 12 && h <= 17 },
    { slot: 'evening', label: 'Tối', test: (h) => h >= 18 },
  ];

  return defs.map(({ slot, label, test }) => {
    const subset = matches.filter((m) => test(hourOf(m)));
    const n = subset.length;
    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;
    let goalsSum = 0;
    for (const m of subset) {
      const r = ttResult(m);
      if (r === 'H') homeWins++;
      else if (r === 'D') draws++;
      else awayWins++;
      goalsSum += totalGoals(m);
    }
    return {
      slot,
      label,
      n,
      homeWins,
      draws,
      awayWins,
      homeWinPct: pct(homeWins, n),
      upsetPct: pct(awayWins, n),
      avgGoals: n ? round1(goalsSum / n) : 0,
    };
  });
}
