// F7 · h2hLateGoal — head-to-head pair total-goals tendency.
// WHY NOT AN OLD RULE: no old version used pair-level H2H history. Priors are
// built only from PRIOR meetings of the same unordered team pair (leak-free),
// and the family passes when there are too few meetings. It bets Tài/Xỉu based
// on whether the pair's historical mean total sits above/below the current line.
import { tai, xiu } from './_helpers.mjs';

export const h2hLateGoal = {
  id: 'h2hLateGoal',
  defaults: { margin: 0.5, minMeetings: 3 },
  paramSpec: {
    margin: { min: 0.0, max: 1.5, type: 'float' },
    minMeetings: { min: 2, max: 10, step: 1, type: 'int' },
  },
  fn(ctx, p) {
    const key = ctx.priors?.pairKey;
    const h2h = key ? ctx.priors?.h2h?.[key] : null;
    if (!h2h || h2h.count < p.minMeetings) return null;
    if (h2h.mean > ctx.ouLine + p.margin) return tai();
    if (h2h.mean < ctx.ouLine - p.margin) return xiu();
    return null;
  },
};
