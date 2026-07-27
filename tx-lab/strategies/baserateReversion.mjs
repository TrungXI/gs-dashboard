// F5 · baserateReversion — match_type mean-reversion vs the current line.
// WHY NOT AN OLD RULE: old v6 league-dir HARDCODED a league direction. This
// learns the mean-reversion target (expected total goals for this match type)
// at runtime from prior-only history, then bets that the line reverts toward
// that learned mean. No hardcoded numbers, and the target is leak-free.
import { tai, xiu } from './_helpers.mjs';

export const baserateReversion = {
  id: 'baserateReversion',
  defaults: { band: 0.5, minPriorN: 50 },
  paramSpec: {
    band: { min: 0.0, max: 1.5, type: 'float' },
    minPriorN: { min: 30, max: 500, step: 1, type: 'int' },
  },
  fn(ctx, p) {
    const base = ctx.priors?.baseRateByType?.[ctx.matchType];
    if (!base || base.n < p.minPriorN) return null;
    const expTotal = base.mean;
    if (ctx.ouLine > expTotal + p.band) return xiu(); // line set high -> revert down
    if (ctx.ouLine < expTotal - p.band) return tai(); // line set low -> revert up
    return null;
  },
};
