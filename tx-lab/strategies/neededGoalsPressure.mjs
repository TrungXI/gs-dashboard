// F9 · neededGoalsPressure — end-of-match needed-goals pressure.
// WHY NOT AN OLD RULE: old rules had no time-to-line pressure logic. This uses
// (line − scored) together with remaining minutes: near match end, many goals
// still needed => Xỉu; already near/over the line => Tài. The combination of
// residual goals and residual time is the signal, not a fixed offset.
import { tai, xiu } from './_helpers.mjs';

export const neededGoalsPressure = {
  id: 'neededGoalsPressure',
  defaults: { lateWindow: 6, hardThresh: 2.0, easyThresh: 0.5 },
  paramSpec: {
    lateWindow: { min: 2, max: 12, step: 1, type: 'int' },
    hardThresh: { min: 1.0, max: 3.0, type: 'float' },
    easyThresh: { min: -0.5, max: 1.0, type: 'float' },
  },
  fn(ctx, p) {
    if (ctx.minutesRemaining > p.lateWindow) return null;
    if (ctx.neededToTai >= p.hardThresh) return xiu(); // too many goals, little time
    if (ctx.neededToTai <= p.easyThresh) return tai(); // near/over already
    return null;
  },
};
