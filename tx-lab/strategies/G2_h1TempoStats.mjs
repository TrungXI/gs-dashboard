// G2 · h1TempoStats — H1 corners/cards adjust the continuation expectation.
//
// WHY OPEN-ONLY / DIFFERENT FROM F1–F12: corners + cards are fully present at
// the OPEN kickoff_h2 mark (they are the closed-H1 tallies). F4 only reacted to
// a red card as a discrete in-play event (on locked rows). Here H1 tempo
// (corners + weighted cards) continuously nudges the LEARNED H1→final prior up
// or down, then compares to the line. Prior is leak-free; tempoRef is a plain
// tunable threshold, not a hardcoded base rate.
import { tai, xiu } from './_helpers.mjs';

export const h1TempoStats = {
  id: 'h1TempoStats',
  gen: 'G',
  defaults: { wCards: 0.5, k: 0.15, tempoRef: 6, edge: 0.4 },
  paramSpec: {
    wCards: { min: 0, max: 1, type: 'float' },
    k: { min: 0, max: 0.4, type: 'float' },
    tempoRef: { min: 3, max: 12, type: 'float' },
    edge: { min: 0.1, max: 1.2, type: 'float' },
  },
  fn(ctx, p) {
    if (ctx.snapshotType !== 'kickoff_h2') return null;
    if (ctx.h1Total == null) return null;
    const E = ctx.priors?.h1ToH2?.expFinal(ctx.h1Total);
    if (E == null) return null;
    const corners = ctx.cornersHome + ctx.cornersAway;
    const cards = ctx.yellowHome + ctx.yellowAway + ctx.redHome + ctx.redAway;
    const tempo = corners + p.wCards * cards;
    const adjE = E + p.k * (tempo - p.tempoRef);
    if (adjE - ctx.ouLine >= p.edge) return tai();
    if (ctx.ouLine - adjE >= p.edge) return xiu();
    return null;
  },
};
