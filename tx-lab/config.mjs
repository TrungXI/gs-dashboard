// config.mjs — all harness knobs in one place (SPEC §10).
// Strategy paramSpec ranges live in each strategies/*.mjs, NOT here.
export const config = {
  SEED: 42,

  // Fitness mode:
  //   'money'   = rank by evLB (95% lower-bound on EV per bet) — optimizes MONEY.
  //   'winfreq' = rank by wilsonLB (95% LB on break-even hit-rate) — the OLD,
  //               deceptive fitness that maximized bet-win frequency. A high
  //               hit-rate at tiny Malay payouts still loses money, which is
  //               exactly why Gen-1 climbed to "win 78% of bets" while ev_train
  //               got worse (−0.066 → −0.134).
  // Default 'money'. Override per-run: FITNESS=winfreq node tx-lab/run.mjs
  FITNESS: process.env.FITNESS === 'winfreq' ? 'winfreq' : 'money',

  // Max individuals of the SAME family allowed into the elite set each gen —
  // prevents diversity-collapse (the whole board becoming one family).
  MAX_ELITE_PER_FAMILY: 3,

  // Time split over the ~14-day window (boundaries computed in dataset.mjs from
  // the actual min/max match_date; these are day counts).
  TRAIN_DAYS: 10, // first N days -> train
  HOLDOUT_DAYS: 4, // last N days -> holdout

  // GA population / generations.
  POP_SIZE: 60, // clamped to [40, 100]
  INDIVIDUALS_PER_FAMILY: 5,
  GENERATIONS: 12,
  ELITE_K: 10,
  MUTATION_RATE: 0.4, // fraction of a genome's params jittered per mutation
  EXPLORER_FRACTION: 0.15, // fresh random individuals injected each generation

  // Sample-size gates.
  MIN_BETS: 100, // champion gate — user's "đủ 100 kèo"
  MIN_BETS_BREED: 30, // may breed below the champion gate
  MIN_BETS_HOLDOUT: 50, // holdout must have >= this many bets to be believed

  H2H_MIN_MEETINGS: 2,
  H1H2_MIN_N: 50, // min prior count per h1ToH2 bucket; below -> strategy PASSes
  NON_DECREASE_TOL: 0.01, // slack for the "ev rising" assertion

  // Genome pool for the GA:
  //   'G'   = generation-G open-only families (G1–G8) + randomExplorer baseline
  //   'F'   = legacy in-play families (F1–F12) + randomExplorer
  //   'ALL' = both sets + randomExplorer
  // Default 'G'. Override per-run: GEN_FAMILY_SET=F node tx-lab/run.mjs
  GEN_FAMILY_SET:
    process.env.GEN_FAMILY_SET === 'F' || process.env.GEN_FAMILY_SET === 'ALL'
      ? process.env.GEN_FAMILY_SET
      : 'G',

  // Half-1 duration in minutes per match type (for elapsedMinutes()).
  HALF_SPLIT: { '16p': 8, '20p': 10 },
  // Full match duration per type (for minutesRemaining).
  MATCH_DURATION: { '16p': 16, '20p': 20 },

  Z: 1.96, // 95% Wilson lower-bound z-score
};

export const POP_CLAMP = { min: 40, max: 100 };
