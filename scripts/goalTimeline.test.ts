// goalTimeline.test.ts — pure-function fixtures for the Timeline Ghi Bàn lib (§7).
//
// Run:  node --test scripts/goalTimeline.test.ts
// (Node ≥23 strips TS types natively — no tsx/ts-node needed. Repo is on Node 24.)
//
// Seven required cases: dedupe, interval-censored, left-censored, goalless, KM,
// permutation determinism + BH monotonicity, flicker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoalTimeline,
  benjaminiHochberg,
  wilsonCI,
  mulberry32,
  type OddsRawRow,
  type TickRawRow,
  type BuildParams,
} from '../src/lib/goalTimeline.ts';

const P: BuildParams = { league: '16p', days: 14, bin: 5, generatedAt: '2026-01-01T00:00:00.000Z' };

// Helper to synthesise odds_log rows for one event.
function oddsRow(o: Partial<OddsRawRow> & { event_id: number; snapshot_type: string }): OddsRawRow {
  return {
    period: 2,
    minute: 10,
    is_h2: false,
    score_home: 0,
    score_away: 0,
    recorded_at: '2026-01-01T00:00:00Z',
    ...o,
  };
}

// ── §7.1 dedupe: 2 rows same (event,half,score) → 1 goal, keep earliest ──────
test('dedupe: duplicate goal rows collapse to one, earliest kept', () => {
  const rows: OddsRawRow[] = [
    oddsRow({ event_id: 1, snapshot_type: 'first_seen', period: 2, minute: 1, score_home: 0, score_away: 0, recorded_at: '2026-01-01T00:00:00Z' }),
    oddsRow({ event_id: 1, snapshot_type: 'goal_h1', period: 2, minute: 12, score_home: 1, score_away: 0, recorded_at: '2026-01-01T00:12:00Z' }),
    // duplicate of the same goal, later timestamp + drifted minute → must be dropped
    oddsRow({ event_id: 1, snapshot_type: 'goal_h1', period: 2, minute: 13, score_home: 1, score_away: 0, recorded_at: '2026-01-01T00:12:30Z' }),
    oddsRow({ event_id: 1, snapshot_type: 'kickoff_h2', period: 8, minute: 1, score_home: 1, score_away: 0, recorded_at: '2026-01-01T00:20:00Z' }),
  ];
  const res = buildGoalTimeline({ oddsRows: rows }, P);
  assert.equal(res.quality.completeMatches, 1);
  assert.equal(res.quality.sampleGoals, 1, 'duplicate goal should collapse to 1');
  assert.equal(res.quality.matches0_0, 0);
  assert.equal(res.quality.matchesWithGoal, 1);
  // undercount must NOT fire (1 goal == maxTotal 1)
  assert.equal(res.quality.undercountEvents, 0);
  // The kept goal has the earliest minute (12), so H1 bin [11-15] has 1 goal.
  const h1bin = res.perHalf.H1.distribution.find((b) => b.binStart === 11);
  assert.ok(h1bin && h1bin.goals === 1);
});

// ── §7.2 interval-censored: goal jumps +2 → flagged, excluded from gap/transition ─
test('interval-censored: +2 jump increments counter and is flagged', () => {
  const rows: OddsRawRow[] = [
    oddsRow({ event_id: 2, snapshot_type: 'first_seen', period: 2, minute: 1, score_home: 0, score_away: 0, recorded_at: '2026-01-01T00:00:00Z' }),
    oddsRow({ event_id: 2, snapshot_type: 'goal_h1', period: 2, minute: 20, score_home: 2, score_away: 0, recorded_at: '2026-01-01T00:20:00Z' }),
  ];
  const res = buildGoalTimeline({ oddsRows: rows }, P);
  assert.equal(res.quality.intervalCensoredGoalBatches, 1, 'a +2 step is one censored batch');
  // distribution still counts the goal row (with the flag upstream); sampleGoals=1
  assert.equal(res.quality.sampleGoals, 1);
  // gap needs ≥2 clean goals → this event yields none, and it's below the gate anyway
  assert.equal(res.gapWithinHalf.H1, null);
});

// ── §7.3 left-censored (ticks): first tick total>0 → counted, excluded from first ─
test('left-censored ticks: first tick already >0', () => {
  const rows: TickRawRow[] = [
    { event_id: 3, period: 2, minute: 8, is_h2: false, score_home: 1, score_away: 0, recorded_at: '2026-01-01T00:08:00Z' },
    { event_id: 3, period: 2, minute: 15, is_h2: false, score_home: 2, score_away: 0, recorded_at: '2026-01-01T00:15:00Z' },
    { event_id: 3, period: 8, minute: 1, is_h2: true, score_home: 2, score_away: 0, recorded_at: '2026-01-01T00:22:00Z' },
  ];
  const res = buildGoalTimeline({ tickRows: rows }, { ...P, league: '20p_intl' });
  assert.equal(res.quality.leftCensoredGoals, 1, 'one goal was on record before first tick');
  // maxTotal = 2 → not goalless
  assert.equal(res.quality.matches0_0, 0);
  // First-goal KM (if it ran) must not place the left-censored first goal — but with
  // n=1 the survival gate is below threshold, so firstGoal is null.
  assert.equal(res.perHalf.H1.firstGoal, null);
  // The second (clean) goal at minute 15 is still a sample goal.
  assert.ok(res.quality.sampleGoals >= 1);
});

// ── §7.4 goalless: max total 0 → matches0_0, NOT undercount ──────────────────
test('goalless: event with maxTotal 0 counts as 0-0, not undercount', () => {
  const rows: OddsRawRow[] = [
    oddsRow({ event_id: 4, snapshot_type: 'first_seen', period: 2, minute: 1, score_home: 0, score_away: 0, recorded_at: '2026-01-01T00:00:00Z' }),
    oddsRow({ event_id: 4, snapshot_type: 'kickoff_h2', period: 8, minute: 1, score_home: 0, score_away: 0, recorded_at: '2026-01-01T00:20:00Z' }),
  ];
  const res = buildGoalTimeline({ oddsRows: rows }, P);
  assert.equal(res.quality.completeMatches, 1);
  assert.equal(res.quality.matches0_0, 1);
  assert.equal(res.quality.matchesWithGoal, 0);
  assert.equal(res.quality.sampleGoals, 0);
  assert.equal(res.quality.undercountEvents, 0, 'goalless is NOT undercount');
  assert.equal(res.quality.reachedH2, 1);
});

// ── §7.5 KM: hand-computed survival; case with no S≤0.5 → median null ─────────
test('KM discrete: survival curve matches hand calc + median null when S never ≤0.5', () => {
  // 120 complete matches, all with an H1 first goal at minute 30 → after t≥30, S=0.
  // Median exists (S drops to 0 at t=30). To force median=null we instead make only
  // 40/120 score in H1 → S(t) never drops to ≤0.5.
  const rows: OddsRawRow[] = [];
  const N = 120;
  const SCORERS = 40; // < half → survival floors at 80/120 = 0.667 > 0.5
  for (let i = 0; i < N; i++) {
    const ev = 1000 + i;
    rows.push(oddsRow({ event_id: ev, snapshot_type: 'first_seen', period: 2, minute: 1, score_home: 0, score_away: 0, recorded_at: `2026-01-01T00:00:0${i % 10}Z` }));
    if (i < SCORERS) {
      rows.push(oddsRow({ event_id: ev, snapshot_type: 'goal_h1', period: 2, minute: 30, score_home: 1, score_away: 0, recorded_at: '2026-01-01T00:30:00Z' }));
    }
    rows.push(oddsRow({ event_id: ev, snapshot_type: 'kickoff_h2', period: 8, minute: 1, score_home: i < SCORERS ? 1 : 0, score_away: 0, recorded_at: '2026-01-01T00:40:00Z' }));
  }
  const res = buildGoalTimeline({ oddsRows: rows }, P);
  const fg = res.perHalf.H1.firstGoal;
  assert.ok(fg, 'survival gate met at n=120');
  // At t=1..29 no first goal has happened yet → S=1.
  assert.equal(fg!.km[0].s, 1);
  assert.equal(fg!.km[28].minute, 29);
  assert.equal(fg!.km[28].s, 1);
  // At t=30 the 40 scorers drop out → S = 80/120.
  const s30 = fg!.km.find((k) => k.minute === 30)!;
  assert.ok(Math.abs(s30.s - 80 / 120) < 1e-9, `S(30) should be 80/120, got ${s30.s}`);
  // Never ≤0.5 → median null.
  assert.equal(fg!.median, null);
  assert.equal(fg!.denom, 120);
});

// ── §7.6 permutation determinism + BH monotonic ─────────────────────────────
test('permutation determinism: same seed → identical expected snapshot', () => {
  // Build a dataset large enough to pass the transition gate (≥300 pairs).
  const rows: OddsRawRow[] = [];
  let ev = 5000;
  // 200 events, each with 3 H1 goals at minutes 5,15,35 → 2 pairs/event = 400 pairs.
  for (let i = 0; i < 200; i++) {
    const e = ev++;
    rows.push(oddsRow({ event_id: e, snapshot_type: 'first_seen', period: 2, minute: 1, score_home: 0, score_away: 0, recorded_at: '2026-01-01T00:00:00Z' }));
    rows.push(oddsRow({ event_id: e, snapshot_type: 'goal_h1', period: 2, minute: 5, score_home: 1, score_away: 0, recorded_at: '2026-01-01T00:05:00Z' }));
    rows.push(oddsRow({ event_id: e, snapshot_type: 'goal_h1', period: 2, minute: 15, score_home: 2, score_away: 0, recorded_at: '2026-01-01T00:15:00Z' }));
    rows.push(oddsRow({ event_id: e, snapshot_type: 'goal_h1', period: 2, minute: 35, score_home: 3, score_away: 0, recorded_at: '2026-01-01T00:35:00Z' }));
  }
  const a = buildGoalTimeline({ oddsRows: rows }, P);
  const b = buildGoalTimeline({ oddsRows: rows }, P);
  assert.equal(a.transition.enabled, true);
  assert.deepEqual(a.transition.expected, b.transition.expected, 'deterministic expected across runs');
  assert.deepEqual(a.transition.counts, b.transition.counts);
  assert.equal(a.transition.seed, 0x9e3779b9);
  assert.equal(a.transition.simulations, 2000);
});

test('mulberry32 determinism: same seed → same stream', () => {
  const r1 = mulberry32(0x9e3779b9);
  const r2 = mulberry32(0x9e3779b9);
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
});

test('BH q-values are monotone non-decreasing in sorted p order', () => {
  const p = [0.001, 0.008, 0.02, 0.03, 0.9];
  const q = benjaminiHochberg(p);
  // Sort by p, q must be non-decreasing.
  const paired = p.map((pv, i) => ({ pv, qv: q[i] })).sort((x, y) => x.pv - y.pv);
  for (let i = 1; i < paired.length; i++) {
    assert.ok(paired[i].qv >= paired[i - 1].qv - 1e-12, 'q monotone in p');
    assert.ok(paired[i].qv <= 1 + 1e-12);
  }
  // Largest p → q = p (BH boundary).
  assert.ok(Math.abs(paired[paired.length - 1].qv - 0.9) < 1e-9);
});

// ── §7.7 flicker ticks: total dips 1 then reverts → NOT counted as a goal ─────
test('flicker ticks: single-tick dip that reverts is not a goal', () => {
  const rows: TickRawRow[] = [
    { event_id: 6, period: 2, minute: 41, is_h2: false, score_home: 0, score_away: 1, recorded_at: '2026-01-01T00:09:02Z' },
    { event_id: 6, period: 2, minute: 42, is_h2: false, score_home: 1, score_away: 1, recorded_at: '2026-01-01T00:09:05Z' }, // real goal → total 2
    { event_id: 6, period: 2, minute: 41, is_h2: false, score_home: 0, score_away: 1, recorded_at: '2026-01-01T00:09:08Z' }, // flicker dip → total 1
    { event_id: 6, period: 2, minute: 42, is_h2: false, score_home: 1, score_away: 1, recorded_at: '2026-01-01T00:09:11Z' }, // corrected → total 2
    { event_id: 6, period: 8, minute: 1, is_h2: true, score_home: 1, score_away: 1, recorded_at: '2026-01-01T00:22:00Z' },
  ];
  const res = buildGoalTimeline({ tickRows: rows }, { ...P, league: '20p_intl' });
  // First tick already had total 1 → 1 left-censored; the flicker+recover must NOT
  // add a spurious extra goal. maxTotal = 2, so exactly ONE derived (clean) goal at
  // minute 42, plus 1 left-censored. sampleGoals counts both goal-events.
  assert.equal(res.quality.matches0_0, 0);
  assert.equal(res.quality.leftCensoredGoals, 1);
  // The dip-and-revert must not create an interval-censored batch or extra goal.
  assert.equal(res.quality.intervalCensoredGoalBatches, 0, 'flicker must not look like a +2 jump');
  // Exactly 2 goal-events total (1 left-censored + 1 clean at min 42) → maxTotal 2.
  assert.equal(res.quality.sampleGoals, 2, 'flicker dip does not add a spurious goal');
});

// ── extra: Wilson CI sanity ─────────────────────────────────────────────────
test('wilsonCI: bounds are within [0,1] and bracket the point estimate', () => {
  const [lo, hi] = wilsonCI(5, 20);
  assert.ok(lo >= 0 && hi <= 1 && lo < 0.25 && hi > 0.25);
  assert.deepEqual(wilsonCI(0, 0), [0, 0]);
});
