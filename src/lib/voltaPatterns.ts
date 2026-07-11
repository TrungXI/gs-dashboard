import type { VoltaMatch } from '../types/voltaMatch';

export type WinCode = 'H' | 'A';

// ---- internal helpers -------------------------------------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 100) : 0;
}

/** H if home outscored away, else A. Never draws in Volta. */
export function winnerCode(m: VoltaMatch): WinCode {
  return m.homeScore > m.awayScore ? 'H' : 'A';
}

/**
 * Return matches in chronological order (oldest → newest) so streaks read
 * left→right in time. Sort by date+time. date = "DD/MM/YYYY", time = "HH:mm".
 * Build a comparable key `YYYYMMDDHHmm` and sort ascending. Stable; ties keep
 * input order.
 */
export function chronological(matches: VoltaMatch[]): VoltaMatch[] {
  const key = (m: VoltaMatch): string => {
    const [dd, mm, yyyy] = m.date.split('/');
    const [hh, mi] = m.time.split(':');
    return `${yyyy}${mm}${dd}${hh}${mi}`;
  };
  return matches
    .map((m, i) => ({ m, i, k: key(m) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
    .map((x) => x.m);
}

// ---- 4.1 Win distribution ---------------------------------------------------

export interface WinDistribution {
  total: number;
  home: number;
  away: number;
  homePct: number;
  awayPct: number;
}

export function winDistribution(matches: VoltaMatch[]): WinDistribution {
  const seq = chronological(matches);
  let home = 0;
  let away = 0;
  for (const m of seq) {
    if (winnerCode(m) === 'H') home++;
    else away++;
  }
  const total = seq.length;
  return {
    total,
    home,
    away,
    homePct: total ? round1((home / total) * 100) : 0,
    awayPct: total ? round1((away / total) * 100) : 0,
  };
}

// ---- 4.2 Sequence + runs ----------------------------------------------------

export interface Run {
  code: WinCode;
  length: number;
  startIndex: number;
}

export interface SequenceView {
  sequence: WinCode[];
  runs: Run[];
  currentRun: Run | null;
}

export function sequenceView(matches: VoltaMatch[]): SequenceView {
  const sequence = chronological(matches).map(winnerCode);
  const runs: Run[] = [];
  if (sequence.length > 0) {
    let code = sequence[0];
    let start = 0;
    for (let i = 1; i <= sequence.length; i++) {
      if (i === sequence.length || sequence[i] !== code) {
        runs.push({ code, length: i - start, startIndex: start });
        if (i < sequence.length) {
          code = sequence[i];
          start = i;
        }
      }
    }
  }
  return {
    sequence,
    runs,
    currentRun: runs.length ? runs[runs.length - 1] : null,
  };
}

// ---- 4.3 Streak length statistics ------------------------------------------

export interface StreakLenBucket {
  length: 1 | 2 | 3 | 4 | 5;
  label: string;
  home: number;
  away: number;
  total: number;
}

export interface StreakStats {
  buckets: StreakLenBucket[];
  avgHomeStreak: number;
  avgAwayStreak: number;
  avgStreak: number;
  longestHome: number;
  longestAway: number;
}

export function streakStats(matches: VoltaMatch[]): StreakStats {
  const { runs } = sequenceView(matches);

  const labels: Record<number, string> = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5+' };
  const buckets: StreakLenBucket[] = ([1, 2, 3, 4, 5] as const).map((length) => ({
    length,
    label: labels[length],
    home: 0,
    away: 0,
    total: 0,
  }));

  let homeSum = 0;
  let homeCount = 0;
  let awaySum = 0;
  let awayCount = 0;
  let longestHome = 0;
  let longestAway = 0;

  for (const r of runs) {
    const bucketIndex = Math.min(r.length, 5) - 1;
    const b = buckets[bucketIndex];
    if (r.code === 'H') {
      b.home++;
      homeSum += r.length;
      homeCount++;
      if (r.length > longestHome) longestHome = r.length;
    } else {
      b.away++;
      awaySum += r.length;
      awayCount++;
      if (r.length > longestAway) longestAway = r.length;
    }
    b.total++;
  }

  const allSum = homeSum + awaySum;
  const allCount = homeCount + awayCount;

  return {
    buckets,
    avgHomeStreak: homeCount ? round1(homeSum / homeCount) : 0,
    avgAwayStreak: awayCount ? round1(awaySum / awayCount) : 0,
    avgStreak: allCount ? round1(allSum / allCount) : 0,
    longestHome,
    longestAway,
  };
}

// ---- 4.4 Transition matrix (flip-back vs extend) ---------------------------

export interface TransitionRow {
  afterCode: WinCode;
  afterLength: number;
  lengthLabel: string;
  flipBack: number;
  extend: number;
  total: number;
  flipBackPct: number;
  extendPct: number;
}

export function transitionMatrix(matches: VoltaMatch[]): TransitionRow[] {
  const { runs } = sequenceView(matches);

  // key = `${code}-${bucket}` where bucket = min(length,5)
  const groups = new Map<string, { afterCode: WinCode; afterLength: number; flipBack: number; extend: number }>();

  for (let i = 0; i < runs.length - 1; i++) {
    const cur = runs[i];
    const next = runs[i + 1];
    const bucket = Math.min(cur.length, 5);
    const key = `${cur.code}-${bucket}`;
    const g =
      groups.get(key) ??
      (groups.set(key, { afterCode: cur.code, afterLength: bucket, flipBack: 0, extend: 0 }),
      groups.get(key)!);
    if (next.length === 1) g.flipBack++;
    else g.extend++;
  }

  const rows: TransitionRow[] = [];
  for (const g of groups.values()) {
    const total = g.flipBack + g.extend;
    if (total === 0) continue;
    rows.push({
      afterCode: g.afterCode,
      afterLength: g.afterLength,
      lengthLabel: g.afterLength >= 5 ? '5+' : String(g.afterLength),
      flipBack: g.flipBack,
      extend: g.extend,
      total,
      flipBackPct: pct(g.flipBack, total),
      extendPct: pct(g.extend, total),
    });
  }

  // H rows (length asc) first, then A rows (length asc)
  const order = (c: WinCode) => (c === 'H' ? 0 : 1);
  rows.sort((a, b) => order(a.afterCode) - order(b.afterCode) || a.afterLength - b.afterLength);
  return rows;
}

// ---- 4.5 Per-team dominance -------------------------------------------------

export interface TeamDominance {
  team: string;
  homeGames: number;
  homeWins: number;
  homeWinPct: number;
  awayGames: number;
  awayWins: number;
  awayWinPct: number;
}

export interface DominanceTables {
  topHome: TeamDominance[];
  topAway: TeamDominance[];
}

export function teamDominance(matches: VoltaMatch[]): DominanceTables {
  const seq = chronological(matches);
  const map = new Map<string, { homeGames: number; homeWins: number; awayGames: number; awayWins: number }>();

  const get = (team: string) =>
    map.get(team) ??
    (map.set(team, { homeGames: 0, homeWins: 0, awayGames: 0, awayWins: 0 }), map.get(team)!);

  for (const m of seq) {
    const code = winnerCode(m);
    const h = get(m.homeTeam);
    h.homeGames++;
    if (code === 'H') h.homeWins++;
    const a = get(m.awayTeam);
    a.awayGames++;
    if (code === 'A') a.awayWins++;
  }

  const all: TeamDominance[] = [];
  for (const [team, s] of map) {
    all.push({
      team,
      homeGames: s.homeGames,
      homeWins: s.homeWins,
      homeWinPct: pct(s.homeWins, s.homeGames),
      awayGames: s.awayGames,
      awayWins: s.awayWins,
      awayWinPct: pct(s.awayWins, s.awayGames),
    });
  }

  const topHome = all
    .filter((t) => t.homeGames >= 3)
    .sort((a, b) => b.homeWinPct - a.homeWinPct || b.homeGames - a.homeGames)
    .slice(0, 10);

  const topAway = all
    .filter((t) => t.awayGames >= 3)
    .sort((a, b) => b.awayWinPct - a.awayWinPct || b.awayGames - a.awayGames)
    .slice(0, 10);

  return { topHome, topAway };
}

// ---- 4.6 Anomaly detector ---------------------------------------------------

export interface StreakAnomaly {
  isAnomaly: boolean;
  currentCode: WinCode | null;
  currentLength: number;
  avgForCode: number;
  threshold: number;
  message: string;
}

export function detectAnomaly(matches: VoltaMatch[]): StreakAnomaly {
  const { currentRun } = sequenceView(matches);
  const stats = streakStats(matches);

  if (!currentRun) {
    return {
      isAnomaly: false,
      currentCode: null,
      currentLength: 0,
      avgForCode: 0,
      threshold: 0,
      message: 'Chưa đủ dữ liệu.',
    };
  }

  const code = currentRun.code;
  const currentLength = currentRun.length;
  const avgForCode = code === 'H' ? stats.avgHomeStreak : stats.avgAwayStreak;
  const threshold = round1(1.5 * avgForCode);
  const isAnomaly = currentLength > threshold;

  const codeName = code === 'H' ? 'Home' : 'Away';
  const message = isAnomaly
    ? `⚠️ Đang phá mẫu: chuỗi ${codeName} hiện tại dài ${currentLength} trận (TB ${avgForCode}, ngưỡng ${threshold}).`
    : `Chuỗi ${code} hiện tại dài ${currentLength} trận — trong ngưỡng bình thường (TB ${avgForCode}).`;

  return {
    isAnomaly,
    currentCode: code,
    currentLength,
    avgForCode,
    threshold,
    message,
  };
}

// ---- Meta-pattern detector --------------------------------------------------

export interface MetaPatternResult {
  period: number;
  template: number[];
  score: number;
  matchedRuns: number;
}

export interface MetaSegment {
  startRunIdx: number;
  endRunIdx: number;
  period: number;
  template: number[];
  code: string;
  score: number;
  runCount: number;
  matchCount: number;
  label: string;
}

export interface NextPrediction {
  currentMetaPattern: string;
  currentSegmentLength: number;
  positionInPattern: number;
  nextExpectedRunLength: number;
  remainingInRun: number;
  nextCode: WinCode;
  confidence: number;
  reasoning: string;
  label: string;
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: number[]): number {
  if (xs.length <= 1) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function detectMetaPattern(runLengths: number[]): MetaPatternResult {
  const window = runLengths.slice(0, Math.min(20, runLengths.length));
  if (window.length < 3) return { period: 0, template: [], score: 0, matchedRuns: 0 };
  const overallMean = mean(window);
  if (overallMean === 0) return { period: 0, template: [], score: 0, matchedRuns: 0 };

  let best: MetaPatternResult = { period: 0, template: [], score: -1, matchedRuns: 0 };

  for (let P = 1; P <= 4; P++) {
    if (window.length < P * 3) continue;
    const chunks = Math.floor(window.length / P);
    const template: number[] = [];
    let meanPosStd = 0;
    for (let i = 0; i < P; i++) {
      const col: number[] = [];
      for (let c = 0; c < chunks; c++) col.push(window[i + c * P]);
      meanPosStd += stdDev(col);
      template.push(Math.max(1, Math.round(mean(col))));
    }
    meanPosStd /= P;
    const score = Math.max(0, Math.min(1, 1 - meanPosStd / overallMean));
    const matchedRuns = chunks * P;
    if (
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) < 1e-9 && (best.period === 0 || P < best.period))
    ) {
      best = { period: P, template, score, matchedRuns };
    }
  }

  return best.period === 0 ? { period: 0, template: [], score: 0, matchedRuns: 0 } : best;
}

function getMetaLabel(period: number, template: number[], score: number): string {
  if (score < 0.6 || period === 0) return 'Không đều';
  if (period === 1 && template[0] === 1) return 'Luân phiên 1-1';
  if (period === 1 && template[0] >= 2) return `Cặp đôi ${template[0]}-${template[0]}`;
  return `Xen kẽ ${template.join('-')}`;
}

function getMetaCode(period: number, template: number[], score: number): string {
  if (score < 0.6 || period === 0) return 'Không đều';
  if (period === 1) return Array(4).fill(template[0]).join('-');
  const repeated: number[] = [];
  for (let i = 0; repeated.length < 4; i++) repeated.push(template[i % template.length]);
  return repeated.join('-');
}

export function segmentByMetaPattern(runs: Run[]): MetaSegment[] {
  if (runs.length === 0) return [];
  const lengths = runs.map((r) => r.length);
  const segments: MetaSegment[] = [];
  let segStart = 0;
  let consecDiff = 0;
  let currentDet = detectMetaPattern([...lengths.slice(0, Math.min(20, lengths.length))].reverse());

  for (let i = 0; i < runs.length; i++) {
    const windowLen = i - segStart + 1;
    const recent = lengths.slice(Math.max(segStart, i - 15), i + 1);
    const det = detectMetaPattern([...recent].reverse()); // most-recent-first

    const differs =
      det.period !== currentDet.period ||
      det.template.join('-') !== currentDet.template.join('-');
    const hasDivergence = differs && det.score > 0.65;

    if (hasDivergence) {
      consecDiff++;
    } else {
      consecDiff = 0;
      if (det.score >= 0.65) currentDet = det;
    }

    // Break: 3 consecutive divergent runs AND current segment has at least 4 runs
    if (consecDiff >= 3 && windowLen >= 4 + 3) {
      const breakAt = i - 3;
      if (breakAt >= segStart) {
        const segLengths = lengths.slice(segStart, breakAt + 1);
        const segDet = detectMetaPattern([...segLengths].reverse());
        segments.push({
          startRunIdx: segStart,
          endRunIdx: breakAt,
          period: segDet.period,
          template: segDet.template,
          code: segDet.template.join('-'),
          score: segDet.score,
          runCount: breakAt - segStart + 1,
          matchCount: runs.slice(segStart, breakAt + 1).reduce((s, r) => s + r.length, 0),
          label: getMetaLabel(segDet.period, segDet.template, segDet.score),
        });
        segStart = i - 2;
        consecDiff = 0;
        const newRecent = lengths.slice(segStart, i + 1);
        currentDet = detectMetaPattern([...newRecent].reverse());
      }
    }
  }

  // Close last segment
  const finalLengths = lengths.slice(segStart);
  const finalDet = detectMetaPattern([...finalLengths].reverse());
  segments.push({
    startRunIdx: segStart,
    endRunIdx: runs.length - 1,
    period: finalDet.period,
    template: finalDet.template,
    code: finalDet.template.join('-'),
    score: finalDet.score,
    runCount: runs.length - segStart,
    matchCount: runs.slice(segStart).reduce((s, r) => s + r.length, 0),
    label: getMetaLabel(finalDet.period, finalDet.template, finalDet.score),
  });

  return segments;
}

export function predictNext(runs: Run[], _matches: VoltaMatch[]): NextPrediction {
  if (runs.length === 0) {
    return {
      currentMetaPattern: 'Không đủ dữ liệu',
      currentSegmentLength: 0,
      positionInPattern: 0,
      nextExpectedRunLength: 1,
      remainingInRun: 0,
      nextCode: 'H',
      confidence: 0,
      reasoning: 'Chưa đủ dữ liệu.',
      label: 'Không đủ dữ liệu',
    };
  }

  const segments = segmentByMetaPattern(runs);
  const current = segments[segments.length - 1];
  const template = current.template.length ? current.template : [1];
  const period = template.length;

  const segRuns = runs.slice(current.startRunIdx);
  const positionInPattern = (segRuns.length - 1) % period;
  const nextExpectedRunLength = template[positionInPattern];
  const currentRun = runs[runs.length - 1];
  const remainingInRun = Math.max(0, nextExpectedRunLength - currentRun.length);

  const nextCode: WinCode =
    remainingInRun > 0 ? currentRun.code : currentRun.code === 'H' ? 'A' : 'H';
  const confidence = Math.min(1, current.score * (1 - 1 / Math.max(1, segRuns.length)));
  const metaCode = getMetaCode(current.period, current.template, current.score);

  let reasoning: string;
  if (current.score < 0.6) {
    reasoning = 'Mẫu không đều — độ tin cậy thấp.';
  } else if (remainingInRun > 0) {
    reasoning = `Mẫu ${metaCode} — đang ở ${currentRun.code}×${nextExpectedRunLength}, mới ${currentRun.length}/${nextExpectedRunLength}, còn ${remainingInRun} trận nữa.`;
  } else {
    reasoning = `Mẫu ${metaCode} — ${currentRun.code}×${nextExpectedRunLength} đã đủ, dự sang ${nextCode}.`;
  }

  return {
    currentMetaPattern: metaCode,
    currentSegmentLength: segRuns.length,
    positionInPattern,
    nextExpectedRunLength,
    remainingInRun,
    nextCode,
    confidence,
    reasoning,
    label: current.label,
  };
}
