// F3 · impliedVsBaserate — implied vs empirical mispricing.
// WHY NOT AN OLD RULE: old rules were price-agnostic direction bets. This one
// explicitly hunts a divergence between the market-implied P(Tài) (de-vigged
// from ou_over/ou_under) and the LEAK-FREE empirical base-rate P(finalTotal >
// line) drawn only from prior-dated events. It bets the undervalued side. No
// old version compared price to a runtime-learned base rate.
import { tai, xiu, impliedFromCtx } from './_helpers.mjs';

export const impliedVsBaserate = {
  id: 'impliedVsBaserate',
  defaults: { edge: 0.07, minPriorN: 50 },
  paramSpec: {
    edge: { min: 0.02, max: 0.2, type: 'float' },
    minPriorN: { min: 30, max: 500, step: 1, type: 'int' },
  },
  fn(ctx, p) {
    const base = ctx.priors?.baseRateByType?.[ctx.matchType];
    if (!base || base.n < p.minPriorN) return null;
    const baseTai = base.pOver(ctx.ouLine);
    if (baseTai === null) return null;
    const implied = impliedFromCtx(ctx);
    if (implied === null) return null;
    if (baseTai - implied.pTai >= p.edge) return tai(); // over undervalued
    if (implied.pTai - baseTai >= p.edge) return xiu(); // over overvalued
    return null;
  },
};
