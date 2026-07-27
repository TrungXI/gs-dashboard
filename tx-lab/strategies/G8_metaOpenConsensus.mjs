// G8 · metaOpenConsensus — consensus of the open-only G families.
//
// WHY OPEN-ONLY / DIFFERENT FROM F1–F12: F10 stacked F1–F9, whose signals fired
// on locked in-play rows. This stacks G1–G7 — all H1→H2 / open-mark signals —
// and only counts votes from families that actually enter at the current
// snapshot (each G family self-PASSes on the wrong mark, so a null is simply not
// a vote). It bets the majority when the vote count and margin clear thresholds.
// Sub-family params ride this individual's own genome slice (co-evolving, as F10).
import { tai, xiu } from './_helpers.mjs';
import { h1ContinuationOU } from './G1_h1ContinuationOU.mjs';
import { h1TempoStats } from './G2_h1TempoStats.mjs';
import { kickoffH2LineValue } from './G3_kickoffH2LineValue.mjs';
import { preMatchValue } from './G4_preMatchValue.mjs';
import { scorelessOrBlowout } from './G5_scorelessOrBlowout.mjs';
import { leagueOpenPrior } from './G6_leagueOpenPrior.mjs';
import { openGoalValue } from './G7_openGoalValue.mjs';

export const G_META_PANEL = [
  h1ContinuationOU,
  h1TempoStats,
  kickoffH2LineValue,
  preMatchValue,
  scorelessOrBlowout,
  leagueOpenPrior,
  openGoalValue,
];

export const metaOpenConsensus = {
  id: 'metaOpenConsensus',
  gen: 'G',
  defaults: { K: 2, marginVotes: 1, subParams: buildDefaultSubParams() },
  paramSpec: {
    K: { min: 2, max: 5, step: 1, type: 'int' },
    marginVotes: { min: 1, max: 3, step: 1, type: 'int' },
    subParams: { type: 'nested', families: G_META_PANEL.map((f) => f.id) },
  },
  fn(ctx, p) {
    let taiVotes = 0;
    let xiuVotes = 0;
    for (const fam of G_META_PANEL) {
      const sp = (p.subParams && p.subParams[fam.id]) || fam.defaults;
      let bet = null;
      try {
        bet = fam.fn(ctx, sp);
      } catch {
        bet = null;
      }
      if (!bet) continue; // family passed (wrong mark or no edge) -> no vote
      if (bet.side === 'tai') taiVotes++;
      else xiuVotes++;
    }
    const max = Math.max(taiVotes, xiuVotes);
    const margin = Math.abs(taiVotes - xiuVotes);
    if (max < p.K || margin < p.marginVotes) return null;
    return taiVotes > xiuVotes ? tai() : xiu();
  },
};

function buildDefaultSubParams() {
  const out = {};
  for (const f of G_META_PANEL) out[f.id] = { ...f.defaults };
  return out;
}
