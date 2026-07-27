// evolve.mjs — the genetic algorithm (SPEC §6).
//
// Individual = { familyId, params }. Fitness = Wilson lower-bound (95%) on the
// break-even success rate (metrics.wilsonLB) — NEVER raw winRate. Ranking:
// wilsonLB DESC, tie-break ev DESC, then n DESC. Champion gate = n >= MIN_BETS.
// Evolution runs on TRAIN only; the champion is scored on HOLDOUT exactly once.
import { config } from './config.mjs';
import { FAMILIES, FAMILY_BY_ID } from './strategies/index.mjs';
import { buildContext } from './context.mjs';
import { computeMetrics } from './metrics.mjs';
import { settle } from './settle.mjs';

// Resolve the sub-families a nested (meta) param spec references. Driven by the
// spec's own `families` id list, so both metaConsensus (F10) and
// metaOpenConsensus (G8) work without importing their panels directly.
function nestedFamilies(spec) {
  return (spec.families || []).map((id) => FAMILY_BY_ID[id]).filter(Boolean);
}

// -------- genome sampling / mutation ----------------------------------------

// Sample a single param value from its spec using the seeded rng.
function sampleParam(spec, rng) {
  switch (spec.type) {
    case 'bool':
      return rng.bool();
    case 'int':
      return rng.int(spec.min, spec.max);
    case 'float':
      return rng.float(spec.min, spec.max);
    default:
      return null; // 'nested' handled by caller
  }
}

// Build a full param object for a family (random, within ranges). For
// metaConsensus, also populate subParams for every panel family.
export function sampleParams(family, rng) {
  const out = {};
  for (const [name, spec] of Object.entries(family.paramSpec)) {
    if (spec.type === 'nested') {
      out[name] = {};
      for (const fam of nestedFamilies(spec)) {
        out[name][fam.id] = sampleParams(fam, rng);
      }
    } else {
      out[name] = sampleParam(spec, rng);
    }
  }
  return out;
}

// Reflect a value back into [min,max] (mutation bounce off bounds).
function reflect(v, min, max) {
  let x = v;
  const span = max - min;
  if (span <= 0) return min;
  // fold repeatedly until inside range
  let guard = 0;
  while ((x < min || x > max) && guard++ < 100) {
    if (x < min) x = min + (min - x);
    if (x > max) x = max - (x - max);
  }
  return Math.min(max, Math.max(min, x));
}

// Mutate one param per its spec.
function mutateParam(value, spec, rng) {
  if (spec.type === 'bool') {
    // flip with small probability
    return rng.bool(0.3) ? !value : value;
  }
  const span = spec.max - spec.min;
  const step = spec.step ?? span * 0.15;
  let v = value + rng.gaussian() * (spec.type === 'int' ? Math.max(1, step) : span * 0.15);
  v = reflect(v, spec.min, spec.max);
  if (spec.type === 'int') v = Math.round(v);
  return v;
}

// Mutate a whole genome: jitter MUTATION_RATE of the params.
export function mutateParams(family, params, rng) {
  const out = {};
  for (const [name, spec] of Object.entries(family.paramSpec)) {
    if (spec.type === 'nested') {
      out[name] = {};
      for (const fam of nestedFamilies(spec)) {
        const cur = params[name]?.[fam.id] ?? sampleParams(fam, rng);
        out[name][fam.id] = mutateParams(fam, cur, rng);
      }
      continue;
    }
    if (rng.next() < config.MUTATION_RATE) {
      out[name] = mutateParam(params[name], spec, rng);
    } else {
      out[name] = params[name];
    }
  }
  return out;
}

// Uniform crossover of two same-family genomes.
export function crossoverParams(family, a, b, rng) {
  const out = {};
  for (const [name, spec] of Object.entries(family.paramSpec)) {
    if (spec.type === 'nested') {
      out[name] = {};
      for (const fam of nestedFamilies(spec)) {
        out[name][fam.id] = crossoverParams(
          fam,
          a[name]?.[fam.id] ?? fam.defaults,
          b[name]?.[fam.id] ?? fam.defaults,
          rng,
        );
      }
      continue;
    }
    out[name] = rng.bool() ? a[name] : b[name];
  }
  return out;
}

// -------- population init ----------------------------------------------------

let __uid = 0;
function makeIndividual(familyId, params) {
  return { id: __uid++, familyId, params };
}

export function initPopulation(rng) {
  const pop = [];
  for (const fam of FAMILIES) {
    // one individual at defaults
    pop.push(makeIndividual(fam.id, cloneParams(fam.defaults)));
    for (let i = 1; i < config.INDIVIDUALS_PER_FAMILY; i++) {
      pop.push(makeIndividual(fam.id, sampleParams(fam, rng)));
    }
  }
  // clamp to POP_SIZE (may be < since families*ipf). If more than POP_SIZE,
  // trim; if fewer, pad with random explorers.
  const target = Math.min(100, Math.max(40, config.POP_SIZE));
  while (pop.length > target) pop.pop();
  while (pop.length < target) {
    const fam = rng.pick(FAMILIES);
    pop.push(makeIndividual(fam.id, sampleParams(fam, rng)));
  }
  return pop;
}

function cloneParams(p) {
  return JSON.parse(JSON.stringify(p));
}

// -------- backtesting --------------------------------------------------------

// Precompute the (event, opp, ctx) list once per split so every individual and
// every generation reuses the SAME contexts (contexts never depend on the
// strategy — they are pure functions of history). This is the hot path.
export function buildContexts(events) {
  const items = [];
  for (const ev of events) {
    for (const opp of ev.opportunities) {
      const ctx = buildContext(ev, opp);
      items.push({ ctx, finalTotal: ev.finalTotal }); // finalTotal kept OUT of ctx
    }
  }
  return items;
}

// Backtest one individual over a prebuilt context list -> metrics bundle.
export function backtestIndividual(indiv, contexts) {
  const family = FAMILY_BY_ID[indiv.familyId];
  const bets = [];
  for (const item of contexts) {
    let bet;
    try {
      bet = family.fn(item.ctx, indiv.params);
    } catch {
      bet = null;
    }
    if (!bet) continue;
    const side = bet.side;
    const price = side === 'tai' ? item.ctx.overPrice : item.ctx.underPrice;
    if (price === null || price === undefined) continue;
    const { result, pnl } = settle(side, item.ctx.ouLine, price, item.finalTotal);
    bets.push({
      result,
      pnl,
      recordedAt: item.ctx.recordedAt,
      matchDate: item.ctx.matchDate,
    });
  }
  return computeMetrics(bets);
}

// -------- ranking ------------------------------------------------------------

// Primary fitness field per config.FITNESS. NEVER raw winRate. Reviewer greps here.
//   'money'   -> evLB    (95% lower-bound on EV per bet — optimizes MONEY)
//   'winfreq' -> wilsonLB (95% LB on break-even hit-rate — legacy, deceptive)
export function primaryFitness(metrics) {
  return config.FITNESS === 'winfreq' ? metrics.wilsonLB : metrics.evLB;
}

// Rank comparator: primaryFitness DESC, then ev DESC, then n DESC.
export function rankComparator(a, b) {
  const fa = primaryFitness(a.metrics);
  const fb = primaryFitness(b.metrics);
  if (fb !== fa) return fb - fa;
  if (b.metrics.ev !== a.metrics.ev) return b.metrics.ev - a.metrics.ev;
  return b.metrics.n - a.metrics.n;
}

// Evaluate + rank a population on a context list.
export function evaluatePopulation(pop, contexts) {
  const scored = pop.map((indiv) => {
    const metrics = backtestIndividual(indiv, contexts);
    return {
      indiv,
      metrics,
      belowGate: metrics.n < config.MIN_BETS,
      canBreed: metrics.n >= config.MIN_BETS_BREED,
    };
  });
  scored.sort(rankComparator);
  return scored;
}

// -------- reproduction -------------------------------------------------------

// Select the elite set from a ranked, scored population, capping how many
// individuals of the SAME family may enter (config.MAX_ELITE_PER_FAMILY). This
// prevents diversity-collapse where one family (e.g. a high-hit-rate money-loser)
// clones itself across the whole elite board and the GA stops exploring others.
// Walks the already-ranked board top-down, skipping a family once its cap is hit.
export function selectElites(scored) {
  const cap = config.MAX_ELITE_PER_FAMILY ?? config.ELITE_K;
  const perFamily = new Map();
  const elites = [];
  for (const s of scored) {
    if (elites.length >= config.ELITE_K) break;
    const c = perFamily.get(s.indiv.familyId) || 0;
    if (c >= cap) continue;
    perFamily.set(s.indiv.familyId, c + 1);
    elites.push(s.indiv);
  }
  return elites;
}

// Produce the next generation from a ranked, scored population.
export function reproduce(scored, rng) {
  const target = Math.min(100, Math.max(40, config.POP_SIZE));
  const elites = selectElites(scored);

  const next = [];
  // 1) carry elites unchanged
  for (const e of elites) next.push(makeIndividual(e.familyId, cloneParams(e.params)));

  // 2) explorers: fresh random individuals
  const nExplorers = Math.round(target * config.EXPLORER_FRACTION);
  for (let i = 0; i < nExplorers && next.length < target; i++) {
    const fam = rng.pick(FAMILIES);
    next.push(makeIndividual(fam.id, sampleParams(fam, rng)));
  }

  // breeding pool = individuals allowed to breed (n >= MIN_BETS_BREED), fall
  // back to elites if the pool is empty.
  let pool = scored.filter((s) => s.canBreed).map((s) => s.indiv);
  if (pool.length === 0) pool = elites.slice();

  // 3) fill the rest via mutation + crossover of the pool
  while (next.length < target) {
    const useCrossover = rng.bool(0.5);
    if (useCrossover) {
      // pick two SAME-family parents
      const a = rng.pick(pool);
      const sameFam = pool.filter((p) => p.familyId === a.familyId);
      const b = sameFam.length > 1 ? rng.pick(sameFam) : a;
      const fam = FAMILY_BY_ID[a.familyId];
      const child = crossoverParams(fam, a.params, b.params, rng);
      next.push(makeIndividual(a.familyId, mutateParams(fam, child, rng)));
    } else {
      const parent = rng.pick(pool);
      const fam = FAMILY_BY_ID[parent.familyId];
      next.push(makeIndividual(parent.familyId, mutateParams(fam, parent.params, rng)));
    }
  }
  return next;
}

// -------- champion-ensemble ev (SPEC §6.5) ----------------------------------

// championEnsemble(g) = the top ELITE_K GATED individuals (n >= MIN_BETS),
// under the same per-family diversity cap used for breeding. Returns combined
// ev (pnl/bet) and total pnl for the "PnL up over time" curve.
export function championEnsembleEv(scored) {
  const gatedRanked = scored.filter((s) => !s.belowGate);
  const cap = config.MAX_ELITE_PER_FAMILY ?? config.ELITE_K;
  const perFamily = new Map();
  const gated = [];
  for (const s of gatedRanked) {
    if (gated.length >= config.ELITE_K) break;
    const c = perFamily.get(s.indiv.familyId) || 0;
    if (c >= cap) continue;
    perFamily.set(s.indiv.familyId, c + 1);
    gated.push(s);
  }
  let pnl = 0;
  let n = 0;
  for (const s of gated) {
    pnl += s.metrics.pnl;
    n += s.metrics.n;
  }
  return { ev: n > 0 ? pnl / n : 0, totalPnl: pnl, n, members: gated.length };
}

// Final champion = single gated individual (n >= MIN_BETS) with the highest
// TRAIN primary fitness (evLB in 'money' mode, wilsonLB in 'winfreq' mode).
// `scored` is already sorted by rankComparator, so gated[0] is the champion.
export function pickChampion(scored) {
  const gated = scored.filter((s) => !s.belowGate);
  return gated.length > 0 ? gated[0] : null;
}
