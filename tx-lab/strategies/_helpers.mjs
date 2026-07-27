// _helpers.mjs — shared pure helpers for strategy families. No state, no I/O.
import { malayToDecimal, decimalToImplied } from '../malay.mjs';

const TAI = { side: 'tai', stake: 1 };
const XIU = { side: 'xiu', stake: 1 };
export function tai() {
  return { side: 'tai', stake: 1 };
}
export function xiu() {
  return { side: 'xiu', stake: 1 };
}
export { TAI, XIU };

// De-vigged implied probs from a ctx's current over/under prices.
export function impliedFromCtx(ctx) {
  if (ctx.overPrice === null || ctx.underPrice === null) return null;
  const iTai = decimalToImplied(malayToDecimal(ctx.overPrice));
  const iXiu = decimalToImplied(malayToDecimal(ctx.underPrice));
  const sum = iTai + iXiu;
  if (sum <= 0) return null;
  return { pTai: iTai / sum, pXiu: iXiu / sum };
}

// Poisson CDF P(X <= k) for mean lambda, k a non-negative integer.
export function poissonCdf(k, lambda) {
  if (lambda <= 0) return k >= 0 ? 1 : 0;
  const kk = Math.floor(k);
  if (kk < 0) return 0;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= kk; i++) {
    term *= lambda / i;
    sum += term;
  }
  return Math.min(1, sum);
}

// P(X >= m) = 1 - CDF(m-1).
export function poissonSurvive(m, lambda) {
  if (m <= 0) return 1;
  return 1 - poissonCdf(m - 1, lambda);
}
