// F4 · shockReaction — game-state shock (cards / early goal).
// WHY NOT AN OLD RULE: old rules ignored cards and shock entirely. This
// conditions purely on discrete game-state events at the current snapshot — a
// red card threshold, or an early goal inside a window — and picks a side
// governed by boolean genes. It is reaction to a single event, not a regime.
import { tai, xiu } from './_helpers.mjs';

export const shockReaction = {
  id: 'shockReaction',
  defaults: {
    redThresh: 1,
    redSide: true, // true=Tài, false=Xỉu
    earlyWindow: 4,
    earlyGoalSide: true,
    enableRed: true,
    enableEarly: true,
  },
  paramSpec: {
    redThresh: { min: 1, max: 2, step: 1, type: 'int' },
    redSide: { type: 'bool' },
    earlyWindow: { min: 1, max: 8, step: 1, type: 'int' },
    earlyGoalSide: { type: 'bool' },
    enableRed: { type: 'bool' },
    enableEarly: { type: 'bool' },
  },
  fn(ctx, p) {
    if (p.enableRed && ctx.redHome + ctx.redAway >= p.redThresh) {
      return p.redSide ? tai() : xiu();
    }
    if (p.enableEarly && ctx.scoredAtEntry >= 1 && ctx.elapsed <= p.earlyWindow) {
      return p.earlyGoalSide ? tai() : xiu();
    }
    return null;
  },
};
