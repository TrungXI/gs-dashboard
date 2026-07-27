// context.mjs — EntryContext builder (SPEC §4.4). ANTI-LOOK-AHEAD CRITICAL.
//
// Given an event and an opportunity index, build the ctx a strategy sees. The
// ctx MUST contain ONLY data at or before the opportunity snapshot:
//   - the current snapshot's own fields,
//   - `history[]` = strictly-earlier snapshots in the same event,
//   - `priors` = aggregates from events with match_date < this event's date.
// It NEVER contains finalTotal, and NEVER reads any snapshot at index > the
// opportunity index. test/lookahead.test.mjs proves both invariants.
import { config } from './config.mjs';

// elapsedMinutes(ctx-ish) — minutes elapsed since kickoff.
//   H1: elapsed = minute.
//   H2: elapsed = half1Duration + minute, where half1Duration comes from
//       config.HALF_SPLIT (16p -> 8, 20p -> 10).
// minutesRemaining = MATCH_DURATION[type] - elapsed (floored at 0).
export function elapsedMinutes({ matchType, isH2, minute }) {
  const half1 = config.HALF_SPLIT[matchType] ?? 8;
  return isH2 ? half1 + minute : minute;
}

export function minutesRemaining({ matchType, isH2, minute }) {
  const dur = config.MATCH_DURATION[matchType] ?? 16;
  const elapsed = elapsedMinutes({ matchType, isH2, minute });
  return Math.max(0, dur - elapsed);
}

// Build EntryContext for event.opportunities[oppPos].
export function buildContext(event, opp) {
  const idx = opp.index;
  const snap = event.snapshots[idx];

  // history = strictly-earlier snapshots (indices 0..idx-1). Because snapshots
  // are sorted recorded_at ASC, index < idx <=> recorded_at earlier (or equal
  // recorded_at but earlier in the stable order — still not "future").
  const history = [];
  for (let i = 0; i < idx; i++) {
    const s = event.snapshots[i];
    // Only surface fields allowed in ctx.history (SPEC §4.4). Carry the row's
    // own ouLine if present; leave null if that snapshot had no line.
    history.push({
      minute: s.minute,
      isH2: s.isH2,
      scoreHome: s.scoreHome,
      scoreAway: s.scoreAway,
      ouLine: parseHistLine(s.ouLineRaw),
      overPrice: s.overPrice,
      underPrice: s.underPrice,
      redHome: s.redHome,
      redAway: s.redAway,
      cornersHome: s.cornersHome,
      cornersAway: s.cornersAway,
      recordedAt: s.recordedAt, // used ONLY by lookahead test / bet ordering
    });
  }

  const scoredAtEntry = snap.scoreHome + snap.scoreAway;
  const ctx = {
    eventId: event.eventId,
    matchType: event.matchType,
    snapshotType: snap.snapshotType, // entry-marker for the G families
    minute: snap.minute,
    isH2: snap.isH2,
    scoreHome: snap.scoreHome,
    scoreAway: snap.scoreAway,
    scoredAtEntry,
    ouLine: opp.ouLine,
    overPrice: snap.overPrice,
    underPrice: snap.underPrice,
    lineCarried: opp.lineCarried,
    redHome: snap.redHome,
    redAway: snap.redAway,
    yellowHome: snap.yellowHome,
    yellowAway: snap.yellowAway,
    cornersHome: snap.cornersHome,
    cornersAway: snap.cornersAway,
    minutesRemaining: minutesRemaining(snap),
    elapsed: elapsedMinutes(snap),
    neededToTai: opp.ouLine - scoredAtEntry,
    // H1 total goals when H1 CLOSED. Set only if H1 is already over at this
    // snapshot; null otherwise. Derived from H1 score, NEVER from finalTotal.
    h1Total: deriveH1Total(snap, event.snapshots, idx, scoredAtEntry),
    // League/variant key for leak-free prior lookup (no hardcoded value).
    leagueTag: event.leagueTag,
    history,
    priors: event.priors,
    // recordedAt is exposed for bet ordering (drawdown / pnlByBucket) and for
    // the lookahead test — it is NOT the current snapshot's future.
    recordedAt: snap.recordedAt,
    matchDate: event.matchDate,
  };
  return ctx;
}

// deriveH1Total — ANTI-LOOK-AHEAD CRITICAL.
// Returns the H1 total goals ONLY when H1 has already closed at the current
// snapshot; null otherwise. Two safe sources, both at/before the snapshot:
//   - if the current snapshot is kickoff_h2, its own score IS the H1 total
//     (kickoff_h2 fires right after H1 ends with the H1 result on the board);
//   - else if the current snapshot is in H2 (isH2===true), scan the PRIOR
//     snapshots (indices < idx) for the last is_h2===false row and take its
//     score.
// For first_seen / kickoff_h1 / goal_h1 (H1 not closed) -> null.
// It NEVER reads finalTotal or any future (index > idx) snapshot.
function deriveH1Total(snap, snapshots, idx, scoredAtEntry) {
  if (snap.snapshotType === 'kickoff_h2') {
    return scoredAtEntry; // score at kickoff_h2 = H1 total
  }
  if (snap.isH2 === true) {
    for (let i = idx - 1; i >= 0; i--) {
      const s = snapshots[i];
      if (s.isH2 === false) return s.scoreHome + s.scoreAway;
    }
    // In H2 but no captured H1 row before this one -> unknown, be safe.
    return null;
  }
  return null; // H1 not closed yet
}

function parseHistLine(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '' || s.toLowerCase() === 'null') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
