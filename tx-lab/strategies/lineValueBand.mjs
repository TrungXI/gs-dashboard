// F12 · lineValueBand — line-band + price-asymmetry value.
// WHY NOT AN OLD RULE: this is NOT a fixed offset. It only acts when the
// absolute line falls inside a tunable band AND the two Malay prices are
// asymmetric enough, then bets the cheaper (higher-payout) side — a price-value
// play conditioned on line level. Old rules never combined a line-level filter
// with price asymmetry.
import { tai, xiu } from './_helpers.mjs';

export const lineValueBand = {
  id: 'lineValueBand',
  defaults: { loLine: 1.5, hiLine: 4.0, asymThresh: 0.1, sideOnCheap: true },
  paramSpec: {
    loLine: { min: 0.5, max: 3.0, type: 'float' },
    hiLine: { min: 2.0, max: 6.0, type: 'float' },
    asymThresh: { min: 0.0, max: 0.4, type: 'float' },
    sideOnCheap: { type: 'bool' },
  },
  fn(ctx, p) {
    if (ctx.ouLine < p.loLine || ctx.ouLine > p.hiLine) return null;
    if (ctx.overPrice === null || ctx.underPrice === null) return null;
    const asym = Math.abs(ctx.overPrice - ctx.underPrice);
    if (asym < p.asymThresh) return null;
    // "cheaper" = the more negative / smaller Malay price = higher payout side.
    const overIsCheaper = ctx.overPrice < ctx.underPrice;
    // sideOnCheap=true bets the cheaper (higher-payout) side; false bets the
    // richer side.
    const betOver = p.sideOnCheap ? overIsCheaper : !overIsCheaper;
    return betOver ? tai() : xiu();
  },
};
