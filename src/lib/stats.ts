import type { Match } from '../types/match';

export interface TypeStats {
  n: number;
  W: number;
  D: number;
  L: number;
  gf: number;
  ga: number;
  h1gf: number;
  h1ga: number;
}

export interface TeamStats {
  s20: TypeStats;
  s16: TypeStats;
  r20: Match[];
  r16: Match[];
}

export type Result = 'W' | 'D' | 'L';

export function resultFor(m: Match, team: string): Result {
  const isHome = m.homeTeam === team;
  const my = +(isHome ? m.ttHome : m.ttAway);
  const op = +(isHome ? m.ttAway : m.ttHome);
  if (my > op) return 'W';
  if (my === op) return 'D';
  return 'L';
}

function statsFor(list: Match[], team: string): TypeStats {
  let W = 0,
    D = 0,
    L = 0,
    gf = 0,
    ga = 0,
    h1gf = 0,
    h1ga = 0;
  for (const m of list) {
    const isHome = m.homeTeam === team;
    const my = +(isHome ? m.ttHome : m.ttAway);
    const op = +(isHome ? m.ttAway : m.ttHome);
    gf += my;
    ga += op;
    h1gf += +(isHome ? m.h1Home : m.h1Away);
    h1ga += +(isHome ? m.h1Away : m.h1Home);
    if (my > op) W++;
    else if (my === op) D++;
    else L++;
  }
  return { n: list.length, W, D, L, gf, ga, h1gf, h1ga };
}

export function calcStats(matches: Match[], team: string): TeamStats {
  const played = matches.filter((m) => m.homeTeam === team || m.awayTeam === team);
  const p20 = played.filter((m) => m.matchType === '20p');
  const p16 = played.filter((m) => m.matchType === '16p');
  return {
    s20: statsFor(p20, team),
    s16: statsFor(p16, team),
    r20: p20.slice(0, 5),
    r16: p16.slice(0, 5),
  };
}

export interface H2HSum {
  W: number;
  D: number;
  L: number;
  gf: number;
  ga: number;
  n: number;
}

export function h2hSum(list: Match[], team: string): H2HSum {
  let W = 0,
    D = 0,
    L = 0,
    gf = 0,
    ga = 0;
  for (const m of list) {
    const ih = m.homeTeam === team;
    const my = +(ih ? m.ttHome : m.ttAway);
    const op = +(ih ? m.ttAway : m.ttHome);
    gf += my;
    ga += op;
    if (my > op) W++;
    else if (my === op) D++;
    else L++;
  }
  return { W, D, L, gf, ga, n: list.length };
}
