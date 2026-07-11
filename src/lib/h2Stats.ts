import type { Match } from '../types/match';

export function h2Score(m: Match): { h2Home: number; h2Away: number } {
  const h2Home = +m.ttHome - +m.h1Home;
  const h2Away = +m.ttAway - +m.h1Away;
  return { h2Home, h2Away };
}

export interface H2TeamStats {
  n: number;
  W: number;
  D: number;
  L: number;
  gf: number; // H2 goals for
  ga: number; // H2 goals against
  winRate: number; // W / n as a fraction 0..1 (0 when n === 0)
}

export function h2StatsForTeam(matches: Match[], team: string): H2TeamStats {
  const list = matches.filter((m) => m.homeTeam === team || m.awayTeam === team);
  let W = 0,
    D = 0,
    L = 0,
    gf = 0,
    ga = 0;
  for (const m of list) {
    const isHome = m.homeTeam === team;
    const { h2Home, h2Away } = h2Score(m);
    const my = isHome ? h2Home : h2Away;
    const op = isHome ? h2Away : h2Home;
    gf += my;
    ga += op;
    if (my > op) W++;
    else if (my === op) D++;
    else L++;
  }
  const n = list.length;
  const winRate = n ? W / n : 0;
  return { n, W, D, L, gf, ga, winRate };
}

export interface H1ToH2Result {
  homeHolds: number; // count: H1 home-leader still wins on TT  (home lead held)
  awayHolds: number; // count: H1 away-leader still wins on TT  (away lead held)
  draws: number; // count: TT ends level
  reversal: number; // count: the H1 loser wins on TT (lead overturned)
  total: number; // count of matches with this exact H1 scoreline
  h2DistTop5: { score: string; count: number }[]; // 5 most common H2 scorelines (home-away), desc
}

export function h1ToH2Outcomes(
  matches: Match[],
  h1HomeGoals: number,
  h1AwayGoals: number,
): H1ToH2Result {
  const selected = matches.filter(
    (m) => +m.h1Home === h1HomeGoals && +m.h1Away === h1AwayGoals,
  );
  const total = selected.length;
  let homeHolds = 0,
    awayHolds = 0,
    draws = 0,
    reversal = 0;
  const h2Counts = new Map<string, number>();

  const h1Diff = h1HomeGoals - h1AwayGoals; // >0 home led, <0 away led, ===0 level at H1

  for (const m of selected) {
    const ttH = +m.ttHome;
    const ttA = +m.ttAway;
    const ttDiff = ttH - ttA;

    // TT outcome buckets
    if (ttDiff === 0) {
      draws++;
    } else if (h1Diff > 0) {
      // home was leading at H1
      if (ttDiff > 0) homeHolds++;
      else reversal++;
    } else if (h1Diff < 0) {
      // away was leading at H1
      if (ttDiff < 0) awayHolds++;
      else reversal++;
    } else {
      // h1Diff === 0, level at H1 (no leader)
      if (ttDiff > 0) homeHolds++;
      else awayHolds++;
    }

    // H2 distribution
    const { h2Home, h2Away } = h2Score(m);
    const key = `${h2Home}-${h2Away}`;
    h2Counts.set(key, (h2Counts.get(key) ?? 0) + 1);
  }

  const h2DistTop5 = [...h2Counts.entries()]
    .map(([score, count]) => ({ score, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { homeHolds, awayHolds, draws, reversal, total, h2DistTop5 };
}

export interface CommonH1Score {
  label: string; // `${h1Home}-${h1Away}`  e.g. "1-0"
  home: number;
  away: number;
  count: number;
}

export function getCommonH1Scores(matches: Match[]): CommonH1Score[] {
  const counts = new Map<string, { home: number; away: number; count: number }>();
  for (const m of matches) {
    const h = +m.h1Home;
    const a = +m.h1Away;
    const key = `${h}-${a}`;
    const entry = counts.get(key) ?? { home: h, away: a, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.entries()]
    .map(([label, v]) => ({ label, home: v.home, away: v.away, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}
