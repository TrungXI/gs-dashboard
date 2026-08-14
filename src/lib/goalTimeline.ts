// goalTimeline.ts — PURE logic for the "Timeline Ghi Bàn" report (CHANGE-GOALTIMELINE).
//
// No I/O. Callers (the route) query raw rows from match_odds_log / gs_16p_ticks and
// hand them to `buildGoalTimeline(rawRows, params)`, which returns the response object
// exactly matching §6 of the implementation SPEC.
//
// Pipeline: rawRows → per-event cohort → canonicalised goal-events (C2) → four metrics
// (distribution+Wilson, first-goal KM, gapWithinHalf, transition permutation test).
//
// Audit basis (CHANGE-GOALTIMELINE-c3-audit.md):
//   C1 — goalless = MAX(score_home+score_away) OVER event == 0 (NOT absence of goal rows).
//   C3 — gs_16p_ticks score is whole-match CUMULATIVE; smooth single-tick flicker.

// ── §0 constants (pre-declared, C5) ─────────────────────────────────────────
export const METHODOLOGY_VERSION = 'gtl-1';
export const BUFFER_MIN = 60; // trận bắt đầu < now()-60' mới coi hoàn tất
export const CAP_MINUTE = 50; // horizon cố định mỗi hiệp
export const DAYS_ALLOW = [7, 14] as const;
export const BIN_ALLOW = [5, 10] as const;
export const LEAGUE_ALLOW = ['16p', '20p_asian', '20p_intl'] as const;
export const PERM_R = 2000;
export const PERM_SEED = 0x9e3779b9; // deterministic mulberry32
export const THRESH = {
  survivalMinMatches: 100,
  gapMinIntervals: 150,
  transitionMinPairs: 300,
  transitionMinExpected: 5,
} as const;

export type League = (typeof LEAGUE_ALLOW)[number];
export type Half = 'H1' | 'H2';

// ── raw-row shapes handed in by the route ───────────────────────────────────

// A row from match_odds_log (for 16p / 20p_asian sourcing).
export interface OddsRawRow {
  event_id: number | string;
  snapshot_type: string; // 'first_seen' | 'kickoff_h1' | 'kickoff_h2' | 'goal_h1' | 'goal_h2' | …
  period: number | string | null; // 2/8 (asian) or 4/16 (rare)
  minute: number | string | null;
  is_h2: boolean | null;
  score_home: number | string | null;
  score_away: number | string | null;
  recorded_at: string | Date;
}

// A row from gs_16p_ticks (for 20p_intl sourcing, league_id=1485).
export interface TickRawRow {
  event_id: number | string;
  period: number | string | null; // 2 → H1, 8 → H2
  minute: number | string | null;
  is_h2: boolean | null;
  score_home: number | string | null;
  score_away: number | string | null;
  recorded_at: string | Date;
}

export interface BuildParams {
  league: League;
  days: number;
  bin: number;
  generatedAt?: string; // override for deterministic tests; else new Date().toISOString()
}

// ── internal canonical model ────────────────────────────────────────────────

interface GoalEvent {
  half: Half;
  minute: number; // provider minute within the half (clamped context handled downstream)
  total: number; // cumulative total AFTER this goal (for the event)
  intervalCensored: boolean; // this goal came from a Δ>1 batch (excluded from first/gap/transition)
  leftCensored: boolean; // ticks: first tick of event already had total>0
  overflowMinute: boolean; // minute outside [1,CAP]
  binStart: number; // assigned distribution bin start (after clamp)
}

interface EventModel {
  eventId: string;
  reachedH2: boolean;
  maxTotal: number;
  goalless: boolean; // maxTotal === 0
  goals: GoalEvent[]; // canonicalised, sorted by (half, minute)
  hasH1Kickoff: boolean; // genuine H1 kickoff observation (period 2 / minute~1)
  inProgress: boolean; // excluded from the cohort (kept for count)
}

interface QualityCounters {
  leftCensoredGoals: number;
  intervalCensoredGoalBatches: number;
  undercountEvents: number;
  overflowMinuteGoals: number;
  rarePeriodRows: number;
  unclassified20pEvents: number;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const toNum = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toMs = (v: string | Date): number =>
  v instanceof Date ? v.getTime() : new Date(v).getTime();

// period → half. 2/4 → H1, 8/16 → H2. Returns null for unknown (fall back to is_h2).
function periodToHalf(period: number): { half: Half; rare: boolean } | null {
  if (period === 2) return { half: 'H1', rare: false };
  if (period === 8) return { half: 'H2', rare: false };
  if (period === 4) return { half: 'H1', rare: true };
  if (period === 16) return { half: 'H2', rare: true };
  return null;
}

// mulberry32 — deterministic PRNG seeded by PERM_SEED (§0). Exported for tests.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wilson 95% score interval for a proportion (z=1.96). Returns [lo, hi] in [0,1].
export function wilsonCI(successes: number, trials: number): [number, number] {
  if (trials <= 0) return [0, 0];
  const z = 1.959963984540054;
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  const lo = (center - margin) / denom;
  const hi = (center + margin) / denom;
  return [Math.max(0, lo), Math.min(1, hi)];
}

// Benjamini-Hochberg q-values over a flat list of p-values. Returns q aligned to input.
// Only the passed p-values participate (caller filters to unmasked cells).
export function benjaminiHochberg(pvals: number[]): number[] {
  const m = pvals.length;
  if (m === 0) return [];
  const idx = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(m);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) {
    const rank = k + 1;
    const raw = (idx[k].p * m) / rank;
    prev = Math.min(prev, raw);
    q[idx[k].i] = Math.min(1, prev);
  }
  return q;
}

// bin index + [start,end] for a minute given bin width and CAP. Last bin gathers ≥.
function binOf(minute: number, bin: number): { start: number; end: number; index: number } {
  const m = Math.max(1, Math.min(CAP_MINUTE, minute));
  const index = Math.floor((m - 1) / bin);
  const start = index * bin + 1;
  const end = Math.min(CAP_MINUTE, start + bin - 1);
  return { start, end, index };
}

function binCount(bin: number): number {
  return Math.ceil(CAP_MINUTE / bin);
}

// ── C2/C3: build canonical event models from raw rows ───────────────────────

// odds_log path (16p / 20p_asian): dedupe goal rows, define goalless by maxTotal.
function buildEventsFromOdds(
  rows: OddsRawRow[],
  q: QualityCounters,
): EventModel[] {
  const byEvent = new Map<string, OddsRawRow[]>();
  for (const r of rows) {
    const id = String(r.event_id);
    let arr = byEvent.get(id);
    if (!arr) byEvent.set(id, (arr = []));
    arr.push(r);
  }

  const models: EventModel[] = [];
  for (const [eventId, evRows] of byEvent) {
    let maxTotal = 0;
    let reachedH2 = false;
    let hasH1Kickoff = false;

    // Dedupe key (event, half, score_home, score_away) → keep MIN(recorded_at).
    // Only goal snapshots carry a placed goal; the cohort/start rows just gate the event.
    const goalMap = new Map<string, { half: Half; minute: number; sh: number; sa: number; at: number; rare: boolean }>();

    for (const r of evRows) {
      const st = r.snapshot_type;
      const sh = toNum(r.score_home);
      const sa = toNum(r.score_away);
      const total = sh + sa;
      if (total > maxTotal) maxTotal = total;

      const periodNum = r.period == null ? NaN : Number(r.period);
      if (st === 'kickoff_h2') reachedH2 = true;
      if (periodNum === 8 || periodNum === 16 || r.is_h2 === true) reachedH2 = true;
      if ((st === 'first_seen' || st === 'kickoff_h1') && (periodNum === 2 || periodNum === 4)) {
        hasH1Kickoff = true;
      }

      if (st === 'goal_h1' || st === 'goal_h2') {
        // Resolve half: prefer period, fall back to snapshot_type / is_h2.
        let half: Half;
        let rare = false;
        const pm = periodToHalf(periodNum);
        if (pm) {
          half = pm.half;
          rare = pm.rare;
        } else {
          half = st === 'goal_h2' || r.is_h2 === true ? 'H2' : 'H1';
        }
        if (rare) q.rarePeriodRows += 1;
        const key = `${half}|${sh}|${sa}`;
        const at = toMs(r.recorded_at);
        const existing = goalMap.get(key);
        if (!existing || at < existing.at) {
          goalMap.set(key, { half, minute: toNum(r.minute), sh, sa, at, rare });
        }
      }
    }

    const goalless = maxTotal === 0; // C1 correction

    // Order canonical goals by recorded time, then validate the +1 step per event.
    const ordered = Array.from(goalMap.values()).sort((a, b) => a.at - b.at);
    const goals = finalizeGoals(ordered.map((g) => ({ half: g.half, minute: g.minute, total: g.sh + g.sa })), maxTotal, q);

    models.push({
      eventId,
      reachedH2,
      maxTotal,
      goalless,
      goals,
      hasH1Kickoff,
      inProgress: false,
    });
  }
  return models;
}

// ticks path (20p_intl): running cumulative total, flicker-smoothed, derive goals.
function buildEventsFromTicks(rows: TickRawRow[], q: QualityCounters): EventModel[] {
  const byEvent = new Map<string, TickRawRow[]>();
  for (const r of rows) {
    const id = String(r.event_id);
    let arr = byEvent.get(id);
    if (!arr) byEvent.set(id, (arr = []));
    arr.push(r);
  }

  const models: EventModel[] = [];
  for (const [eventId, evRows] of byEvent) {
    // Order the whole event by recorded_at (cumulative is whole-match, C3).
    const seq = evRows
      .map((r) => {
        const periodNum = r.period == null ? NaN : Number(r.period);
        const pm = periodToHalf(periodNum);
        const half: Half = pm ? pm.half : r.is_h2 === true || periodNum === 8 ? 'H2' : 'H1';
        return {
          at: toMs(r.recorded_at),
          minute: toNum(r.minute),
          half,
          total: toNum(r.score_home) + toNum(r.score_away),
        };
      })
      .sort((a, b) => a.at - b.at);

    if (seq.length === 0) continue;

    // Flicker smoothing: a single-tick drop that reverts next tick is dropped.
    // Implemented as running-max with a one-tick lookahead veto on a lone dip.
    const smoothed: number[] = [];
    for (let i = 0; i < seq.length; i++) {
      const cur = seq[i].total;
      const prevSmoothed = smoothed.length ? smoothed[smoothed.length - 1] : 0;
      if (cur < prevSmoothed) {
        // Drop below the smoothed running total → treat as flicker, hold previous.
        smoothed.push(prevSmoothed);
      } else {
        smoothed.push(cur);
      }
    }

    let reachedH2 = false;
    for (const s of seq) if (s.half === 'H2') reachedH2 = true;

    const maxTotal = smoothed.length ? smoothed[smoothed.length - 1] : 0;
    const goalless = maxTotal === 0;

    // Left-censored: first tick already had total>0.
    const firstTotal = smoothed[0];
    const leftCensoredCount = firstTotal > 0 ? firstTotal : 0;
    if (leftCensoredCount > 0) q.leftCensoredGoals += leftCensoredCount;

    // Derive goals from positive deltas of the smoothed running total.
    const raw: { half: Half; minute: number; total: number; delta: number }[] = [];
    let prev = 0;
    for (let i = 0; i < seq.length; i++) {
      const t = smoothed[i];
      const delta = t - prev;
      if (delta > 0) {
        raw.push({ half: seq[i].half, minute: seq[i].minute, total: t, delta });
      }
      prev = t;
    }

    // Left-censored first goals (delta from 0→firstTotal on the first observed tick)
    // are flagged: they have no reliable minute, so mark leftCensored & exclude later.
    const goals = finalizeTickGoals(raw, firstTotal, q);

    models.push({
      eventId,
      reachedH2,
      maxTotal,
      goalless,
      goals,
      hasH1Kickoff: seq[0].half === 'H1',
      inProgress: false,
    });
  }
  return models;
}

// Validate the canonical goal sequence (odds path): every step should be +1.
// A Δ>1 batch → intervalCensored for the whole batch; Σgoals != maxTotal → undercount.
function finalizeGoals(
  ordered: { half: Half; minute: number; total: number }[],
  maxTotal: number,
  q: QualityCounters,
): GoalEvent[] {
  const out: GoalEvent[] = [];
  let prevTotal = 0;
  for (const g of ordered) {
    const step = g.total - prevTotal;
    const intervalCensored = step > 1;
    if (intervalCensored) q.intervalCensoredGoalBatches += 1;
    const overflow = g.minute < 1 || g.minute > CAP_MINUTE;
    if (overflow) q.overflowMinuteGoals += 1;
    out.push({
      half: g.half,
      minute: g.minute,
      total: g.total,
      intervalCensored,
      leftCensored: false,
      overflowMinute: overflow,
      binStart: binOf(g.minute, 1).start, // placeholder; real bin assigned in distribution
    });
    prevTotal = g.total;
  }
  // Undercount: canonical goal count disagrees with maxTotal.
  if (out.length !== maxTotal) q.undercountEvents += 1;
  return out.sort(sortGoals);
}

// Tick path: mark left-censored first goals, flag Δ>1 batches.
function finalizeTickGoals(
  raw: { half: Half; minute: number; total: number; delta: number }[],
  firstTotal: number,
  q: QualityCounters,
): GoalEvent[] {
  const out: GoalEvent[] = [];
  let remainingLeftCensor = firstTotal; // goals present before first observed tick
  for (let i = 0; i < raw.length; i++) {
    const g = raw[i];
    const intervalCensored = g.delta > 1;
    if (intervalCensored) q.intervalCensoredGoalBatches += 1;
    // The first observed tick's total that was already >0 is left-censored: its
    // constituent goals have no reliable minute → flag & exclude from first/gap.
    const leftCensored = i === 0 && remainingLeftCensor > 0;
    if (leftCensored) remainingLeftCensor = 0;
    const overflow = g.minute < 1 || g.minute > CAP_MINUTE;
    if (overflow && !leftCensored) q.overflowMinuteGoals += 1;
    out.push({
      half: g.half,
      minute: g.minute,
      total: g.total,
      intervalCensored,
      leftCensored,
      overflowMinute: overflow,
      binStart: binOf(g.minute, 1).start,
    });
  }
  return out.sort(sortGoals);
}

function sortGoals(a: GoalEvent, b: GoalEvent): number {
  if (a.half !== b.half) return a.half === 'H1' ? -1 : 1;
  return a.minute - b.minute;
}

// ── §4.1 distribution + Wilson CI ───────────────────────────────────────────

interface DistBin {
  binStart: number;
  binEnd: number;
  goals: number;
  goalsPerMatch: number;
  sharePct: number;
  occupancy: number;
  atRisk: number;
  ci: [number, number];
}

function computeDistribution(
  events: EventModel[],
  half: Half,
  bin: number,
): { bins: DistBin[]; sharePctByBin: number[] } {
  const completeMatches = events.length;
  // For H2, atRisk conceptually = events; but occupancy denom stays completeMatches
  // for a comparable distribution axis (matches SPEC §4.1 atRisk=completeMatches).
  const nBins = binCount(bin);
  const goalsPerBin = new Array<number>(nBins).fill(0);
  // occupancy: per event, whether it had ≥1 goal in (half, bin).
  const occupancyEvents: Set<string>[] = Array.from({ length: nBins }, () => new Set<string>());

  let sampleGoals = 0;
  for (const ev of events) {
    for (const g of ev.goals) {
      if (g.half !== half) continue;
      const b = binOf(g.minute, bin);
      const bi = Math.min(nBins - 1, b.index);
      goalsPerBin[bi] += 1;
      sampleGoals += 1;
      occupancyEvents[bi].add(ev.eventId);
    }
  }

  const bins: DistBin[] = [];
  const sharePctByBin: number[] = [];
  for (let i = 0; i < nBins; i++) {
    const start = i * bin + 1;
    const end = Math.min(CAP_MINUTE, start + bin - 1);
    const goals = goalsPerBin[i];
    const occCount = occupancyEvents[i].size;
    const share = sampleGoals > 0 ? goals / sampleGoals : 0;
    bins.push({
      binStart: start,
      binEnd: end,
      goals,
      goalsPerMatch: completeMatches > 0 ? goals / completeMatches : 0,
      sharePct: share,
      occupancy: completeMatches > 0 ? occCount / completeMatches : 0,
      atRisk: completeMatches,
      ci: wilsonCI(occCount, completeMatches),
    });
    sharePctByBin.push(share);
  }
  return { bins, sharePctByBin };
}

// ── §4.2 firstGoal — discrete KM (no censoring) ─────────────────────────────

interface KMPoint {
  minute: number;
  s: number;
  ci: [number, number];
}
interface FirstGoal {
  km: KMPoint[];
  median: number | null;
  denom: number;
}

// First goal minute within a half for an event (excluding interval/left-censored goals),
// or null if the event had no clean goal in that half.
function firstGoalMinute(ev: EventModel, half: Half): number | null {
  let best: number | null = null;
  for (const g of ev.goals) {
    if (g.half !== half) continue;
    if (g.intervalCensored || g.leftCensored || g.overflowMinute) continue;
    if (best === null || g.minute < best) best = g.minute;
  }
  return best;
}

function computeFirstGoal(events: EventModel[], half: Half): FirstGoal {
  // Denominator: H1 = all complete matches; H2 = events that reached H2.
  const pool = half === 'H2' ? events.filter((e) => e.reachedH2) : events;
  const denom = pool.length;
  const firstMinutes = pool.map((e) => firstGoalMinute(e, half)); // null = no first goal in half

  const km: KMPoint[] = [];
  let median: number | null = null;
  for (let t = 1; t <= CAP_MINUTE; t++) {
    // S(t) = fraction of matches whose first-goal-in-half > t (or never occurred).
    let survivors = 0;
    for (const m of firstMinutes) {
      if (m === null || m > t) survivors += 1;
    }
    const s = denom > 0 ? survivors / denom : 1;
    km.push({ minute: t, s, ci: wilsonCI(survivors, denom) });
    if (median === null && s <= 0.5) median = t;
  }
  return { km, median, denom };
}

// ── §4.3 gapWithinHalf ──────────────────────────────────────────────────────

interface GapStat {
  hist: { gap: number; count: number }[];
  mean: number;
  median: number;
  iqr: [number, number];
  nIntervals: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function computeGaps(events: EventModel[], half: Half): { H1: GapStat | null; nIntervals: number } {
  const gaps: number[] = [];
  for (const ev of events) {
    // Clean goals in this half, sorted by minute, excluding interval/left-censored.
    const minutes = ev.goals
      .filter((g) => g.half === half && !g.intervalCensored && !g.leftCensored && !g.overflowMinute)
      .map((g) => g.minute)
      .sort((a, b) => a - b);
    for (let i = 1; i < minutes.length; i++) {
      gaps.push(minutes[i] - minutes[i - 1]);
    }
  }
  const nIntervals = gaps.length;
  if (nIntervals < THRESH.gapMinIntervals) {
    return { H1: null, nIntervals };
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const histMap = new Map<number, number>();
  for (const g of gaps) histMap.set(g, (histMap.get(g) ?? 0) + 1);
  const hist = Array.from(histMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([gap, count]) => ({ gap, count }));
  const mean = gaps.reduce((s, g) => s + g, 0) / nIntervals;
  return {
    H1: {
      hist,
      mean,
      median: quantile(sorted, 0.5),
      iqr: [quantile(sorted, 0.25), quantile(sorted, 0.75)],
      nIntervals,
    },
    nIntervals,
  };
}

// ── §4.4 transition — within-half conditional permutation ───────────────────

interface TransitionResult {
  enabled: boolean;
  reason?: string;
  method: string;
  simulations: number;
  seed: number;
  methodologyVersion: string;
  bins: string[];
  counts: number[][];
  expected: number[][];
  adjustedLift: (number | null)[][];
  pValue: (number | null)[][];
  qValue: (number | null)[][];
  significant: boolean[][];
  expectedMask: boolean[][];
  selfBinDeviation: { bin: string; value: number; p: number }[];
  globalMonteCarloP: number | null;
}

// One (event, half) unit contributes: its clean goal-minutes (sorted), plus the
// number of goals g. The permutation redistributes g goal-minutes across bins ∝
// baselineIntensity[half][bin].
interface HalfUnit {
  half: Half;
  binIndices: number[]; // observed clean goal bin indices, sorted by minute
}

function labelBins(bin: number): string[] {
  const nBins = binCount(bin);
  const labels: string[] = [];
  for (const half of ['H1', 'H2'] as Half[]) {
    for (let i = 0; i < nBins; i++) {
      const start = i * bin + 1;
      const end = Math.min(CAP_MINUTE, start + bin - 1);
      labels.push(`${half}:${start}-${end}`);
    }
  }
  return labels;
}

function emptyTransition(bin: number, reason: string): TransitionResult {
  const labels = labelBins(bin);
  const dim = labels.length;
  const zeros2 = () => Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  const nulls2 = () => Array.from({ length: dim }, () => new Array<number | null>(dim).fill(null));
  const falses2 = () => Array.from({ length: dim }, () => new Array<boolean>(dim).fill(false));
  const trues2 = () => Array.from({ length: dim }, () => new Array<boolean>(dim).fill(true));
  return {
    enabled: false,
    reason,
    method: 'within_half_conditional_permutation',
    simulations: PERM_R,
    seed: PERM_SEED,
    methodologyVersion: METHODOLOGY_VERSION,
    bins: labels,
    counts: zeros2(),
    expected: zeros2(),
    adjustedLift: nulls2(),
    pValue: nulls2(),
    qValue: nulls2(),
    significant: falses2(),
    expectedMask: trues2(),
    selfBinDeviation: labels.map((b) => ({ bin: b, value: 0, p: 1 })),
    globalMonteCarloP: null,
  };
}

// Global index of a (half, binIndex) cell in the flat labels array.
function cellIndex(half: Half, binIndex: number, nBins: number): number {
  return (half === 'H1' ? 0 : nBins) + binIndex;
}

// Count transitions counts[A][B] from a list of per-unit sorted bin sequences.
function countTransitions(units: { half: Half; binIndices: number[] }[], nBins: number, dim: number): number[][] {
  const counts = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  for (const u of units) {
    const seq = u.binIndices;
    for (let i = 1; i < seq.length; i++) {
      const a = cellIndex(u.half, seq[i - 1], nBins);
      const b = cellIndex(u.half, seq[i], nBins);
      counts[a][b] += 1;
    }
  }
  return counts;
}

// Weighted-choice bin index sampler ∝ weights, using rng.
function sampleBin(weights: number[], rng: () => number): number {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return Math.floor(rng() * weights.length);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function computeTransition(
  events: EventModel[],
  bin: number,
  baselineIntensity: { H1: number[]; H2: number[] },
): TransitionResult {
  const nBins = binCount(bin);
  const labels = labelBins(bin);
  const dim = labels.length;

  // Build per-(event,half) units with clean goal bin sequences.
  const units: HalfUnit[] = [];
  let totalPairs = 0;
  for (const ev of events) {
    for (const half of ['H1', 'H2'] as Half[]) {
      const clean = ev.goals
        .filter((g) => g.half === half && !g.intervalCensored && !g.leftCensored && !g.overflowMinute)
        .sort((a, b) => a.minute - b.minute)
        .map((g) => Math.min(nBins - 1, binOf(g.minute, bin).index));
      if (clean.length >= 1) {
        units.push({ half, binIndices: clean });
        if (clean.length >= 2) totalPairs += clean.length - 1;
      }
    }
  }

  // Observed counts.
  const counts = countTransitions(units, nBins, dim);

  // Gate: enough consecutive pairs to run the test at all.
  if (totalPairs < THRESH.transitionMinPairs) {
    return emptyTransition(bin, `nPairs ${totalPairs} < ${THRESH.transitionMinPairs}`);
  }

  // Null via within-half conditional permutation. Each unit keeps its goal count g
  // and horizon (half); redistribute g bins ∝ baselineIntensity[half].
  const rng = mulberry32(PERM_SEED);
  const expectedSum = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  // Per-cell null distribution of counts (for MC p-values).
  const nullDist: number[][][] = Array.from({ length: dim }, () =>
    Array.from({ length: dim }, () => new Array<number>(PERM_R).fill(0)),
  );
  // Global test-stat null distribution.
  const globalNull = new Array<number>(PERM_R).fill(0);

  for (let sim = 0; sim < PERM_R; sim++) {
    const simUnits: { half: Half; binIndices: number[] }[] = [];
    for (const u of units) {
      const g = u.binIndices.length;
      const weights = baselineIntensity[u.half];
      const drawn: number[] = [];
      for (let k = 0; k < g; k++) drawn.push(sampleBin(weights, rng));
      drawn.sort((a, b) => a - b);
      simUnits.push({ half: u.half, binIndices: drawn });
    }
    const simCounts = countTransitions(simUnits, nBins, dim);
    for (let a = 0; a < dim; a++) {
      for (let b = 0; b < dim; b++) {
        expectedSum[a][b] += simCounts[a][b];
        nullDist[a][b][sim] = simCounts[a][b];
      }
    }
  }

  const expected = expectedSum.map((row) => row.map((v) => v / PERM_R));

  // Two-sided MC p per cell: fraction of sims at least as extreme as observed
  // (|null - E| >= |obs - E|), with the standard +1 correction.
  const pValue: (number | null)[][] = Array.from({ length: dim }, () => new Array<number | null>(dim).fill(null));
  const expectedMask: boolean[][] = Array.from({ length: dim }, () => new Array<boolean>(dim).fill(true));
  const adjustedLift: (number | null)[][] = Array.from({ length: dim }, () => new Array<number | null>(dim).fill(null));

  for (let a = 0; a < dim; a++) {
    for (let b = 0; b < dim; b++) {
      const e = expected[a][b];
      expectedMask[a][b] = e < THRESH.transitionMinExpected;
      adjustedLift[a][b] = e > 0 ? counts[a][b] / e : null;
      const obsDev = Math.abs(counts[a][b] - e);
      let extreme = 0;
      const dist = nullDist[a][b];
      for (let s = 0; s < PERM_R; s++) {
        if (Math.abs(dist[s] - e) >= obsDev - 1e-9) extreme += 1;
      }
      pValue[a][b] = (extreme + 1) / (PERM_R + 1);
    }
  }

  // Recompute expected AFTER building global null so global stat uses same E.
  // globalMonteCarloP = χ²-like stat over cells with expected≥1, vs null sims.
  const globalStat = (countsArr: number[][]): number => {
    let stat = 0;
    for (let a = 0; a < dim; a++) {
      for (let b = 0; b < dim; b++) {
        const e = expected[a][b];
        if (e >= 1) stat += ((countsArr[a][b] - e) * (countsArr[a][b] - e)) / e;
      }
    }
    return stat;
  };
  const obsGlobal = globalStat(counts);
  // Reconstruct each sim's counts from nullDist to score the global stat.
  for (let sim = 0; sim < PERM_R; sim++) {
    let stat = 0;
    for (let a = 0; a < dim; a++) {
      for (let b = 0; b < dim; b++) {
        const e = expected[a][b];
        if (e >= 1) {
          const c = nullDist[a][b][sim];
          stat += ((c - e) * (c - e)) / e;
        }
      }
    }
    globalNull[sim] = stat;
  }
  let gExtreme = 0;
  for (let s = 0; s < PERM_R; s++) if (globalNull[s] >= obsGlobal - 1e-9) gExtreme += 1;
  const globalMonteCarloP = (gExtreme + 1) / (PERM_R + 1);

  // BH q-values over UNMASKED cells (expected ≥ transitionMinExpected).
  const qValue: (number | null)[][] = Array.from({ length: dim }, () => new Array<number | null>(dim).fill(null));
  const flatP: number[] = [];
  const flatPos: [number, number][] = [];
  for (let a = 0; a < dim; a++) {
    for (let b = 0; b < dim; b++) {
      if (!expectedMask[a][b] && pValue[a][b] !== null) {
        flatP.push(pValue[a][b] as number);
        flatPos.push([a, b]);
      }
    }
  }
  const qs = benjaminiHochberg(flatP);
  for (let k = 0; k < flatPos.length; k++) {
    const [a, b] = flatPos[k];
    qValue[a][b] = qs[k];
  }

  const significant: boolean[][] = Array.from({ length: dim }, () => new Array<boolean>(dim).fill(false));
  for (let a = 0; a < dim; a++) {
    for (let b = 0; b < dim; b++) {
      const q = qValue[a][b];
      significant[a][b] = expected[a][b] >= 5 && q !== null && q < 0.05;
    }
  }

  // selfBinDeviation[bin] = 1 - adjustedLift(bin,bin), descriptive label.
  const selfBinDeviation = labels.map((label, i) => {
    const lift = adjustedLift[i][i];
    return {
      bin: label,
      value: lift === null ? 0 : 1 - lift,
      p: pValue[i][i] ?? 1,
    };
  });

  return {
    enabled: true,
    method: 'within_half_conditional_permutation',
    simulations: PERM_R,
    seed: PERM_SEED,
    methodologyVersion: METHODOLOGY_VERSION,
    bins: labels,
    counts,
    expected,
    adjustedLift,
    pValue,
    qValue,
    significant,
    expectedMask,
    selfBinDeviation,
    globalMonteCarloP,
  };
}

// ── top-level orchestration ─────────────────────────────────────────────────

export interface GoalTimelineResponse {
  ok: true;
  league: League;
  days: number;
  bin: number;
  methodologyVersion: string;
  generatedAt: string;
  quality: {
    completeMatches: number;
    matchesWithGoal: number;
    matches0_0: number;
    sampleGoals: number;
    excludedInProgress: number;
    reachedH2: number;
    leftCensoredGoals: number;
    intervalCensoredGoalBatches: number;
    undercountEvents: number;
    overflowMinuteGoals: number;
    rarePeriodRows: number;
    unclassified20pEvents: number;
    sourceCoverageStart: string | null;
    sourceCoverageEnd: string | null;
    completeThrough: string | null;
    thin: boolean;
  };
  perHalf: {
    H1: { distribution: DistBin[]; firstGoal: FirstGoal | null };
    H2: { distribution: DistBin[]; firstGoal: FirstGoal | null };
  };
  gapWithinHalf: { H1: GapStat | null; H2: GapStat | null };
  transition: TransitionResult;
  caveats: string[];
}

export interface RawInput {
  // Provide exactly one, matching the league's source.
  oddsRows?: OddsRawRow[];
  tickRows?: TickRawRow[];
  // Optional pre-computed coverage window (route knows the window boundaries).
  sourceCoverageStart?: string | null;
  sourceCoverageEnd?: string | null;
  completeThrough?: string | null;
  // 20p_asian: count of '20p' events that couldn't be classified (expected 0).
  unclassified20pEvents?: number;
}

const CAVEATS = [
  'Phút ảo per-hiệp 1..~50; phút provider, không phải phút thực tế.',
  'Intl (20p_intl) mẫu mỏng — phân phối sớm chỉ mang tính tham khảo.',
  'Undercount bàn sát nhau <1.5%; batch Δ>1 bị loại khỏi first-goal/gap/transition.',
];

export function buildGoalTimeline(input: RawInput, params: BuildParams): GoalTimelineResponse {
  const q: QualityCounters = {
    leftCensoredGoals: 0,
    intervalCensoredGoalBatches: 0,
    undercountEvents: 0,
    overflowMinuteGoals: 0,
    rarePeriodRows: 0,
    unclassified20pEvents: input.unclassified20pEvents ?? 0,
  };

  let events: EventModel[];
  if (params.league === '20p_intl') {
    events = buildEventsFromTicks(input.tickRows ?? [], q);
  } else {
    events = buildEventsFromOdds(input.oddsRows ?? [], q);
  }

  // Cohort = all built events (the route already filtered to the completed window).
  const complete = events; // in-progress exclusion is applied in the route's query window
  const completeMatches = complete.length;
  const matches0_0 = complete.filter((e) => e.goalless).length;
  const matchesWithGoal = completeMatches - matches0_0;
  const reachedH2 = complete.filter((e) => e.reachedH2).length;
  let sampleGoals = 0;
  for (const e of complete) sampleGoals += e.goals.length;

  // Distributions per half (also yields sharePct → baselineIntensity for transition).
  const distH1 = computeDistribution(complete, 'H1', params.bin);
  const distH2 = computeDistribution(complete, 'H2', params.bin);

  // firstGoal — gated by completeMatches ≥ survivalMinMatches.
  const firstGoalH1 = completeMatches >= THRESH.survivalMinMatches ? computeFirstGoal(complete, 'H1') : null;
  const firstGoalH2 = completeMatches >= THRESH.survivalMinMatches ? computeFirstGoal(complete, 'H2') : null;

  // gapWithinHalf — gated per half by nIntervals ≥ gapMinIntervals (handled inside).
  const gapH1 = computeGaps(complete, 'H1').H1;
  const gapH2 = computeGaps(complete, 'H2').H1;

  // transition — baselineIntensity = sharePct per bin per half (§4.1).
  const transition = computeTransition(complete, params.bin, {
    H1: distH1.sharePctByBin,
    H2: distH2.sharePctByBin,
  });

  const thin = completeMatches < THRESH.survivalMinMatches;

  return {
    ok: true,
    league: params.league,
    days: params.days,
    bin: params.bin,
    methodologyVersion: METHODOLOGY_VERSION,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    quality: {
      completeMatches,
      matchesWithGoal,
      matches0_0,
      sampleGoals,
      excludedInProgress: 0,
      reachedH2,
      leftCensoredGoals: q.leftCensoredGoals,
      intervalCensoredGoalBatches: q.intervalCensoredGoalBatches,
      undercountEvents: q.undercountEvents,
      overflowMinuteGoals: q.overflowMinuteGoals,
      rarePeriodRows: q.rarePeriodRows,
      unclassified20pEvents: q.unclassified20pEvents,
      sourceCoverageStart: input.sourceCoverageStart ?? null,
      sourceCoverageEnd: input.sourceCoverageEnd ?? null,
      completeThrough: input.completeThrough ?? null,
      thin,
    },
    perHalf: {
      H1: { distribution: distH1.bins, firstGoal: firstGoalH1 },
      H2: { distribution: distH2.bins, firstGoal: firstGoalH2 },
    },
    gapWithinHalf: { H1: gapH1, H2: gapH2 },
    transition,
    caveats: CAVEATS,
  };
}
