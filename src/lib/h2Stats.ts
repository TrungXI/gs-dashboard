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

export interface H2OutcomeSet {
  n: number;
  holds: number;
  recovers: number;
  draws: number;
  reversedAgainst: number;
  h1Draw: boolean;
  h2W: number;
  h2D: number;
  h2L: number;
  h2DistTop3: [string, number][];
}

function buildH2OutcomeSet(
  matches: Match[],
  team: string,
  h1HomeGoals: number,
  h1AwayGoals: number,
  isHome: boolean,
): H2OutcomeSet {
  const list = matches.filter((m) => {
    if (!(+m.h1Home === h1HomeGoals && +m.h1Away === h1AwayGoals)) return false;
    return isHome ? m.homeTeam === team : m.awayTeam === team;
  });

  const set: H2OutcomeSet = {
    n: list.length,
    holds: 0,
    recovers: 0,
    draws: 0,
    reversedAgainst: 0,
    h1Draw: h1HomeGoals === h1AwayGoals,
    h2W: 0,
    h2D: 0,
    h2L: 0,
    h2DistTop3: [],
  };

  const dist = new Map<string, number>();

  for (const m of list) {
    const myH1 = isHome ? +m.h1Home : +m.h1Away;
    const opH1 = isHome ? +m.h1Away : +m.h1Home;
    const myTT = isHome ? +m.ttHome : +m.ttAway;
    const opTT = isHome ? +m.ttAway : +m.ttHome;
    const { h2Home, h2Away } = h2Score(m);
    const myH2 = isHome ? h2Home : h2Away;
    const opH2 = isHome ? h2Away : h2Home;
    const h1Diff = myH1 - opH1;

    if (h1Diff === 0) {
      set.h1Draw = true;
      if (myTT === opTT) set.draws++;
      if (myH2 > opH2) set.h2W++;
      else if (myH2 === opH2) set.h2D++;
      else set.h2L++;
    } else if (h1Diff > 0) {
      if (myTT > opTT) set.holds++;
      else if (myTT === opTT) set.draws++;
      else set.reversedAgainst++;
    } else {
      if (myTT >= opTT) set.recovers++;
      if (myTT === opTT) set.draws++;
      if (myH2 > opH2) set.h2W++;
      else if (myH2 === opH2) set.h2D++;
      else set.h2L++;
    }

    const key = `${myH2}-${opH2}`;
    dist.set(key, (dist.get(key) ?? 0) + 1);
  }

  set.h2DistTop3 = [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  return set;
}

export function teamH2ResponseToH1(
  matches: Match[],
  team: string,
  h1HomeGoals: number,
  h1AwayGoals: number,
): { asHome: H2OutcomeSet; asAway: H2OutcomeSet } {
  return {
    asHome: buildH2OutcomeSet(matches, team, h1HomeGoals, h1AwayGoals, true),
    asAway: buildH2OutcomeSet(matches, team, h1HomeGoals, h1AwayGoals, false),
  };
}

export function h2hH1ToH2Outcomes(
  matches: Match[],
  t1: string,
  t2: string,
  h1HomeGoals: number,
  h1AwayGoals: number,
): {
  n: number;
  t1WinsH2: number;
  t2WinsH2: number;
  drawsH2: number;
  t1WinsTT: number;
  t2WinsTT: number;
  drawsTT: number;
  h2DistTop2: [string, number][];
} {
  const list = matches.filter(
    (m) =>
      ((m.homeTeam === t1 && m.awayTeam === t2) ||
        (m.homeTeam === t2 && m.awayTeam === t1)) &&
      +m.h1Home === h1HomeGoals &&
      +m.h1Away === h1AwayGoals,
  );

  let t1WinsH2 = 0,
    t2WinsH2 = 0,
    drawsH2 = 0,
    t1WinsTT = 0,
    t2WinsTT = 0,
    drawsTT = 0;
  const dist = new Map<string, number>();

  for (const m of list) {
    const t1IsHome = m.homeTeam === t1;
    const { h2Home, h2Away } = h2Score(m);
    const t1H2 = t1IsHome ? h2Home : h2Away;
    const t2H2 = t1IsHome ? h2Away : h2Home;
    const t1TT = t1IsHome ? +m.ttHome : +m.ttAway;
    const t2TT = t1IsHome ? +m.ttAway : +m.ttHome;

    if (t1H2 > t2H2) t1WinsH2++;
    else if (t1H2 === t2H2) drawsH2++;
    else t2WinsH2++;

    if (t1TT > t2TT) t1WinsTT++;
    else if (t1TT === t2TT) drawsTT++;
    else t2WinsTT++;

    const key = `${t1H2}-${t2H2}`;
    dist.set(key, (dist.get(key) ?? 0) + 1);
  }

  const h2DistTop2 = [...dist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  return {
    n: list.length,
    t1WinsH2,
    t2WinsH2,
    drawsH2,
    t1WinsTT,
    t2WinsTT,
    drawsTT,
    h2DistTop2,
  };
}
