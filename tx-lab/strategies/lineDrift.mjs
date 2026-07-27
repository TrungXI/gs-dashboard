// F1 · lineDrift — line-drift momentum.
// WHY NOT AN OLD RULE: old TX versions (v6 league-dir, v6.2 tài-0.5) used a
// STATIC league direction or a fixed line offset. This family has no static
// side at all — it reads the intra-event motion of ou_line across history
// snapshots (market re-pricing = information flow) and bets in the direction of
// (or against) that drift. Nothing in the old rules touched line time-series.
import { tai, xiu } from './_helpers.mjs';

export const lineDrift = {
  id: 'lineDrift',
  defaults: { upThresh: 0.5, downThresh: 0.5, window: 2, minHistory: 1, follow: true },
  paramSpec: {
    upThresh: { min: 0.1, max: 1.5, type: 'float' },
    downThresh: { min: 0.1, max: 1.5, type: 'float' },
    window: { min: 1, max: 4, step: 1, type: 'int' },
    minHistory: { min: 1, max: 4, step: 1, type: 'int' },
    follow: { type: 'bool' },
  },
  fn(ctx, p) {
    const hist = ctx.history.filter((h) => h.ouLine !== null);
    if (hist.length < p.minHistory) return null;
    // reference line = the ouLine `window` rows back (clamped to earliest).
    const refIdx = Math.max(0, hist.length - p.window);
    const ref = hist[refIdx].ouLine;
    const drift = ctx.ouLine - ref;
    let side = null;
    if (drift >= p.upThresh) side = 'tai';
    else if (drift <= -p.downThresh) side = 'xiu';
    if (side === null) return null;
    // follow=false fades the drift.
    if (!p.follow) side = side === 'tai' ? 'xiu' : 'tai';
    return side === 'tai' ? tai() : xiu();
  },
};
