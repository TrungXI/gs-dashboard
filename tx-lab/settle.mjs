// settle.mjs — OU Asian settlement + Malay PnL. Oracle-exact (SPEC §7).
//
// A bet is (side ∈ {tai,xiu}, absolute line, Malay price, finalTotal). We resolve
// the Asian result to one of {win, half-win, push, half-lose, lose} then apply the
// Malay PnL table. The 20-row oracle in research/settlement-oracle.md is the
// binding test; test/settle.test.mjs asserts every row to 3-decimal PnL.

// ---- 7.1 whole / half line result for a single side ------------------------
// Returns 'win' | 'lose' | 'push'. Half lines never push.
export function resultWholeHalf(side, line, finalTotal) {
  const isHalf = Math.abs(line % 1 - 0.5) < 1e-9;
  if (side === 'tai') {
    if (finalTotal > line) return 'win';
    if (finalTotal < line) return 'lose';
    return isHalf ? 'lose' : 'push'; // equality only reachable on whole line
  }
  // xiu (under)
  if (finalTotal < line) return 'win';
  if (finalTotal > line) return 'lose';
  return isHalf ? 'win' : 'push';
}

// ---- 7.2 full OU result including quarter lines -----------------------------
// Quarter lines split into two half-stakes around the line:
//   .25 line  -> ½ on L (whole)     + ½ on L+0.5 (half)
//   .75 line  -> ½ on L+0.5 (half)  + ½ on L+1.0 (whole)
// Each leg resolves via resultWholeHalf, then we combine the two win/lose/push
// legs into the Asian 5-way result.
export function ouResult(side, line, finalTotal) {
  const frac = Math.abs(line % 1);
  const isQuarter = Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9;

  if (!isQuarter) {
    // whole or half line -> single leg, but express as the 5-way vocabulary.
    const r = resultWholeHalf(side, line, finalTotal);
    return r; // 'win' | 'lose' | 'push'
  }

  const base = Math.floor(line); // integer part
  let legA;
  let legB;
  if (Math.abs(frac - 0.25) < 1e-9) {
    legA = base; // whole L
    legB = base + 0.5; // half L+0.5
  } else {
    legA = base + 0.5; // half L+0.5
    legB = base + 1.0; // whole L+1.0
  }
  const rA = resultWholeHalf(side, legA, finalTotal);
  const rB = resultWholeHalf(side, legB, finalTotal);
  return combineLegs(rA, rB);
}

// Combine two half-stake legs (each 'win'|'lose'|'push') -> Asian 5-way result.
function combineLegs(a, b) {
  const legs = [a, b];
  const wins = legs.filter((x) => x === 'win').length;
  const loses = legs.filter((x) => x === 'lose').length;
  const pushes = legs.filter((x) => x === 'push').length;

  if (wins === 2) return 'win';
  if (loses === 2) return 'lose';
  if (wins === 1 && pushes === 1) return 'half-win';
  if (loses === 1 && pushes === 1) return 'half-lose';
  if (pushes === 2) return 'push'; // both legs push (e.g. impossible in practice but safe)
  // win+lose on the same side/line is geometrically impossible; guard loudly.
  throw new Error(`impossible leg combo: ${a}+${b}`);
}

// ---- 7.3 Malay PnL from result + price -------------------------------------
export function malayPnl(result, price) {
  const pos = price >= 0;
  switch (result) {
    case 'win':
      return pos ? price : 1;
    case 'half-win':
      return pos ? price / 2 : 0.5;
    case 'push':
      return 0;
    case 'half-lose':
      return pos ? -0.5 : -Math.abs(price) / 2;
    case 'lose':
      return pos ? -1 : -Math.abs(price);
    default:
      throw new Error(`unknown result: ${result}`);
  }
}

// Convenience: settle a bet end-to-end. Returns { result, pnl }.
export function settle(side, line, price, finalTotal) {
  const result = ouResult(side, line, finalTotal);
  const pnl = malayPnl(result, price);
  return { result, pnl };
}
