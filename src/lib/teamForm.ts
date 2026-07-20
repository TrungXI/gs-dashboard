// Team form-rule analytics — the HONEST version (per RECONCILE.md).
//
// The research (query on real gs_matches_history) refuted several SPEC metrics:
//   - "cứ N trận thì đảo chiều" (avgRunLen-as-cycle)  → NOISE, dropped.
//   - rolling-win-rate peak "chu kỳ"                  → NOISE, dropped.
//   - trapScore "gài hàng" alert                       → dropped; H1↔H2 are
//     POSITIVELY correlated (r≈+0.29) and HT-lead → FT-win ≈82%, so there is
//     no systematic trap.
//   - "streak sẽ tiếp diễn/đảo chiều"                  → dropped; results are
//     ~independent once you condition on team identity.
//
// What survives (data-supported): last-N list, W/D/L split, fixed strength
// TIER, recent-form sparkline (labelled noisy — no cycle claim), H1-vs-H2 goal
// lean (descriptive, low-confidence flagged), and HT-lead → FT-win rate.
//
// Technique (round/pct/mean) copied from gsPatterns.ts; gsPatterns.ts is left
// untouched (it is global/home-perspective and does not fit per-team).

// ---- row & block shapes -----------------------------------------------------

export interface GsTeamHistoryRow {
  time: string;          // "dd/mm/yyyy HH:MM" (GMT+7)
  opponent: string;      // opponent name "Xxx (V)"
  league: string;        // competition text (may be '')
  isHome: boolean;       // selected team was home?
  h1: [number, number];  // [selectedTeamH1, opponentH1]
  ft: [number, number];  // [selectedTeamFT, opponentFT]
  matchType: string;     // '20p' | '16p' | raw match_type
}

export type Tier = 'strong' | 'mid' | 'weak';
export type Lean = 'h1' | 'h2' | 'balanced';

export interface TeamFormBlock {
  team: string;                 // "Xxx (V)"
  n: number;                    // matches actually used (<= requested n)
  matches: GsTeamHistoryRow[];  // newest-first, length = n (for the list)
  record: {
    W: number; D: number; L: number;
    ftWinPct: number; drawPct: number; lossPct: number;
    h1WinPct: number; h2WinPct: number;
  };
  tier: {
    tier: Tier;                 // fixed strength band
    winPct: number;             // 0..100 (global if profile known, else last-N)
    source: 'profile' | 'window'; // where winPct/tier came from
  };
  trend: {
    // Descriptive only — "mạnh nhất / yếu nhất giai đoạn" the user asked for.
    // NOT a forecast, NOT a cycle.
    form: number[];             // per-match FT score −1|0|+1, chronological
    strongest: { fromDisplay: number; toDisplay: number; wins: number } | null;
    weakest:   { fromDisplay: number; toDisplay: number; wins: number } | null;
  };
  halves: {
    h1WinPct: number;
    h2WinPct: number;
    h1GoalDiff: number;         // avg (myH1 − opH1) over N, 2 decimals
    h2GoalDiff: number;         // avg (myH2 − opH2) over N, 2 decimals
    lean: Lean;                 // which half the team is stronger in
    lowConfidence: boolean;     // small delta or thin sample → don't trust
    htLeadFtWinPct: number | null; // when leads at HT, wins FT this % (null if never led)
    htLeadCount: number;        // matches where team led at HT
  };
}

export interface GsTeamHistoryResponse {
  ok: boolean;
  error?: string;
  n?: number;                   // echo requested n
  teams?: TeamFormBlock[];      // 1 block if team filter set, else all
}

// ---- helpers (technique copied from gsPatterns.ts) --------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 100) : 0;
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
/** +1 win, 0 draw, −1 loss for the team. */
function resultScore(my: number, op: number): -1 | 0 | 1 {
  return my > op ? 1 : my < op ? -1 : 0;
}

/**
 * Compute the honest form-rule block for one team over its newest-N matches.
 * Returns everything EXCEPT `team` and `matches`.
 *
 * @param displayRows  newest-first, length up to n (the list the UI shows).
 * @param tierInfo     optional global tier/win% from gs_team_profile.
 */
export function computeTeamForm(
  displayRows: GsTeamHistoryRow[],
  tierInfo: { tier: Tier; winPct: number } | null,
): Omit<TeamFormBlock, 'team' | 'matches'> {
  const N = displayRows.length;
  // chronological (oldest→newest) copy for streak/stretch/form-line math.
  const chrono = [...displayRows].reverse();

  // ── §record: W/D/L over N (FT) + H1/H2 win% ──────────────────────────────
  let W = 0, D = 0, L = 0, h1Wins = 0, h2Wins = 0;
  for (const r of displayRows) {
    const ft = resultScore(r.ft[0], r.ft[1]);
    if (ft > 0) W++; else if (ft < 0) L++; else D++;
    if (resultScore(r.h1[0], r.h1[1]) > 0) h1Wins++;
    const myH2 = r.ft[0] - r.h1[0], opH2 = r.ft[1] - r.h1[1];
    if (resultScore(myH2, opH2) > 0) h2Wins++;
  }
  const record = {
    W, D, L,
    ftWinPct: pct(W, N), drawPct: pct(D, N), lossPct: pct(L, N),
    h1WinPct: pct(h1Wins, N), h2WinPct: pct(h2Wins, N),
  };

  // ── §tier: fixed strength band (profile preferred; else derive from N) ────
  const windowWinPct = pct(W, N);
  const tier = tierInfo
    ? { tier: tierInfo.tier, winPct: Math.round(tierInfo.winPct), source: 'profile' as const }
    : {
        tier: (windowWinPct >= 55 ? 'strong' : windowWinPct <= 30 ? 'weak' : 'mid') as Tier,
        winPct: windowWinPct,
        source: 'window' as const,
      };

  // ── §trend: form line + strongest/weakest stretch (descriptive only) ─────
  const form = chrono.map((r) => resultScore(r.ft[0], r.ft[1]) as number);
  const k = Math.min(5, N);
  let strongest: TeamFormBlock['trend']['strongest'] = null;
  let weakest: TeamFormBlock['trend']['weakest'] = null;
  if (N > 0 && k > 0) {
    let bestSum = -Infinity, worstSum = Infinity, bestStart = 0, worstStart = 0;
    for (let i = 0; i + k <= form.length; i++) {
      let sum = 0;
      for (let j = i; j < i + k; j++) sum += form[j];
      if (sum > bestSum) { bestSum = sum; bestStart = i; }
      if (sum < worstSum) { worstSum = sum; worstStart = i; }
    }
    const winsIn = (start: number) => {
      let w = 0;
      for (let j = start; j < start + k; j++) if (form[j] > 0) w++;
      return w;
    };
    // convert chrono window [start, start+k-1] → newest-first display indices.
    const toDisplayRange = (start: number) => ({
      fromDisplay: N - 1 - (start + k - 1),
      toDisplay: N - 1 - start,
      wins: winsIn(start),
    });
    strongest = toDisplayRange(bestStart);
    weakest = toDisplayRange(worstStart);
  }

  // ── §halves: H1 vs H2 lean (descriptive, low-confidence flagged) ─────────
  const h1Diffs: number[] = [];
  const h2Diffs: number[] = [];
  let htLeadCount = 0, htLeadFtWin = 0;
  for (const r of displayRows) {
    h1Diffs.push(r.h1[0] - r.h1[1]);
    h2Diffs.push((r.ft[0] - r.h1[0]) - (r.ft[1] - r.h1[1]));
    if (r.h1[0] > r.h1[1]) {          // led at HT
      htLeadCount++;
      if (r.ft[0] > r.ft[1]) htLeadFtWin++;
    }
  }
  const h1GoalDiff = round2(mean(h1Diffs));
  const h2GoalDiff = round2(mean(h2Diffs));
  const leanDelta = h1GoalDiff - h2GoalDiff; // >0 → stronger H1, <0 → stronger H2
  const lean: Lean = leanDelta > 0.15 ? 'h1' : leanDelta < -0.15 ? 'h2' : 'balanced';
  // Small per-team GD deltas are ~1–2σ noise (research §4); flag as low-conf
  // when the lean is weak or the sample is thin.
  const lowConfidence = Math.abs(leanDelta) < 0.25 || N < 30;
  const halves = {
    h1WinPct: record.h1WinPct,
    h2WinPct: record.h2WinPct,
    h1GoalDiff,
    h2GoalDiff,
    lean,
    lowConfidence,
    htLeadFtWinPct: htLeadCount ? pct(htLeadFtWin, htLeadCount) : null,
    htLeadCount,
  };

  return {
    n: N,
    record,
    tier,
    trend: { form, strongest, weakest },
    halves,
  };
}

export { round1, pct };

// ═══════════════════════════════════════════════════════════════════════════
// Matchup mode (2-team H2H · H1→H2 conditional analysis) — APPEND-ONLY.
//
// Additive to the single-team / all-teams report. Every historical meeting of
// the chosen pair is flipped TEAM-ORIENTED (Team A vs Team B, not home/away),
// then partitioned by H1 outcome, plus an A-perspective summary card. Honesty is
// load-bearing: pairs meet ≤36 times → each scenario carries 8–16 rows, so EVERY
// stat exposes its `n` and thin (n<10) / very-thin (n<5) flags. Reuses
// round1/round2/pct/mean/resultScore above for single-team parity.
// ═══════════════════════════════════════════════════════════════════════════

/** One historical meeting, scores read from Team A / Team B perspective. */
export interface MatchupRow {
  time: string;             // "dd/mm/yyyy HH:MM" GMT+7
  league: string;           // competition text (may be '')
  aH1: number; bH1: number; // team-oriented H1 goals
  aFT: number; bFT: number; // team-oriented FT goals
  // H2 derived: aH2 = aFT-aH1, bH2 = bFT-bH1
}

/** One conditional block, keyed by what happened in H1. */
export interface ScenarioBlock {
  n: number;                     // meetings matching this H1 scenario
  thin: boolean;                 // n < 10 → "mẫu mỏng"
  veryThin: boolean;             // n < 5  → "chỉ tham khảo"
  h2GoalsAvg: number | null;     // avg (aH2+bH2), 1 dp; null if n===0
  ftGoalsAvg: number | null;     // avg (aFT+bFT), 1 dp; null if n===0
  aWinPct: number | null;        // % of these meetings Team A won FT; null if n===0
  drawPct: number | null;
  bWinPct: number | null;
  // Leader held / pegged back — meaningful only for the two lead scenarios.
  leaderHeldPct: number | null;   // null for the level scenario
  leaderPeggedPct: number | null; // null for the level scenario
}

/**
 * H2H summary card (Team A's perspective across all meetings) — mirrors the
 * single-team summary layout (recent-form strip · H1/H2 lean · W/D/L). Every
 * field carries `meetings` as its sample size; small samples are flagged in UI.
 */
export interface MatchupSummary {
  meetings: number;             // total meetings used (= MatchupBlock.meetings)
  form: number[];               // A's per-meeting FT result −1|0|+1, CHRONOLOGICAL
  halves: {
    h1GoalDiff: number;         // avg (aH1 − bH1) over meetings, 2 decimals
    h2GoalDiff: number;         // avg (aH2 − bH2) over meetings, 2 decimals
    lean: Lean;                 // which half Team A is stronger in
    lowConfidence: boolean;     // small delta or thin sample → don't trust
  };
  record: {
    aWin: number; draw: number; bWin: number;
    aWinPct: number; drawPct: number; bWinPct: number;
  };
}

export interface MatchupBlock {
  teamA: string;
  teamB: string;
  meetings: number;             // total historical meetings (all orientations)
  thinOverall: boolean;         // meetings < 10
  veryThinOverall: boolean;     // meetings < 5
  rows: MatchupRow[];           // newest-first, for the meeting list
  summary: MatchupSummary;      // A-perspective summary card (form · halves · W/D/L)
  scenarios: {
    level: ScenarioBlock;       // H1 level (aH1 === bH1) — "dằng co"
    aLeadsH1: ScenarioBlock;    // aH1 > bH1  — "đội NÀY dẫn H1"
    bLeadsH1: ScenarioBlock;    // aH1 < bH1  — "đội KIA dẫn H1"
  };
  overallH2: {                  // H2 evolution across ALL meetings (scenario 4)
    h2GoalsAvg: number | null;
    aScoredH2Pct: number | null;    // % of meetings Team A scored ≥1 in H2
    bScoredH2Pct: number | null;
    h2ChangedLeadPct: number | null;// % where FT winner differs from H1 leader
  };
}

export interface MatchupResponse {
  ok: boolean;
  error?: string;
  matchup?: MatchupBlock;       // present when ok
}

type MatchupSide = 'a' | 'b' | 'level';

function buildScenario(subset: MatchupRow[], side: MatchupSide): ScenarioBlock {
  const n = subset.length;
  if (n === 0) {
    return {
      n: 0, thin: true, veryThin: true,
      h2GoalsAvg: null, ftGoalsAvg: null,
      aWinPct: null, drawPct: null, bWinPct: null,
      leaderHeldPct: null, leaderPeggedPct: null,
    };
  }
  const h2GoalsAvg = round1(mean(subset.map((r) => (r.aFT - r.aH1) + (r.bFT - r.bH1))));
  const ftGoalsAvg = round1(mean(subset.map((r) => r.aFT + r.bFT)));
  let aWins = 0, draws = 0, bWins = 0;
  for (const r of subset) {
    if (r.aFT > r.bFT) aWins++;
    else if (r.aFT < r.bFT) bWins++;
    else draws++;
  }
  let leaderHeldPct: number | null = null;
  let leaderPeggedPct: number | null = null;
  if (side === 'a') {
    const held = subset.filter((r) => r.aFT > r.bFT).length;
    leaderHeldPct = pct(held, n);
    leaderPeggedPct = pct(n - held, n);
  } else if (side === 'b') {
    const held = subset.filter((r) => r.bFT > r.aFT).length;
    leaderHeldPct = pct(held, n);
    leaderPeggedPct = pct(n - held, n);
  }
  return {
    n, thin: n < 10, veryThin: n < 5,
    h2GoalsAvg, ftGoalsAvg,
    aWinPct: pct(aWins, n), drawPct: pct(draws, n), bWinPct: pct(bWins, n),
    leaderHeldPct, leaderPeggedPct,
  };
}

/**
 * A-perspective summary over the H2H meetings — mirrors `computeTeamForm`'s
 * form/halves/record logic so the matchup summary card stays visually consistent
 * with the single-team card. `rows` are newest-first; `form` is returned
 * chronological (oldest→newest) to match the single-team sparkline.
 */
function buildMatchupSummary(rows: MatchupRow[]): MatchupSummary {
  const meetings = rows.length;
  // chronological (oldest→newest) copy — same convention as computeTeamForm.
  const chrono = [...rows].reverse();
  const form = chrono.map((r) => resultScore(r.aFT, r.bFT) as number);

  // W/D/L from Team A's perspective across all meetings.
  let aWin = 0, draw = 0, bWin = 0;
  const h1Diffs: number[] = [];
  const h2Diffs: number[] = [];
  for (const r of rows) {
    if (r.aFT > r.bFT) aWin++;
    else if (r.aFT < r.bFT) bWin++;
    else draw++;
    h1Diffs.push(r.aH1 - r.bH1);
    h2Diffs.push((r.aFT - r.aH1) - (r.bFT - r.bH1));
  }

  // H1 vs H2 lean — identical thresholds to computeTeamForm's halves block.
  const h1GoalDiff = round2(mean(h1Diffs));
  const h2GoalDiff = round2(mean(h2Diffs));
  const leanDelta = h1GoalDiff - h2GoalDiff;
  const lean: Lean = leanDelta > 0.15 ? 'h1' : leanDelta < -0.15 ? 'h2' : 'balanced';
  const lowConfidence = Math.abs(leanDelta) < 0.25 || meetings < 30;

  return {
    meetings,
    form,
    halves: { h1GoalDiff, h2GoalDiff, lean, lowConfidence },
    record: {
      aWin, draw, bWin,
      aWinPct: pct(aWin, meetings),
      drawPct: pct(draw, meetings),
      bWinPct: pct(bWin, meetings),
    },
  };
}

/**
 * Conditional H2H math over team-oriented rows. Partitions by H1 outcome →
 * level / aLeadsH1 / bLeadsH1 blocks + overall-H2 evolution + an A-perspective
 * summary card (form · halves · W/D/L).
 */
export function computeMatchup(
  rows: MatchupRow[],
  teamA: string,
  teamB: string,
): MatchupBlock {
  const level = rows.filter((r) => r.aH1 === r.bH1);
  const aLeadsH1 = rows.filter((r) => r.aH1 > r.bH1);
  const bLeadsH1 = rows.filter((r) => r.aH1 < r.bH1);

  const meetings = rows.length;
  const sideOf = (my: number, op: number): MatchupSide => (my > op ? 'a' : my < op ? 'b' : 'level');

  let overallH2: MatchupBlock['overallH2'];
  if (meetings === 0) {
    overallH2 = { h2GoalsAvg: null, aScoredH2Pct: null, bScoredH2Pct: null, h2ChangedLeadPct: null };
  } else {
    const h2GoalsAvg = round1(mean(rows.map((r) => (r.aFT - r.aH1) + (r.bFT - r.bH1))));
    const aScored = rows.filter((r) => r.aFT - r.aH1 > 0).length;
    const bScored = rows.filter((r) => r.bFT - r.bH1 > 0).length;
    const changed = rows.filter((r) => sideOf(r.aFT, r.bFT) !== sideOf(r.aH1, r.bH1)).length;
    overallH2 = {
      h2GoalsAvg,
      aScoredH2Pct: pct(aScored, meetings),
      bScoredH2Pct: pct(bScored, meetings),
      h2ChangedLeadPct: pct(changed, meetings),
    };
  }

  return {
    teamA, teamB, meetings,
    thinOverall: meetings < 10,
    veryThinOverall: meetings < 5,
    rows,
    summary: buildMatchupSummary(rows),
    scenarios: {
      level: buildScenario(level, 'level'),
      aLeadsH1: buildScenario(aLeadsH1, 'a'),
      bLeadsH1: buildScenario(bLeadsH1, 'b'),
    },
    overallH2,
  };
}
