// report.mjs — console tables + JSON + markdown, with the mandatory honesty
// verdict (SPEC §9). Never smooths, hand-picks, or re-seeds for a nicer curve.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');

function ensureResults() {
  mkdirSync(RESULTS, { recursive: true });
}

function fmt(x, d = 3) {
  return Number.isFinite(x) ? x.toFixed(d) : String(x);
}

// Console ranked table (top N).
export function printRankedTable(scored, topN, label) {
  console.log(`\n=== ${label} (top ${topN}) · FITNESS=${config.FITNESS} ===`);
  console.log('rank | family                | n    | winRate | ev      | evLB     | wilsonLB | maxDD  | gate');
  const rows = scored.slice(0, topN);
  rows.forEach((s, i) => {
    const m = s.metrics;
    console.log(
      `${String(i + 1).padStart(4)} | ${s.indiv.familyId.padEnd(21)} | ` +
        `${String(m.n).padStart(4)} | ${fmt(m.winRate, 3).padStart(7)} | ` +
        `${fmt(m.ev, 4).padStart(7)} | ${fmt(m.evLB, 4).padStart(8)} | ` +
        `${fmt(m.wilsonLB, 4).padStart(8)} | ` +
        `${fmt(m.maxDrawdown, 2).padStart(6)} | ${s.belowGate ? 'below' : 'OK'}`,
    );
  });
}

// Write one generation snapshot.
export function writeGeneration(genIndex, scored, meta) {
  ensureResults();
  const payload = {
    generation: genIndex,
    ...meta,
    population: scored.map((s) => ({
      familyId: s.indiv.familyId,
      params: s.indiv.params,
      metrics: s.metrics,
      belowGate: s.belowGate,
    })),
  };
  const name = `gen-${String(genIndex).padStart(2, '0')}.json`;
  writeFileSync(join(RESULTS, name), JSON.stringify(payload, null, 2));
}

export function writeChampion(champ) {
  ensureResults();
  writeFileSync(join(RESULTS, 'champion.json'), JSON.stringify(champ, null, 2));
}

// -------- honesty verdict (SPEC §9) -----------------------------------------

// Decide the verdict from champion holdout metrics + evTrain series + whether a
// randomExplorer topped the holdout board.
export function decideVerdict({
  champHoldout,
  evTrainSeries,
  holdoutBoard,
  nonDecreasing,
}) {
  const warnings = [];

  // Did the noise baseline survive in the holdout top-ELITE_K?
  const explorerTops = holdoutBoard
    .slice(0, config.ELITE_K)
    .some((s) => s.indiv.familyId === 'randomExplorer' && !s.belowGate);
  if (explorerTops) {
    warnings.push(
      'WARNING: noise baseline (randomExplorer) survived — the signal families are not beating random.',
    );
  }
  // Did the TRAIN-selected champion itself turn out to be pure noise? That is
  // the loudest "no signal" flag: the harness could not tell a real family from
  // random on the training split.
  if (champHoldout && champHoldout.familyId === 'randomExplorer') {
    warnings.push(
      'WARNING: the train-selected champion is randomExplorer (pure noise) — ' +
        'the training split could not distinguish a real family from random. ' +
        'Any positive holdout number from a signal family below was NOT selected out-of-sample.',
    );
  }

  // Hard PnL gate is ALWAYS ev > 0 (real money must be positive on holdout).
  // Confidence gate depends on fitness mode:
  //   money   -> evLB > 0     (95% lower-bound on EV per bet excludes zero)
  //   winfreq -> wilsonLB > 0.5 (hit-rate lower-bound excludes a coin flip)
  const moneyMode = config.FITNESS === 'money';
  const confidenceOk = moneyMode
    ? champHoldout && champHoldout.evLB > 0
    : champHoldout && champHoldout.wilsonLB > 0.5;
  const gatesPass =
    champHoldout &&
    champHoldout.ev > 0 &&
    confidenceOk &&
    champHoldout.n >= config.MIN_BETS_HOLDOUT;

  // The confidence figure quoted in the verdict text matches the active mode.
  const confLabel = moneyMode ? 'evLB' : 'wilsonLB';
  const confVal = (h) => (moneyMode ? h.evLB : h.wilsonLB);

  let verdict;
  if (gatesPass && !explorerTops && nonDecreasing) {
    verdict =
      `EDGE CANDIDATE: ${champHoldout.familyId} — holdout ev=${fmt(champHoldout.ev, 4)}, ` +
      `${confLabel}=${fmt(confVal(champHoldout), 4)}, n=${champHoldout.n}. Promote to Phase-1 paper.`;
  } else {
    const bestEv = champHoldout ? fmt(champHoldout.ev, 4) : 'n/a';
    const bestLb = champHoldout ? fmt(confVal(champHoldout), 4) : 'n/a';
    verdict =
      `NO DURABLE EDGE FOUND. Best holdout ev=${bestEv} with ${confLabel}=${bestLb} — ` +
      `this is within noise. Do NOT promote. These numbers are noise, not signal.`;
  }
  return { verdict, warnings, gatesPass, explorerTops, nonDecreasing };
}

// -------- markdown report ----------------------------------------------------

export function writeReport({
  split,
  evTrainSeries,
  nonDecreasing,
  champTrain,
  champHoldout,
  finalTrainBoard,
  holdoutBoard,
  verdictObj,
  tradeable,
}) {
  ensureResults();
  const L = [];
  L.push('# TX-Evolution Harness — Phase 0 Backtest Report\n');
  L.push(`_First full run at SEED=${config.SEED}. No smoothing, no re-seeding._\n`);
  L.push(
    `**Fitness mode: \`${config.FITNESS}\`** ` +
      `(${config.FITNESS === 'money' ? 'rank by evLB — 95% lower-bound on EV per bet, optimizes MONEY' : 'rank by wilsonLB — 95% LB on break-even hit-rate, legacy/deceptive'}). ` +
      `Elite per-family cap: ${config.MAX_ELITE_PER_FAMILY}.\n`,
  );

  L.push('## Split');
  L.push(`- Train days (${split.trainDays.length}): ${split.trainDays.join(', ')}`);
  L.push(`- Holdout days (${split.holdoutDays.length}): ${split.holdoutDays.join(', ')}`);
  L.push(`- Train events: ${split.train.length} | Holdout events: ${split.holdout.length}`);
  if (tradeable) {
    L.push(
      `- **Tradeable universe (betting_open only): ${tradeable.totalOpps} entries** — ` +
        `dropped ${tradeable.lockedSkipped} LOCKED snapshots ` +
        `(${tradeable.lockedPct.toFixed(1)}% of usable-line snapshots). ` +
        `The live bot cannot bet while the book is locked, so neither does the backtest; ` +
        `history/priors still see locked rows.`,
    );
  }
  L.push('');

  L.push('## GA config');
  L.push('```');
  for (const k of ['SEED', 'POP_SIZE', 'GENERATIONS', 'ELITE_K', 'MUTATION_RATE', 'EXPLORER_FRACTION', 'MIN_BETS', 'MIN_BETS_BREED', 'MIN_BETS_HOLDOUT', 'TRAIN_DAYS', 'HOLDOUT_DAYS']) {
    L.push(`${k} = ${config[k]}`);
  }
  L.push('```\n');

  L.push('## PnL up over time — champion-ensemble ev_train(g)');
  L.push('`ev_train(g)` = combined PnL/bet of the top-ELITE_K GATED individuals each generation.\n');
  L.push('| gen | members | n | totalPnl | ev_train |');
  L.push('|----:|--------:|--:|---------:|---------:|');
  for (const e of evTrainSeries) {
    L.push(`| ${e.gen} | ${e.members} | ${e.n} | ${fmt(e.totalPnl, 3)} | ${fmt(e.ev, 5)} |`);
  }
  L.push(`\n**ev_train non-decreasing (tol ${config.NON_DECREASE_TOL}): ${nonDecreasing ? 'YES' : 'NO'}**\n`);

  L.push('## Champion — train vs holdout');
  if (champTrain) {
    L.push(`- Family: \`${champTrain.familyId}\``);
    L.push('- Params:');
    L.push('```json');
    L.push(JSON.stringify(champTrain.params, null, 2));
    L.push('```');
    L.push('| split | n | winRate | ev | evLB | wilsonLB | maxDD |');
    L.push('|-------|--:|--------:|---:|-----:|---------:|------:|');
    L.push(`| train | ${champTrain.metrics.n} | ${fmt(champTrain.metrics.winRate)} | ${fmt(champTrain.metrics.ev, 4)} | ${fmt(champTrain.metrics.evLB, 4)} | ${fmt(champTrain.metrics.wilsonLB, 4)} | ${fmt(champTrain.metrics.maxDrawdown, 2)} |`);
    if (champHoldout) {
      L.push(`| holdout | ${champHoldout.n} | ${fmt(champHoldout.winRate)} | ${fmt(champHoldout.ev, 4)} | ${fmt(champHoldout.evLB, 4)} | ${fmt(champHoldout.wilsonLB, 4)} | ${fmt(champHoldout.maxDrawdown, 2)} |`);
    } else {
      L.push('| holdout | (no champion cleared the train gate) |');
    }
  } else {
    L.push('- No gated champion on train (no individual reached MIN_BETS).');
  }
  L.push('');

  L.push('## Final holdout board (top 15)');
  L.push('| rank | family | n | winRate | ev | evLB | wilsonLB | gate |');
  L.push('|-----:|--------|--:|--------:|---:|-----:|---------:|------|');
  holdoutBoard.slice(0, 15).forEach((s, i) => {
    L.push(`| ${i + 1} | ${s.indiv.familyId} | ${s.metrics.n} | ${fmt(s.metrics.winRate)} | ${fmt(s.metrics.ev, 4)} | ${fmt(s.metrics.evLB, 4)} | ${fmt(s.metrics.wilsonLB, 4)} | ${s.belowGate ? 'below' : 'OK'} |`);
  });
  L.push('');

  L.push('## Verdict');
  L.push(`**${verdictObj.verdict}**\n`);
  for (const w of verdictObj.warnings) L.push(`- ${w}`);
  L.push('');

  const md = L.join('\n');
  writeFileSync(join(RESULTS, 'report.md'), md);
  return md;
}

export { RESULTS };
