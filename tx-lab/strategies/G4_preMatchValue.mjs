// G4 · preMatchValue — pre-match value at first_seen.
//
// WHY OPEN-ONLY / DIFFERENT FROM F1–F12: first_seen is a pre-match snapshot that
// is always open (1424 rows). No F family targets first_seen specifically —
// F3/F5 ran on every snapshot and so kept landing on locked in-play rows. This
// bets when the pre-match line diverges from the leak-free match_type base rate.
import { tai, xiu, impliedFromCtx } from './_helpers.mjs';

export const preMatchValue = {
  id: 'preMatchValue',
  gen: 'G',
  defaults: { edge: 0.06, minPriorN: 50 },
  paramSpec: {
    edge: { min: 0.02, max: 0.2, type: 'float' },
    minPriorN: { min: 30, max: 500, step: 1, type: 'int' },
  },
  fn(ctx, p) {
    if (ctx.snapshotType !== 'first_seen') return null;
    const base = ctx.priors?.baseRateByType?.[ctx.matchType];
    if (!base || base.n < p.minPriorN) return null;
    const baseTai = base.pOver(ctx.ouLine);
    if (baseTai === null) return null;
    const implied = impliedFromCtx(ctx);
    if (implied === null) return null;
    if (baseTai - implied.pTai >= p.edge) return tai();
    if (implied.pTai - baseTai >= p.edge) return xiu();
    return null;
  },
};
