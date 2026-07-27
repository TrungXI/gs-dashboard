// dataset.mjs — raw rows -> Event[], train/holdout split, leak-free priors.
//
// Anti-look-ahead lives here and in context.mjs:
//   - finalTotal is computed once per event (max scored over all rows) and is
//     ONLY used at settlement time, never handed to a strategy.
//   - priors for an event dated D are built from events with match_date < D
//     STRICTLY. Same-day events are buffered and only folded into the running
//     aggregate when the harness advances to a later date (SPEC §4.5).
import { parseMalay } from './malay.mjs';

// Normalize a Postgres date to a YYYY-MM-DD day key (stable, tz-independent
// ordering). match_date is a DATE column; pg returns a Date at local midnight.
export function dayKey(d) {
  if (d === null || d === undefined) return null;
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Build one snapshot object (parsed) from a raw row.
function toSnapshot(r) {
  return {
    eventId: r.event_id,
    matchType: r.match_type,
    snapshotType: r.snapshot_type,
    minute: r.minute == null ? 0 : Number(r.minute),
    isH2: !!r.is_h2,
    scoreHome: r.score_home == null ? 0 : Number(r.score_home),
    scoreAway: r.score_away == null ? 0 : Number(r.score_away),
    suspended: !!r.suspended,
    bettingOpen: r.betting_open == null ? true : !!r.betting_open,
    // ou_line stored as text; may be null on some goal rows.
    ouLineRaw: r.ou_line,
    overPrice: parseMalay(r.ou_over),
    underPrice: parseMalay(r.ou_under),
    redHome: r.red_home == null ? 0 : Number(r.red_home),
    redAway: r.red_away == null ? 0 : Number(r.red_away),
    yellowHome: r.yellow_home == null ? 0 : Number(r.yellow_home),
    yellowAway: r.yellow_away == null ? 0 : Number(r.yellow_away),
    cornersHome: r.corners_home == null ? 0 : Number(r.corners_home),
    cornersAway: r.corners_away == null ? 0 : Number(r.corners_away),
    recordedAt: r.recorded_at instanceof Date ? r.recorded_at : new Date(r.recorded_at),
  };
}

// Parse an absolute OU line from text -> number, or null if unusable.
function parseLine(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '' || s.toLowerCase() === 'null') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

// Assemble events from ordered rows. Only H2-reaching events are settle-able.
export function assembleEvents(rows) {
  const byEvent = new Map();
  for (const r of rows) {
    const id = r.event_id;
    if (!byEvent.has(id)) byEvent.set(id, []);
    byEvent.get(id).push(r);
  }

  const events = [];
  let lockedSkipped = 0; // usable-line+price snapshots dropped because locked
  for (const [eventId, raw] of byEvent) {
    // rows already ORDER BY recorded_at ASC per event from the query, but sort
    // defensively to guarantee the anti-look-ahead invariant.
    raw.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
    const snapshots = raw.map(toSnapshot);

    const reachesH2 = snapshots.some((s) => s.isH2);
    if (!reachesH2) continue; // not settle-able

    const finalTotal = snapshots.reduce(
      (mx, s) => Math.max(mx, s.scoreHome + s.scoreAway),
      0,
    );

    const first = raw[0];
    const matchDate = dayKey(first.match_date);

    // Entry opportunities: each snapshot with a usable ou_line (direct, or the
    // last-known non-null line carried forward from a strictly earlier row).
    //
    // REALISM: only OPEN snapshots (betting_open === true) are entry-able —
    // when the book locks (~68% of snapshots overall, ~88% right on a goal) the
    // live bot CANNOT place a bet, so the backtest must not either. We ONLY gate
    // ENTRY here. History/priors are unaffected: context.history still reads
    // every prior snapshot (incl. locked ones) so drift/oscillation strategies
    // see the same information the live bot sees — they just cannot act while
    // locked. lastKnownLine also updates from locked rows (the line is visible
    // even when you can't bet it).
    let lastKnownLine = null;
    const opportunities = [];
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const direct = parseLine(snap.ouLineRaw);
      let ouLine = direct;
      let lineCarried = false;
      if (ouLine === null) {
        if (lastKnownLine === null) {
          // no earlier non-null line -> skip this opportunity entirely
          continue;
        }
        ouLine = lastKnownLine;
        lineCarried = true;
      } else {
        lastKnownLine = direct;
      }
      // Prices must exist to settle Malay PnL; skip if either is unparseable.
      if (snap.overPrice === null || snap.underPrice === null) continue;
      // A snapshot with a usable line + prices, but LOCKED -> would-be entry the
      // live bot cannot take. Count it for transparency, then skip.
      if (snap.bettingOpen !== true) {
        lockedSkipped++;
        continue;
      }
      opportunities.push({ index: i, ouLine, lineCarried });
    }

    events.push({
      eventId,
      matchType: first.match_type,
      homeTeam: first.home_team,
      awayTeam: first.away_team,
      homeTeamId: first.home_team_id,
      awayTeamId: first.away_team_id,
      matchDate, // YYYY-MM-DD day key
      snapshots,
      finalTotal, // GROUND TRUTH — settlement only, never in a context
      opportunities,
      leagueTag: leagueTagOf(first.match_type, first.home_team, first.away_team),
    });
  }
  // Attach the locked-entry tally to the returned array for the report.
  events.lockedSkipped = lockedSkipped;
  return events;
}

// leagueTag = matchType + variant suffix parsed from team names ((S)/(V)).
// It is ONLY a leak-free lookup key for base-rate priors — it carries NO
// hardcoded base-rate value. Returns e.g. '20p:V' | '16p:S', or the bare
// matchType if no variant parses, or null if matchType is unknown.
export function leagueTagOf(matchType, homeTeam, awayTeam) {
  if (!matchType) return null;
  const v = variantOf(homeTeam) || variantOf(awayTeam);
  return v ? `${matchType}:${v}` : matchType;
}

function variantOf(name) {
  if (!name) return null;
  const m = String(name).match(/\(([SV])\)/);
  return m ? m[1] : null;
}

// h1TotalOfEvent — the H1 total goals for a PRIOR event (used to build the
// h1ToH2 prior). Leak-free: takes the score at the last is_h2=false snapshot,
// or the first is_h2=true / kickoff_h2 snapshot if no H1 row exists. This reads
// only that (past-dated) event's own rows — never finalTotal. Returns null if
// H1 boundary can't be determined.
export function h1TotalOfEvent(event) {
  const snaps = event.snapshots;
  // last snapshot still in H1
  let lastH1 = null;
  for (const s of snaps) {
    if (s.isH2 === false) lastH1 = s;
  }
  if (lastH1) return lastH1.scoreHome + lastH1.scoreAway;
  // no H1 row captured -> use score at the first H2 / kickoff_h2 snapshot
  const firstH2 =
    snaps.find((s) => s.snapshotType === 'kickoff_h2') ||
    snaps.find((s) => s.isH2 === true);
  if (firstH2) return firstH2.scoreHome + firstH2.scoreAway;
  return null;
}

// Bucket an H1 total into {0..6,7} (7 = "7+").
export function h1Bucket(h1Total) {
  if (h1Total == null) return null;
  const b = Math.max(0, Math.floor(h1Total));
  return b >= 7 ? 7 : b;
}

// Split events by day into TRAIN (first trainDays) / HOLDOUT (last holdoutDays).
// Returns { train, holdout, days, trainDays, holdoutDays, boundary }.
export function splitByDate(events, trainDays, holdoutDays) {
  const days = [...new Set(events.map((e) => e.matchDate).filter(Boolean))].sort();
  const trainDaySet = new Set(days.slice(0, trainDays));
  // holdout = the last `holdoutDays` days (after the train window).
  const holdoutDaySet = new Set(days.slice(trainDays, trainDays + holdoutDays));

  const train = events.filter((e) => trainDaySet.has(e.matchDate));
  const holdout = events.filter((e) => holdoutDaySet.has(e.matchDate));

  return {
    train,
    holdout,
    days,
    trainDays: [...trainDaySet].sort(),
    holdoutDays: [...holdoutDaySet].sort(),
  };
}

// -----------------------------------------------------------------------------
// Leak-free priors. For each event dated D, priors are built ONLY from events
// with match_date < D (strict). We iterate days in order, and BEFORE processing
// a day's events we snapshot the running aggregate (which contains only earlier
// days). Same-day events are folded in AFTER the whole day is assigned, so no
// event ever sees itself or its same-day siblings. (SPEC §4.5)
//
// We attach `event.priors` in place. Priors object shape:
//   { baseRateByType: { '16p': BaseRate, '20p': BaseRate },
//     h2h: { [pairKey]: { mean, count } | absent } }
// BaseRate exposes .mean, .n, and .pOver(line) via an empirical CDF of finalTotal.
// -----------------------------------------------------------------------------

function makeBaseRate(totals) {
  const sorted = [...totals].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, x) => s + x, 0);
  const mean = n > 0 ? sum / n : 0;
  return {
    n,
    mean,
    // Empirical P(finalTotal > line).
    pOver(line) {
      if (n === 0) return null;
      let over = 0;
      for (const t of sorted) if (t > line) over++;
      return over / n;
    },
  };
}

export function attachPriors(events, h2hMinMeetings, h1h2MinN = 50) {
  // Group events by day, days in chronological order.
  const byDay = new Map();
  for (const e of events) {
    if (!e.matchDate) continue;
    if (!byDay.has(e.matchDate)) byDay.set(e.matchDate, []);
    byDay.get(e.matchDate).push(e);
  }
  const orderedDays = [...byDay.keys()].sort();

  // Running aggregates over STRICTLY-earlier days only.
  const totalsByType = { '16p': [], '20p': [] };
  const totalsByLeague = new Map(); // leagueTag -> array of finalTotal
  const h2hAcc = new Map(); // pairKey -> { sum, count }
  // h1ToH2: per H1-bucket, accumulate finalTotal values (for CDF) + h2 sums.
  const h1h2Acc = new Map(); // bucket(0..7) -> { finals: number[], sumH2 }

  for (const day of orderedDays) {
    const dayEvents = byDay.get(day);

    // Snapshot current aggregates -> priors for THIS day's events.
    const base16 = makeBaseRate(totalsByType['16p']);
    const base20 = makeBaseRate(totalsByType['20p']);
    const h1ToH2 = makeH1ToH2(h1h2Acc, h1h2MinN);

    for (const e of dayEvents) {
      const h2hMap = {};
      const key = pairKey(e.homeTeamId, e.awayTeamId);
      const acc = h2hAcc.get(key);
      if (acc && acc.count >= h2hMinMeetings) {
        h2hMap[key] = { mean: acc.sum / acc.count, count: acc.count };
      }
      // League base-rate (leak-free): snapshot the running totals for this tag.
      const leagueTotals = totalsByLeague.get(e.leagueTag) || [];
      e.priors = {
        baseRateByType: { '16p': base16, '20p': base20 },
        baseRateByLeague: makeBaseRate(leagueTotals),
        h2h: h2hMap,
        pairKey: key,
        h1ToH2,
      };
    }

    // AFTER assigning priors for the whole day, fold the day into the running
    // aggregate so tomorrow's events (strictly later) can see it.
    for (const e of dayEvents) {
      if (e.matchType === '16p' || e.matchType === '20p') {
        totalsByType[e.matchType].push(e.finalTotal);
      }
      if (e.leagueTag) {
        const arr = totalsByLeague.get(e.leagueTag) || [];
        arr.push(e.finalTotal);
        totalsByLeague.set(e.leagueTag, arr);
      }
      const key = pairKey(e.homeTeamId, e.awayTeamId);
      const acc = h2hAcc.get(key) || { sum: 0, count: 0 };
      acc.sum += e.finalTotal;
      acc.count += 1;
      h2hAcc.set(key, acc);

      // Fold into the H1->H2 aggregate (bucket by this event's own H1 total).
      const h1 = h1TotalOfEvent(e);
      const bkt = h1Bucket(h1);
      if (bkt !== null) {
        const a = h1h2Acc.get(bkt) || { finals: [], sumH2: 0 };
        a.finals.push(e.finalTotal);
        a.sumH2 += e.finalTotal - h1; // actual H2 goals of this past event
        h1h2Acc.set(bkt, a);
      }
    }
  }
  return events;
}

// Build the h1ToH2 prior API by SNAPSHOTTING the running accumulator now.
// Leak-free & frozen-at-assignment: it copies the current per-bucket
// {count,sumH2,finals} so later folds (same-day / future days) cannot bleed in
// — mirroring makeBaseRate's copy-on-build behavior.
// expFinal(h1Total)   = h1Total + meanH2[bucket]  (continuation expectation)
// pOverFinal(h1,line) = empirical P(finalTotal > line) from the bucket's frozen
//                       finalTotal histogram (½ on exact whole-line). Returns
//                       null when the bucket has < minN samples -> strategy PASS.
function makeH1ToH2(acc, minN) {
  // frozen deep-ish copy of the accumulator at build time
  const snap = new Map();
  for (const [bkt, a] of acc) {
    snap.set(bkt, { finals: a.finals.slice(), sumH2: a.sumH2 });
  }
  return {
    minN,
    count(h1Total) {
      const b = h1Bucket(h1Total);
      if (b === null) return 0;
      const a = snap.get(b);
      return a ? a.finals.length : 0;
    },
    expFinal(h1Total) {
      const b = h1Bucket(h1Total);
      if (b === null) return null;
      const a = snap.get(b);
      if (!a || a.finals.length < minN) return null;
      const meanH2 = a.sumH2 / a.finals.length;
      return h1Total + meanH2;
    },
    pOverFinal(h1Total, line) {
      const b = h1Bucket(h1Total);
      if (b === null) return null;
      const a = snap.get(b);
      if (!a || a.finals.length < minN) return null;
      const n = a.finals.length;
      let over = 0;
      let push = 0;
      for (const t of a.finals) {
        if (t > line) over++;
        else if (t === line) push++;
      }
      // ½-split the exact-line mass (whole-line push convention).
      return (over + push / 2) / n;
    },
  };
}

export function pairKey(a, b) {
  const x = a == null ? 0 : Number(a);
  const y = b == null ? 0 : Number(b);
  return x <= y ? `${x}:${y}` : `${y}:${x}`;
}
