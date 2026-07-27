// F2 · poissonRemaining — Poisson goals-remaining vs implied.
// WHY NOT AN OLD RULE: old rules fired on fixed line offsets and never modeled
// remaining time. This computes a time-decayed goal expectation
// (lambda = rate(matchType) * minutesRemaining), turns it into P(Tài live) via
// a Poisson survival function, and only bets when that model prob diverges from
// the de-vigged market implied prob by `edge`. A goal-expectation crossing
// implied probability is a signal the old offset rules could not express.
import { tai, xiu, impliedFromCtx, poissonSurvive } from './_helpers.mjs';

export const poissonRemaining = {
  id: 'poissonRemaining',
  defaults: { rate16: 0.18, rate20: 0.16, edge: 0.05, minMinutesRemaining: 2 },
  paramSpec: {
    rate16: { min: 0.05, max: 0.5, type: 'float' },
    rate20: { min: 0.05, max: 0.5, type: 'float' },
    edge: { min: 0.0, max: 0.15, type: 'float' },
    minMinutesRemaining: { min: 0, max: 15, step: 1, type: 'int' },
  },
  fn(ctx, p) {
    if (ctx.minutesRemaining < p.minMinutesRemaining) return null;
    const rate = ctx.matchType === '16p' ? p.rate16 : p.rate20;
    const lambda = rate * ctx.minutesRemaining;
    // goals still needed for Tài to be live; round up quarter/half lines.
    const need = Math.ceil(ctx.neededToTai);
    // pTaiLive = P(remaining goals >= need). If need <= 0, Tài already live.
    const pTaiLive = need <= 0 ? 1 : poissonSurvive(need, lambda);
    const implied = impliedFromCtx(ctx);
    if (implied === null) return null;
    if (pTaiLive - implied.pTai >= p.edge) return tai();
    if (1 - pTaiLive - implied.pXiu >= p.edge) return xiu();
    return null;
  },
};
