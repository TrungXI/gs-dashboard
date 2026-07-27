// G1 · h1ContinuationOU — continuation H1→final, entry at kickoff_h2.
//
// WHY OPEN-ONLY / DIFFERENT FROM F1–F12: kickoff_h2 is 84% open and 100% has a
// full-match line + the closed H1 score. This family reads a LEARNED H1→final
// continuation prior (expected final total given H1 total) — a signal none of
// F1–F12 have. It never touches line-drift or price time-series (the F-family
// reactions that fired on locked goal rows); it acts once, at a rich OPEN mark.
import { tai, xiu } from './_helpers.mjs';

export const h1ContinuationOU = {
  id: 'h1ContinuationOU',
  gen: 'G',
  defaults: { edge: 0.35 },
  paramSpec: {
    edge: { min: 0.05, max: 1.2, type: 'float' },
  },
  fn(ctx, p) {
    if (ctx.snapshotType !== 'kickoff_h2') return null; // wrong mark -> PASS
    if (ctx.h1Total == null) return null;
    const E = ctx.priors?.h1ToH2?.expFinal(ctx.h1Total);
    if (E == null) return null; // prior below min-N -> PASS
    if (E - ctx.ouLine >= p.edge) return tai();
    if (ctx.ouLine - E >= p.edge) return xiu();
    return null;
  },
};
