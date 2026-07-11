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
  h2gf: number;
  h2ga: number;
  h2W: number;
  h2D: number;
  h2L: number;
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
    h1ga = 0,
    h2gf = 0,
    h2ga = 0,
    h2W = 0,
    h2D = 0,
    h2L = 0;
  for (const m of list) {
    const isHome = m.homeTeam === team;
    const my = +(isHome ? m.ttHome : m.ttAway);
    const op = +(isHome ? m.ttAway : m.ttHome);
    const myH1 = +(isHome ? m.h1Home : m.h1Away);
    const opH1 = +(isHome ? m.h1Away : m.h1Home);
    gf += my;
    ga += op;
    h1gf += myH1;
    h1ga += opH1;
    const myH2 = my - myH1;
    const opH2 = op - opH1;
    h2gf += myH2;
    h2ga += opH2;
    if (myH2 > opH2) h2W++;
    else if (myH2 === opH2) h2D++;
    else h2L++;
    if (my > op) W++;
    else if (my === op) D++;
    else L++;
  }
  return { n: list.length, W, D, L, gf, ga, h1gf, h1ga, h2gf, h2ga, h2W, h2D, h2L };
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
