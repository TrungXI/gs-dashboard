// G5 · scorelessOrBlowout — regime split on the closed H1 total.
//
// WHY OPEN-ONLY / DIFFERENT FROM F1–F12: acts only at the OPEN kickoff_h2 mark
// on the safe h1Total. F6 used in-play scored+elapsed (locked rows). Here the
// regime is decided by H1 total: a scoreless H1 (low-tempo) leans Xỉu when the
// line still sits above the learned continuation expectation; a high-H1 blowout
// (high-tempo continuation) leans Tài when the expectation clears the line.
import { tai, xiu } from './_helpers.mjs';

export const scorelessOrBlowout = {
  id: 'scorelessOrBlowout',
  gen: 'G',
  defaults: { lowThresh: 0, highThresh: 3, slackLow: 0.3, slackHigh: 0.3 },
  paramSpec: {
    lowThresh: { min: 0, max: 1, step: 1, type: 'int' },
    highThresh: { min: 3, max: 5, step: 1, type: 'int' },
    slackLow: { min: 0, max: 0.8, type: 'float' },
    slackHigh: { min: 0, max: 0.8, type: 'float' },
  },
  fn(ctx, p) {
    if (ctx.snapshotType !== 'kickoff_h2') return null;
    if (ctx.h1Total == null) return null;
    const E = ctx.priors?.h1ToH2?.expFinal(ctx.h1Total);
    if (E == null) return null;
    if (ctx.h1Total <= p.lowThresh) {
      // low-tempo regime: fade a still-high line
      if (ctx.ouLine >= E + p.slackLow) return xiu();
      return null;
    }
    if (ctx.h1Total >= p.highThresh) {
      // high-tempo regime: back continuation when expectation clears the line
      if (E - ctx.ouLine >= p.slackHigh) return tai();
      return null;
    }
    return null; // middle zone -> PASS
  },
};
