// G7 · openGoalValue — the ~12% goal snapshots that stay OPEN, valued by prior.
//
// WHY OPEN-ONLY / DIFFERENT FROM F1–F12: F families reacted to goals but their
// signal landed on the ~88% of goal rows that are LOCKED. This family lives only
// on the ~12% goal_h1/goal_h2 rows that remain open (harness already filters the
// rest), where the line is unusually high (avg ~3.9). It prices with the right
// leak-free prior (conditional h1ToH2 when H1 is closed, else match_type base
// rate) and fades an abnormally high line, or backs a Tài value edge.
import { tai, xiu, impliedFromCtx } from './_helpers.mjs';

export const openGoalValue = {
  id: 'openGoalValue',
  gen: 'G',
  defaults: { hiLine: 3.75, edge: 0.06 },
  paramSpec: {
    hiLine: { min: 3.0, max: 5.0, type: 'float' },
    edge: { min: 0.03, max: 0.2, type: 'float' },
  },
  fn(ctx, p) {
    if (ctx.snapshotType !== 'goal_h1' && ctx.snapshotType !== 'goal_h2') return null;
    const implied = impliedFromCtx(ctx);
    if (implied === null) return null;
    // pick the appropriate leak-free prior for P(Tài).
    let pTai = null;
    if (ctx.h1Total != null) {
      pTai = ctx.priors?.h1ToH2?.pOverFinal(ctx.h1Total, ctx.ouLine);
    }
    if (pTai == null) {
      const base = ctx.priors?.baseRateByType?.[ctx.matchType];
      pTai = base ? base.pOver(ctx.ouLine) : null;
    }
    if (pTai == null) return null;
    const pXiu = 1 - pTai;
    // abnormally high line -> fade with Xỉu when under is undervalued
    if (ctx.ouLine >= p.hiLine && implied.pXiu - pXiu >= p.edge) return xiu();
    if (pTai - implied.pTai >= p.edge) return tai();
    return null;
  },
};
