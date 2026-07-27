// lookahead.test.mjs — proves the anti-look-ahead invariants of context.mjs
// and dataset priors, WITHOUT hitting the DB (synthetic events).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../context.mjs';
import { assembleEvents, attachPriors, splitByDate } from '../dataset.mjs';

// Build a synthetic raw row.
function row(o) {
  return {
    event_id: o.event_id,
    match_type: o.match_type ?? '20p',
    home_team: 'H',
    away_team: 'A',
    home_team_id: o.home_team_id ?? 1,
    away_team_id: o.away_team_id ?? 2,
    match_date: o.match_date,
    snapshot_type: o.snapshot_type ?? 'goal',
    minute: o.minute ?? 1,
    is_h2: o.is_h2 ?? false,
    score_home: o.score_home ?? 0,
    score_away: o.score_away ?? 0,
    suspended: false,
    betting_open: o.betting_open ?? true,
    ou_line: o.ou_line ?? null,
    ou_over: o.ou_over ?? '0.85',
    ou_under: o.ou_under ?? '0.85',
    ou_line_recovered: null,
    ou_line_source: null,
    yellow_home: 0,
    yellow_away: 0,
    red_home: o.red_home ?? 0,
    red_away: 0,
    corners_home: 0,
    corners_away: 0,
    recorded_at: o.recorded_at,
  };
}

test('ctx.history never contains a snapshot at/after the opportunity index', () => {
  const rows = [
    row({ event_id: 1, minute: 1, is_h2: false, score_home: 0, score_away: 0, ou_line: '3.0', match_date: '2026-07-13', recorded_at: '2026-07-13T10:00:00Z' }),
    row({ event_id: 1, minute: 5, is_h2: false, score_home: 1, score_away: 0, ou_line: '3.5', match_date: '2026-07-13', recorded_at: '2026-07-13T10:05:00Z' }),
    row({ event_id: 1, minute: 1, is_h2: true, score_home: 1, score_away: 0, ou_line: '2.5', match_date: '2026-07-13', recorded_at: '2026-07-13T10:10:00Z' }),
    row({ event_id: 1, minute: 8, is_h2: true, score_home: 2, score_away: 1, ou_line: '1.5', match_date: '2026-07-13', recorded_at: '2026-07-13T10:18:00Z' }),
  ];
  const events = assembleEvents(rows);
  assert.equal(events.length, 1);
  const ev = events[0];
  attachPriors(events, 2);

  for (const opp of ev.opportunities) {
    const ctx = buildContext(ev, opp);
    const oppTime = ev.snapshots[opp.index].recordedAt.getTime();
    // Every history row must be STRICTLY earlier in recorded_at.
    for (const h of ctx.history) {
      assert.ok(
        h.recordedAt.getTime() < oppTime,
        `history row ${h.recordedAt.toISOString()} >= opp time`,
      );
    }
    // history length must equal opp.index (all prior snapshots, none future).
    assert.equal(ctx.history.length, opp.index);
    // finalTotal must NOT leak into ctx.
    assert.equal(ctx.finalTotal, undefined);
  }
});

test('finalTotal never appears anywhere in ctx (deep scan)', () => {
  const rows = [
    row({ event_id: 2, minute: 1, is_h2: false, ou_line: '2.0', match_date: '2026-07-13', recorded_at: '2026-07-13T10:00:00Z' }),
    row({ event_id: 2, minute: 4, is_h2: true, score_home: 3, score_away: 2, ou_line: '5.0', match_date: '2026-07-13', recorded_at: '2026-07-13T10:04:00Z' }),
  ];
  const events = assembleEvents(rows);
  attachPriors(events, 2);
  const ev = events[0];
  assert.equal(ev.finalTotal, 5); // event knows it
  const ctx = buildContext(ev, ev.opportunities[0]);
  const json = JSON.stringify(ctx);
  assert.ok(!json.includes('finalTotal'), 'ctx JSON must not mention finalTotal');
  // priors present but built from < this date -> empty on the first day.
  assert.ok(ctx.priors);
});

test('priors are strictly leak-free: same-day events never see each other', () => {
  // Two events on day 1 with high totals, one event on day 2. The day-2 event
  // must see day-1 priors; the day-1 events must see EMPTY priors (n=0), not
  // each other and not themselves.
  const rows = [
    // day 1, event A: final 6
    row({ event_id: 10, is_h2: false, ou_line: '2.0', match_date: '2026-07-13', recorded_at: '2026-07-13T10:00:00Z' }),
    row({ event_id: 10, is_h2: true, score_home: 4, score_away: 2, ou_line: '2.0', match_date: '2026-07-13', recorded_at: '2026-07-13T10:05:00Z' }),
    // day 1, event B: final 5
    row({ event_id: 11, is_h2: false, ou_line: '2.0', match_date: '2026-07-13', recorded_at: '2026-07-13T11:00:00Z' }),
    row({ event_id: 11, is_h2: true, score_home: 3, score_away: 2, ou_line: '2.0', match_date: '2026-07-13', recorded_at: '2026-07-13T11:05:00Z' }),
    // day 2, event C: final 1
    row({ event_id: 12, is_h2: false, ou_line: '2.0', match_date: '2026-07-14', recorded_at: '2026-07-14T10:00:00Z' }),
    row({ event_id: 12, is_h2: true, score_home: 1, score_away: 0, ou_line: '2.0', match_date: '2026-07-14', recorded_at: '2026-07-14T10:05:00Z' }),
  ];
  const events = assembleEvents(rows);
  attachPriors(events, 2);
  const byId = new Map(events.map((e) => [e.eventId, e]));

  // Day-1 events: base rate n must be 0 (nothing strictly before day 1).
  assert.equal(byId.get(10).priors.baseRateByType['20p'].n, 0);
  assert.equal(byId.get(11).priors.baseRateByType['20p'].n, 0);

  // Day-2 event: must see BOTH day-1 events (n=2), mean = (6+5)/2 = 5.5.
  const p12 = byId.get(12).priors.baseRateByType['20p'];
  assert.equal(p12.n, 2);
  assert.ok(Math.abs(p12.mean - 5.5) < 1e-9);
  // P(final > 4) over {6,5} = 2/2 = 1.
  assert.equal(p12.pOver(4), 1);
  assert.equal(p12.pOver(5), 0.5); // only 6 > 5
});

test('splitByDate assigns first days to train, later days to holdout', () => {
  const mk = (id, date, total) => [
    row({ event_id: id, is_h2: false, ou_line: '2.0', match_date: date, recorded_at: `${date}T10:00:00Z` }),
    row({ event_id: id, is_h2: true, score_home: total, score_away: 0, ou_line: '2.0', match_date: date, recorded_at: `${date}T10:05:00Z` }),
  ];
  const rows = [
    ...mk(1, '2026-07-13', 1),
    ...mk(2, '2026-07-14', 2),
    ...mk(3, '2026-07-15', 3),
  ];
  const events = assembleEvents(rows);
  const split = splitByDate(events, 2, 1);
  assert.deepEqual(split.trainDays, ['2026-07-13', '2026-07-14']);
  assert.deepEqual(split.holdoutDays, ['2026-07-15']);
  assert.equal(split.train.length, 2);
  assert.equal(split.holdout.length, 1);
});

test('REALISM: entry opportunities exclude betting_open=false rows, but history keeps them', () => {
  // 4 snapshots: open, LOCKED (goal), LOCKED (goal), open. Only the 2 OPEN
  // snapshots are entry-able; but the ctx built at the last (open) snapshot must
  // still have all 3 prior snapshots in history (incl. the 2 locked ones), so
  // drift/oscillation strategies see the same info the live bot sees.
  const rows = [
    row({ event_id: 1, minute: 1, is_h2: false, betting_open: true, ou_line: '3.0', match_date: '2026-07-13', recorded_at: '2026-07-13T10:00:00Z' }),
    row({ event_id: 1, minute: 5, is_h2: false, betting_open: false, score_home: 1, ou_line: '3.5', match_date: '2026-07-13', recorded_at: '2026-07-13T10:05:00Z' }),
    row({ event_id: 1, minute: 1, is_h2: true, betting_open: false, score_home: 1, ou_line: '2.5', match_date: '2026-07-13', recorded_at: '2026-07-13T10:10:00Z' }),
    row({ event_id: 1, minute: 8, is_h2: true, betting_open: true, score_home: 2, ou_line: '1.5', match_date: '2026-07-13', recorded_at: '2026-07-13T10:18:00Z' }),
  ];
  const events = assembleEvents(rows);
  const ev = events[0];

  // Only the 2 OPEN snapshots (indices 0 and 3) are opportunities.
  assert.equal(ev.opportunities.length, 2);
  assert.deepEqual(ev.opportunities.map((o) => o.index).sort((a, b) => a - b), [0, 3]);
  // The 2 locked snapshots were counted as dropped-because-locked.
  assert.equal(events.lockedSkipped, 2);

  // history at the LAST opportunity (index 3) still contains all 3 prior rows,
  // including the 2 locked ones — the bot can SEE a locked line, just not bet it.
  attachPriors(events, 2);
  const lastOpp = ev.opportunities.find((o) => o.index === 3);
  const ctx = buildContext(ev, lastOpp);
  assert.equal(ctx.history.length, 3);
  // the locked rows' lines are visible in history (drift input)
  assert.deepEqual(ctx.history.map((h) => h.ouLine), [3.0, 3.5, 2.5]);
});

// ---- Generation-G: h1Total anti-look-ahead --------------------------------
import { h1TotalOfEvent, leagueTagOf } from '../dataset.mjs';

test('G: h1Total is null for every H1/pre-match snapshot, set only when H1 closed', () => {
  // event: first_seen (open) -> goal_h1 (score 1, open) -> kickoff_h2 (H1
  // closed, total 1) -> goal_h2 (score 2, H2). finalTotal=3 goals but MUST NOT
  // leak into h1Total anywhere.
  const rows = [
    row({ event_id: 1, snapshot_type: 'first_seen', is_h2: false, score_home: 0, ou_line: '3.0', match_date: '2026-07-13', recorded_at: '2026-07-13T10:00:00Z' }),
    row({ event_id: 1, snapshot_type: 'goal_h1', is_h2: false, score_home: 1, ou_line: '3.5', match_date: '2026-07-13', recorded_at: '2026-07-13T10:05:00Z' }),
    row({ event_id: 1, snapshot_type: 'kickoff_h2', is_h2: true, score_home: 1, ou_line: '2.5', match_date: '2026-07-13', recorded_at: '2026-07-13T10:10:00Z' }),
    row({ event_id: 1, snapshot_type: 'goal_h2', is_h2: true, score_home: 2, score_away: 1, ou_line: '2.5', match_date: '2026-07-13', recorded_at: '2026-07-13T10:18:00Z' }),
  ];
  const events = assembleEvents(rows);
  const ev = events[0];
  attachPriors(events, 2, 50);
  assert.equal(ev.finalTotal, 3);

  const byIdx = new Map(ev.opportunities.map((o) => [o.index, o]));
  // idx 0 first_seen: H1 not closed -> null
  assert.equal(buildContext(ev, byIdx.get(0)).h1Total, null);
  // idx 1 goal_h1 (is_h2 false, not kickoff_h2): H1 not closed -> null
  assert.equal(buildContext(ev, byIdx.get(1)).h1Total, null);
  // idx 2 kickoff_h2: h1Total = score at kickoff_h2 = 1 (NOT finalTotal 3)
  const c2 = buildContext(ev, byIdx.get(2));
  assert.equal(c2.h1Total, 1);
  assert.equal(c2.snapshotType, 'kickoff_h2');
  // idx 3 goal_h2 (H2, H1 closed): h1Total from last is_h2=false row = 1
  const c3 = buildContext(ev, byIdx.get(3));
  assert.equal(c3.h1Total, 1);
  // in NO context does h1Total equal finalTotal
  for (const o of ev.opportunities) {
    const c = buildContext(ev, o);
    assert.notEqual(c.h1Total, ev.finalTotal);
    if (c.h1Total != null) assert.ok(c.h1Total <= ev.finalTotal);
  }
});

test('G: h1TotalOfEvent (prior helper) reads H1 score, never finalTotal', () => {
  const rows = [
    row({ event_id: 9, snapshot_type: 'first_seen', is_h2: false, score_home: 2, ou_line: '3.0', match_date: '2026-07-13', recorded_at: '2026-07-13T10:00:00Z' }),
    row({ event_id: 9, snapshot_type: 'kickoff_h2', is_h2: true, score_home: 2, ou_line: '2.0', match_date: '2026-07-13', recorded_at: '2026-07-13T10:10:00Z' }),
    row({ event_id: 9, snapshot_type: 'goal_h2', is_h2: true, score_home: 4, score_away: 1, ou_line: '2.0', match_date: '2026-07-13', recorded_at: '2026-07-13T10:18:00Z' }),
  ];
  const ev = assembleEvents(rows)[0];
  assert.equal(ev.finalTotal, 5);
  assert.equal(h1TotalOfEvent(ev), 2); // last is_h2=false score, not 5
});

test('G: h1ToH2 prior is leak-free, learns runtime, returns null below min-N', () => {
  // 3 prior-day events all with H1=1 and final={3,4,5}; then a day-2 event with
  // H1=1. minN=2 so day-2 sees the prior; day-1 events see nothing.
  const mk = (id, date, h1, final) => [
    row({ event_id: id, snapshot_type: 'first_seen', is_h2: false, score_home: h1, ou_line: '2.5', match_date: date, recorded_at: `${date}T10:00:00Z` }),
    row({ event_id: id, snapshot_type: 'kickoff_h2', is_h2: true, score_home: h1, ou_line: '2.5', match_date: date, recorded_at: `${date}T10:10:00Z` }),
    row({ event_id: id, snapshot_type: 'goal_h2', is_h2: true, score_home: final, ou_line: '2.5', match_date: date, recorded_at: `${date}T10:18:00Z` }),
  ];
  const rows = [
    ...mk(1, '2026-07-13', 1, 3),
    ...mk(2, '2026-07-13', 1, 4),
    ...mk(3, '2026-07-14', 1, 5), // day 2, sees the two day-1 events
  ];
  const events = assembleEvents(rows);
  attachPriors(events, 2, 2); // H1H2_MIN_N = 2
  const byId = new Map(events.map((e) => [e.eventId, e]));

  // day-1 events: prior bucket for H1=1 is empty -> null (below min-N).
  assert.equal(byId.get(1).priors.h1ToH2.expFinal(1), null);
  // day-2 event: sees {final 3, final 4} for bucket H1=1 -> meanH2 = ((3-1)+(4-1))/2 = 2.5
  const exp = byId.get(3).priors.h1ToH2.expFinal(1);
  assert.ok(Math.abs(exp - (1 + 2.5)) < 1e-9, `expFinal=${exp}`);
  // P(final > 3) over {3,4}: 4>3 -> over 1, 3==3 -> half push -> (1 + 0.5)/2 = 0.75
  assert.ok(Math.abs(byId.get(3).priors.h1ToH2.pOverFinal(1, 3) - 0.75) < 1e-9);
  // no hardcoded number: the mean 2.5 is derived from the two priors, not a constant.
});

test('G: leagueTagOf parses (S)/(V) variant into a lookup key', () => {
  assert.equal(leagueTagOf('16p', 'Japan (S)', 'Myanmar (S)'), '16p:S');
  assert.equal(leagueTagOf('20p', 'Qatar (V)', 'India (V)'), '20p:V');
  assert.equal(leagueTagOf('20p', 'NoTag', 'AlsoNone'), '20p'); // fallback
  assert.equal(leagueTagOf(null, 'x', 'y'), null);
});
