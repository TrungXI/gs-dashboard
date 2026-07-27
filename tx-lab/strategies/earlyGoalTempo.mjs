// F6 · earlyGoalTempo — early-goal regime detector.
// WHY NOT AN OLD RULE: old rules had no tempo concept. Distinct from F4
// (which reacts to a single shock event): this detects a REGIME — goals inside
// an opening window imply a high-tempo, many-goal match (bet Tài), while a dry
// opening implies a low-tempo match (bet Xỉu). It reasons over the state of the
// match, not a discrete card/goal event.
import { tai, xiu } from './_helpers.mjs';

export const earlyGoalTempo = {
  id: 'earlyGoalTempo',
  defaults: { goalsThresh: 1, tempoWindow: 6, dryWindow: 8, enableDry: true },
  paramSpec: {
    goalsThresh: { min: 1, max: 2, step: 1, type: 'int' },
    tempoWindow: { min: 2, max: 10, step: 1, type: 'int' },
    dryWindow: { min: 4, max: 14, step: 1, type: 'int' },
    enableDry: { type: 'bool' },
  },
  fn(ctx, p) {
    if (ctx.scoredAtEntry >= p.goalsThresh && ctx.elapsed <= p.tempoWindow) {
      return tai(); // high-tempo regime
    }
    if (p.enableDry && ctx.scoredAtEntry === 0 && ctx.elapsed >= p.dryWindow) {
      return xiu(); // low-tempo regime
    }
    return null;
  },
};
