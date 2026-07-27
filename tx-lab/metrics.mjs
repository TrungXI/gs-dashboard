// metrics.mjs — fitness metrics over a set of settled bets (SPEC §8).
// PRIMARY FITNESS = Wilson lower-bound (95%) on the break-even success rate.
// We rank by wilsonLB, NEVER raw winRate, so small samples are penalized.
import { config } from './config.mjs';

// A settled bet: { result, pnl, recordedAt, matchDate }.
// Compute the full metric bundle for a list of settled bets.
export function computeMetrics(bets) {
  const n = bets.length;
  let wins = 0;
  let halfWins = 0;
  let pushes = 0;
  let halfLoses = 0;
  let loses = 0;
  let pnl = 0;

  for (const b of bets) {
    pnl += b.pnl;
    switch (b.result) {
      case 'win':
        wins++;
        break;
      case 'half-win':
        halfWins++;
        break;
      case 'push':
        pushes++;
        break;
      case 'half-lose':
        halfLoses++;
        break;
      case 'lose':
        loses++;
        break;
      default:
        break;
    }
  }

  // winRate (pushes excluded) — reported, NOT used for ranking.
  const wrDen = wins + 0.5 * halfWins + loses + 0.5 * halfLoses;
  const winRate = wrDen > 0 ? (wins + 0.5 * halfWins) / wrDen : 0;

  const ev = n > 0 ? pnl / n : 0;

  // Wilson success indicator: a bet "succeeds" if its PnL > 0. half-win counts
  // as 0.5 success units; pushes are removed from the trial count.
  const successUnits = wins * 1 + halfWins * 0.5;
  const trials = n - pushes;
  const wilsonLB = wilsonLowerBound(successUnits, trials, config.Z);

  // MONEY fitness: 95% lower-bound on EV per bet. Unlike wilsonLB (which only
  // sees a win/lose indicator and is blind to Malay payout size), evLB is driven
  // by the actual per-bet PnL distribution — so a high-hit-rate/tiny-payout
  // strategy that bleeds cash gets a negative evLB and cannot win the GA.
  const { evLB, evMean, evSd } = evLowerBound(bets, ev, n, config.Z);

  return {
    n,
    wins,
    halfWins,
    pushes,
    halfLoses,
    loses,
    winRate,
    pnl,
    ev,
    wilsonLB,
    evLB, // primary fitness when config.FITNESS === 'money'
    evMean, // == ev (sample mean of per-bet pnl); kept explicit for the report
    evSd, // sample std (n-1) of per-bet pnl
    maxDrawdown: maxDrawdown(bets),
    pnlByBucket: pnlByBucket(bets),
  };
}

// 95% lower confidence bound on the mean per-bet PnL (money fitness).
//   mean = pnl/n, sd = sample std (n-1) of the per-bet pnl array,
//   se = sd/sqrt(n), evLB = mean − Z*se.
// With n < 2 the sd is undefined -> sd=0 -> evLB=mean (still gated by MIN_BETS).
export function evLowerBound(bets, mean, n, z) {
  if (n <= 0) return { evLB: 0, evMean: 0, evSd: 0 };
  let ss = 0;
  for (const b of bets) {
    const d = b.pnl - mean;
    ss += d * d;
  }
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  return { evLB: mean - z * se, evMean: mean, evSd: sd };
}

// Wilson score-interval lower bound at z (SPEC §8.1). trials may be fractional
// via successUnits but here trials is an integer count of non-push bets.
export function wilsonLowerBound(successUnits, trials, z) {
  if (trials <= 0) return 0;
  const nt = trials;
  const pHat = successUnits / nt;
  const z2 = z * z;
  const den = 1 + z2 / nt;
  const center = (pHat + z2 / (2 * nt)) / den;
  const margin =
    (z * Math.sqrt((pHat * (1 - pHat) + z2 / (4 * nt)) / nt)) / den;
  return center - margin;
}

// maxDrawdown = largest peak-to-trough drop of the cumulative-PnL curve, bets
// ordered by recorded_at.
export function maxDrawdown(bets) {
  const ordered = [...bets].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  );
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  for (const b of ordered) {
    cum += b.pnl;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

// pnlByBucket = cumulative PnL sampled per day (matchDate) -> "PnL over time".
export function pnlByBucket(bets) {
  const byDay = new Map();
  for (const b of bets) {
    const d = b.matchDate || 'unknown';
    byDay.set(d, (byDay.get(d) || 0) + b.pnl);
  }
  const days = [...byDay.keys()].sort();
  let cum = 0;
  return days.map((d) => {
    cum += byDay.get(d);
    return { day: d, dayPnl: byDay.get(d), cumPnl: cum };
  });
}
