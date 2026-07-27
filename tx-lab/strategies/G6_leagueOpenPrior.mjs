// G6 · leagueOpenPrior — league/variant base-rate mean-reversion at open marks.
//
// WHY OPEN-ONLY / DIFFERENT FROM F1–F12: entry only at first_seen or kickoff_h2
// (both open). It keys the leak-free base rate by leagueTag (matchType + (S)/(V)
// variant) instead of bare matchType — the (S)/(V) split is a real goals-per-game
// difference the recon flagged. F5 used only matchType and ran on every (often
// locked) snapshot. No hardcoded numbers: the mean is learned from prior-only
// events under the leagueTag key (falls back to matchType if the tag is null).
import { tai, xiu } from './_helpers.mjs';

export const leagueOpenPrior = {
  id: 'leagueOpenPrior',
  gen: 'G',
  defaults: { band: 0.5, minPriorN: 50, atH2: true },
  paramSpec: {
    band: { min: 0, max: 1.5, type: 'float' },
    minPriorN: { min: 30, max: 500, step: 1, type: 'int' },
    atH2: { type: 'bool' },
  },
  fn(ctx, p) {
    const wantH2 = p.atH2 ? 'kickoff_h2' : 'first_seen';
    if (ctx.snapshotType !== wantH2) return null;
    // leagueTag base rate, fall back to matchType base rate if tag prior is thin.
    let prior = ctx.priors?.baseRateByLeague;
    if (!prior || prior.n < p.minPriorN) {
      prior = ctx.priors?.baseRateByType?.[ctx.matchType];
    }
    if (!prior || prior.n < p.minPriorN) return null;
    const expTotal = prior.mean;
    if (ctx.ouLine > expTotal + p.band) return xiu();
    if (ctx.ouLine < expTotal - p.band) return tai();
    return null;
  },
};
