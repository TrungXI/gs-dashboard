// G3 · kickoffH2LineValue — mispricing: P(final>line | H1) vs market implied.
//
// WHY OPEN-ONLY / DIFFERENT FROM F1–F12: both the line and the Malay prices are
// present at the OPEN kickoff_h2 mark. F3 compared price to a base-rate keyed on
// match_type only. Here the empirical probability is CONDITIONED on the closed
// H1 total (the h1ToH2 histogram) — a sharper, new signal. If the conditional
// P(Tài) diverges from the de-vigged implied prob by `edge`, bet the value side.
import { tai, xiu, impliedFromCtx } from './_helpers.mjs';

export const kickoffH2LineValue = {
  id: 'kickoffH2LineValue',
  gen: 'G',
  defaults: { edge: 0.06 },
  paramSpec: {
    edge: { min: 0.02, max: 0.2, type: 'float' },
  },
  fn(ctx, p) {
    if (ctx.snapshotType !== 'kickoff_h2') return null;
    if (ctx.h1Total == null) return null;
    const pTai = ctx.priors?.h1ToH2?.pOverFinal(ctx.h1Total, ctx.ouLine);
    if (pTai == null) return null;
    const implied = impliedFromCtx(ctx);
    if (implied === null) return null;
    if (pTai - implied.pTai >= p.edge) return tai();
    if (implied.pTai - pTai >= p.edge) return xiu();
    return null;
  },
};
