// F11 · randomExplorer — bandit exploration / NOISE BASELINE (mandatory).
// WHY NOT AN OLD RULE: deliberately NOT a strategy. It is the null control and
// the GA's explorer. With probability pAct (seeded deterministically by
// event_id+minute so the same opportunity always flips the same way), it emits
// a coin-flip bet biased by biasTai. If explorers top the leaderboard, there is
// no real edge — its survival vs. the signal families is itself the signal.
import { tai, xiu } from './_helpers.mjs';
import { rand01FromKey } from '../rng.mjs';

export const randomExplorer = {
  id: 'randomExplorer',
  defaults: { pAct: 0.3, biasTai: 0.5, seedSalt: 0 },
  paramSpec: {
    pAct: { min: 0.05, max: 0.6, type: 'float' },
    biasTai: { min: 0.3, max: 0.7, type: 'float' },
    seedSalt: { min: 0, max: 9999, step: 1, type: 'int' },
  },
  fn(ctx, p) {
    const key = `${ctx.eventId}:${ctx.minute}:${ctx.isH2 ? 1 : 0}:${p.seedSalt}`;
    const r = rand01FromKey(key);
    if (r >= p.pAct) return null;
    // second deterministic draw for the side.
    const rSide = rand01FromKey(`${key}:side`);
    return rSide < p.biasTai ? tai() : xiu();
  },
};
