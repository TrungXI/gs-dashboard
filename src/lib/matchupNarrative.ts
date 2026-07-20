// Deterministic adaptive phrasing for the 2-team matchup narrative.
//
// The matchup NUMBERS (computeMatchup in teamForm.ts) are untouched — this file
// only turns those numbers into Vietnamese WORDING via fixed threshold buckets,
// so the sentences read naturally whether a rate is 90% or 20%. No AI, no Claude:
// same input → same words, every time. Honesty is load-bearing — raw fractions
// stay woven in ("9/10", "~1/5 trận") and thin (n<10) / very-thin (n<5) samples
// SOFTEN any strong claim rather than asserting it.

import type { ScenarioBlock, MatchupSummary } from './teamForm';

// ── Rate → qualifier buckets ────────────────────────────────────────────────
// Applied to hold-rate, win-rate, etc. `draw=true` swaps the mid-band wording
// to the "dắt nhau / 50-50" phrasing the draw scenario wants.
export function rateQualifier(p: number, draw = false): string {
  if (p >= 85) return draw ? 'gần như luôn' : 'gần như chắc';
  if (p >= 60) return 'thường';
  if (p >= 40) return draw ? 'hay dắt nhau' : 'khá cân';
  if (p >= 16) return 'hiếm khi';
  return 'gần như không';
}

// ── Goal-volume buckets (FT average → plain words) ──────────────────────────
// FT ≥ ~3.5 "nhiều bàn", ≤ ~2 "ít bàn", else "vừa phải". Guards undefined.
export function goalVolume(ftAvg: number | null): string {
  if (ftAvg == null) return 'chưa rõ số bàn';
  if (ftAvg >= 3.5) return 'nhiều bàn';
  if (ftAvg <= 2) return 'ít bàn';
  return 'số bàn vừa phải';
}

// ── Sample-size caveat suffix ───────────────────────────────────────────────
// Appended to a scenario sentence: n is ALWAYS shown; thin/very-thin flagged.
export function sampleNote(n: number): string {
  if (n === 0) return '';
  if (n < 5) return ` (n=${n} · chỉ tham khảo)`;
  if (n < 10) return ` (n=${n} · mẫu còn ít)`;
  return ` (n=${n})`;
}

/**
 * Render a hold/win rate as "raw fraction + qualifier", softening strong claims
 * on small samples. E.g. 100% on n=10 → "10/10 (gần như chắc, nhưng mẫu ít nên
 * chưa chắc chắn)". `count` is the numerator (held / won matches).
 */
export function rateClaim(
  pctVal: number,
  count: number,
  n: number,
  draw = false,
): string {
  const frac = `${count}/${n}`;
  const q = rateQualifier(pctVal, draw);
  const strong = pctVal >= 85 || pctVal <= 15;
  const saturated = pctVal === 100 || pctVal === 0;
  // Softening ladder: very-thin (n<5) always hedges; a strong or saturated
  // claim on a still-small H2H sample (n<20) is "chưa chắc chắn"; a thin (n<10)
  // strong claim gets "nhưng mẫu còn ít".
  let note = '';
  if (n < 5) {
    note = strong ? ', nhưng mẫu còn ít nên chưa chắc chắn' : ', mẫu còn ít';
  } else if (saturated && n < 20) {
    note = ' — mẫu ít nên chưa chắc chắn';
  } else if (strong && n < 10) {
    note = ', nhưng mẫu còn ít';
  }
  return `${frac} → ${q}${note}`;
}

// ── Scenario sentence composers ─────────────────────────────────────────────

/**
 * Scenario 1 — H1 dằng co (hoà). Emphasize the dominant FT signal: if draw% is
 * the max of {aWin,draw,bWin} the pair "hay dắt nhau về hoà"; else name the team
 * that tends to pull ahead. Mention H2 goals + FT volume in plain words.
 */
export function levelSentence(
  s: ScenarioBlock,
  teamA: string,
  teamB: string,
): string {
  const aWin = s.aWinPct ?? 0;
  const draw = s.drawPct ?? 0;
  const bWin = s.bWinPct ?? 0;
  const maxV = Math.max(aWin, draw, bWin);

  // A "vượt lên" verb only reads right for a saturated lead (≥85%); at the
  // 40–84% band the modal team merely "nhỉnh hơn".
  const leadVerb = (p: number) => (p >= 85 ? 'gần như luôn thắng' : 'nhỉnh hơn');
  let lead: string;
  if (draw === maxV) {
    lead = `hay dắt nhau về hoà (${draw}%)`;
  } else if (aWin === maxV) {
    lead = `${teamA} ${leadVerb(aWin)} (${aWin}%)`;
  } else {
    lead = `${teamB} ${leadVerb(bWin)} (${bWin}%)`;
  }

  const h2 = s.h2GoalsAvg == null ? '' : `H2 thêm TB ${s.h2GoalsAvg} bàn, `;
  const vol = goalVolume(s.ftGoalsAvg);
  const ft = s.ftGoalsAvg == null ? '' : ` (TB ${s.ftGoalsAvg})`;
  const soft = s.n < 5 ? ' — mẫu quá ít, chỉ tham khảo' : '';

  return `Khi H1 hoà nhau, ${lead}; ${h2}cả trận thường ${vol}${ft}${soft}.${sampleNote(s.n)}`;
}

/**
 * Scenario 2/3 — one team leads at H1. Phrase the hold rate:
 *  ≥85% "dẫn H1 gần như chắc thắng (h/n trận giữ trọn)"
 *  60-84% "thường giữ được"
 *  else   "hay bị gỡ/ngược".
 * `leaderName` is the team that led; `heldCount` = held matches (numerator).
 */
export function leadSentence(
  s: ScenarioBlock,
  leaderName: string,
): string {
  const held = s.leaderHeldPct ?? 0;
  const n = s.n;
  const heldCount = Math.round((held / 100) * n);
  const peggedCount = n - heldCount;

  let phrase: string;
  if (held >= 85) {
    phrase = `dẫn H1 gần như chắc thắng — giữ trọn ${heldCount}/${n} trận`;
  } else if (held >= 60) {
    phrase = `dẫn H1 thì thường giữ được (${heldCount}/${n} trận)`;
  } else {
    phrase = `dẫn H1 nhưng hay bị gỡ/ngược (chỉ giữ ${heldCount}/${n})`;
  }

  // Softening on small samples — never assert "gần như chắc" hard on thin n.
  let note = '';
  if (n < 5) note = ' — mẫu quá ít, chỉ tham khảo';
  else if (n < 10 && held >= 85) note = ' (mẫu còn ít nên chưa chắc chắn)';
  else if (held === 100 && n < 20) note = ' (mẫu ít nên chưa chắc chắn)';

  const peg = peggedCount > 0 ? `, bị gỡ/ngược ${peggedCount}/${n}` : '';

  return `${leaderName} ${phrase}${peg}${note}.${sampleNote(n)}`;
}

/**
 * Scenario 4 — H2 chung. Who scores more in H2 (compare the two H2-scoring %),
 * and change-of-outcome %: <25% "ít khi lật kèo"; 25-40% "thỉnh thoảng đổi cục
 * diện"; >40% "hay đảo cục diện". `meetings` is the denominator for "x/y trận".
 */
export function overallH2Sentence(
  h2: {
    h2GoalsAvg: number | null;
    aScoredH2Pct: number | null;
    bScoredH2Pct: number | null;
    h2ChangedLeadPct: number | null;
  },
  teamA: string,
  teamB: string,
  meetings: number,
): string {
  const aS = h2.aScoredH2Pct ?? 0;
  const bS = h2.bScoredH2Pct ?? 0;

  let scorer: string;
  if (aS === bS) {
    scorer = `cả hai đội ghi bàn H2 ngang nhau (${aS}%)`;
  } else if (aS > bS) {
    scorer = `${teamA} ${rateQualifier(aS)} ghi bàn ở H2 (${aS}% vs ${bS}%)`;
  } else {
    scorer = `${teamB} ${rateQualifier(bS)} ghi bàn ở H2 (${bS}% vs ${aS}%)`;
  }

  const chg = h2.h2ChangedLeadPct ?? 0;
  const chgCount = Math.round((chg / 100) * meetings);
  let flip: string;
  if (chg < 25) {
    flip = `ít khi lật kèo (~${chgCount}/${meetings} trận đổi kết quả so với H1)`;
  } else if (chg <= 40) {
    flip = `thỉnh thoảng đổi cục diện (${chgCount}/${meetings} trận)`;
  } else {
    flip = `hay đảo cục diện (${chgCount}/${meetings} trận)`;
  }

  const goals =
    h2.h2GoalsAvg == null ? '' : `TB ${h2.h2GoalsAvg} bàn/H2; `;

  return `Nhìn chung H2: ${goals}${scorer}; ${flip}.`;
}

/**
 * Summary card line — recent record + H1/H2 lean, adaptive.
 * dominant record → "{team} áp đảo cặp này (X%)"; balanced → "khá cân";
 * plus a lean tail "nhỉnh hơn ở hiệp {1/2}" when not balanced.
 */
export function summaryLine(
  summary: MatchupSummary,
  teamA: string,
  teamB: string,
): string {
  const { record, halves, meetings } = summary;
  const aWin = record.aWinPct;
  const bWin = record.bWinPct;
  const draw = record.drawPct;

  let head: string;
  if (aWin >= 60) head = `${teamA} áp đảo cặp này (${aWin}%)`;
  else if (bWin >= 60) head = `${teamB} áp đảo cặp này (${bWin}%)`;
  else if (Math.max(aWin, bWin) - Math.min(aWin, bWin) <= 10 || draw >= 40)
    head = 'hai đội khá cân';
  else if (aWin > bWin) head = `${teamA} nhỉnh hơn (${aWin}% vs ${bWin}%)`;
  else head = `${teamB} nhỉnh hơn (${bWin}% vs ${aWin}%)`;

  let tail = '';
  if (halves.lean === 'h1') tail = ` · ${teamA} nhỉnh hơn ở hiệp 1`;
  else if (halves.lean === 'h2') tail = ` · ${teamA} nhỉnh hơn ở hiệp 2`;

  const note =
    meetings < 5 ? ' — chỉ tham khảo' : meetings < 10 ? ' — mẫu còn ít' : '';

  return `${head}${tail}${note}.`;
}
