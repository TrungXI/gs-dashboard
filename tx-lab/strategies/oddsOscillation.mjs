// F8 · oddsOscillation — contrarian odds oscillation (price mean-reversion).
// WHY NOT AN OLD RULE: old rules never touched the price time-series. This
// measures how much the de-vigged implied P(Tài) SWUNG over the last `window`
// history rows and fades a sharp swing (over-reaction), or follows it when the
// contrarian gene is flipped off. It is a mean-reversion-on-price play unique
// to this family.
import { tai, xiu, impliedFromCtx } from './_helpers.mjs';
import { malayToDecimal, decimalToImplied } from '../malay.mjs';

function impliedTaiFromRow(over, under) {
  if (over === null || under === null) return null;
  const iT = decimalToImplied(malayToDecimal(over));
  const iX = decimalToImplied(malayToDecimal(under));
  const s = iT + iX;
  return s > 0 ? iT / s : null;
}

export const oddsOscillation = {
  id: 'oddsOscillation',
  defaults: { swingThresh: 0.08, window: 2, contrarian: true, minHistory: 2 },
  paramSpec: {
    swingThresh: { min: 0.03, max: 0.25, type: 'float' },
    window: { min: 2, max: 4, step: 1, type: 'int' },
    contrarian: { type: 'bool' },
    minHistory: { min: 2, max: 4, step: 1, type: 'int' },
  },
  fn(ctx, p) {
    const priced = ctx.history.filter(
      (h) => h.overPrice !== null && h.underPrice !== null,
    );
    if (priced.length < p.minHistory) return null;
    const now = impliedFromCtx(ctx);
    if (now === null) return null;
    const refRow = priced[Math.max(0, priced.length - p.window)];
    const refTai = impliedTaiFromRow(refRow.overPrice, refRow.underPrice);
    if (refTai === null) return null;
    const swing = now.pTai - refTai; // positive => implied Tài jumped up
    if (Math.abs(swing) < p.swingThresh) return null;
    // contrarian: fade the swing; else follow it.
    let taiSide;
    if (p.contrarian) taiSide = swing > 0 ? false : true; // faded direction
    else taiSide = swing > 0;
    return taiSide ? tai() : xiu();
  },
};
