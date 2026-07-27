// rng.mjs — seeded, deterministic PRNG (mulberry32).
// Used everywhere the GA needs randomness (population init, mutation, crossover,
// explorer injection, and the randomExplorer strategy's per-event coin flip) so
// that two runs at the same config.SEED produce an identical champion.json.
// No Math.random() anywhere in the harness — determinism is a Reviewer gate.

// mulberry32: tiny 32-bit PRNG. Given a uint32 seed it returns a function that
// yields floats in [0,1). Good enough statistical quality for a backtest RNG.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic string -> uint32 hash (FNV-1a). Lets us derive a stable seed
// from things like `event_id + minute` (used by randomExplorer) so the same
// opportunity always gets the same coin flip regardless of population order.
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A small RNG wrapper carrying helpers the GA needs.
export function makeRng(seed) {
  const next = mulberry32(seed >>> 0);
  return {
    next, // float in [0,1)
    int(min, max) {
      // inclusive integer in [min, max]
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    bool(pTrue = 0.5) {
      return next() < pTrue;
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    // Standard normal via Box–Muller (for Gaussian mutation jitter).
    gaussian() {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

// Single-value deterministic float in [0,1) from an arbitrary key. Used by
// randomExplorer so its action decision does not depend on any shared RNG
// stream (which would make it order-dependent across the population).
export function rand01FromKey(key) {
  return mulberry32(hashSeed(key))();
}
