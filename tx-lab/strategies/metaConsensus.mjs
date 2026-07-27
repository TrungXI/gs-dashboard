// F10 · metaConsensus — stacking / consensus over base families.
// WHY NOT AN OLD RULE: no old version stacked strategies. This evaluates a
// fixed panel of freshly-designed base families (F1–F9, F12) on the SAME ctx,
// counts Tài vs Xỉu votes, and bets the majority only when the count and margin
// clear tunable thresholds. The base families' params are carried in this
// individual's own genome slice (`subParams`), so the ensemble co-evolves.
import { tai, xiu } from './_helpers.mjs';
import { lineDrift } from './lineDrift.mjs';
import { poissonRemaining } from './poissonRemaining.mjs';
import { impliedVsBaserate } from './impliedVsBaserate.mjs';
import { shockReaction } from './shockReaction.mjs';
import { baserateReversion } from './baserateReversion.mjs';
import { earlyGoalTempo } from './earlyGoalTempo.mjs';
import { h2hLateGoal } from './h2hLateGoal.mjs';
import { oddsOscillation } from './oddsOscillation.mjs';
import { neededGoalsPressure } from './neededGoalsPressure.mjs';
import { lineValueBand } from './lineValueBand.mjs';

// The panel the meta consults. (F11 randomExplorer is intentionally excluded —
// consulting noise would only add variance.)
export const META_PANEL = [
  lineDrift,
  poissonRemaining,
  impliedVsBaserate,
  shockReaction,
  baserateReversion,
  earlyGoalTempo,
  h2hLateGoal,
  oddsOscillation,
  neededGoalsPressure,
  lineValueBand,
];

export const metaConsensus = {
  id: 'metaConsensus',
  // `subParams` maps familyId -> that family's param set. init/mutation fill it
  // from each family's paramSpec (see evolve.mjs). Missing entries fall back to
  // the family defaults.
  defaults: { K: 3, marginVotes: 1, subParams: buildDefaultSubParams() },
  paramSpec: {
    K: { min: 2, max: 6, step: 1, type: 'int' },
    marginVotes: { min: 1, max: 4, step: 1, type: 'int' },
    // subParams is a nested structure handled specially by the GA; declared so
    // init/mutation know to populate it.
    subParams: { type: 'nested', families: META_PANEL.map((f) => f.id) },
  },
  fn(ctx, p) {
    let taiVotes = 0;
    let xiuVotes = 0;
    for (const fam of META_PANEL) {
      const sp = (p.subParams && p.subParams[fam.id]) || fam.defaults;
      let bet = null;
      try {
        bet = fam.fn(ctx, sp);
      } catch {
        bet = null;
      }
      if (!bet) continue;
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
  for (const f of META_PANEL) out[f.id] = { ...f.defaults };
  return out;
}
