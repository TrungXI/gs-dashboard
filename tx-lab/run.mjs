// run.mjs — CLI entrypoint. Orchestrates: load DB (read-only) -> assemble
// events -> split train/holdout -> attach leak-free priors -> GA over TRAIN ->
// evaluate champion on HOLDOUT exactly once -> write results + honest verdict.
//
// Read-only. No DB writes, no Telegram, no gs_tx_paper. Deterministic at
// config.SEED (two runs => identical champion.json).
import { config } from './config.mjs';
import { fetchAllRows } from './db.mjs';
import { assembleEvents, splitByDate, attachPriors } from './dataset.mjs';
import { makeRng } from './rng.mjs';
import {
  initPopulation,
  buildContexts,
  evaluatePopulation,
  reproduce,
  championEnsembleEv,
  pickChampion,
  backtestIndividual,
} from './evolve.mjs';
import {
  printRankedTable,
  writeGeneration,
  writeChampion,
  writeReport,
  decideVerdict,
} from './report.mjs';

async function main() {
  const t0 = Date.now();
  console.log(`TX-Evolution harness — SEED=${config.SEED}`);
  console.log('Loading match_odds_log (read-only)...');
  const rows = await fetchAllRows();
  console.log(`  rows: ${rows.length}`);

  const allEvents = assembleEvents(rows);
  const totalOpps = allEvents.reduce((s, e) => s + e.opportunities.length, 0);
  const lockedSkipped = allEvents.lockedSkipped || 0;
  const wouldBe = totalOpps + lockedSkipped;
  const lockedPct = wouldBe > 0 ? (100 * lockedSkipped) / wouldBe : 0;
  console.log(`  settle-able events (reach H2): ${allEvents.length}`);
  console.log(
    `  tradeable entries (betting_open only): ${totalOpps} | ` +
      `dropped as LOCKED: ${lockedSkipped} (${lockedPct.toFixed(1)}% of usable-line snapshots)`,
  );

  // Split BEFORE priors so priors are attached over the full timeline (priors
  // for any event only ever read strictly-earlier dates — see dataset.mjs).
  const split = splitByDate(allEvents, config.TRAIN_DAYS, config.HOLDOUT_DAYS);
  attachPriors(allEvents, config.H2H_MIN_MEETINGS, config.H1H2_MIN_N);
  console.log(
    `  train days: ${split.trainDays.length} (${split.train.length} events) | ` +
      `holdout days: ${split.holdoutDays.length} (${split.holdout.length} events)`,
  );

  const trainContexts = buildContexts(split.train);
  const holdoutContexts = buildContexts(split.holdout);
  console.log(
    `  train opportunities: ${trainContexts.length} | holdout: ${holdoutContexts.length}`,
  );

  const rng = makeRng(config.SEED);
  let population = initPopulation(rng);

  const evTrainSeries = [];
  let finalTrainBoard = null;

  for (let g = 0; g < config.GENERATIONS; g++) {
    const scored = evaluatePopulation(population, trainContexts);
    const ens = championEnsembleEv(scored);
    evTrainSeries.push({ gen: g, ...ens });

    printRankedTable(scored, 15, `Generation ${g} (train)`);
    console.log(
      `  ensemble ev_train(${g}) = ${ens.ev.toFixed(5)} over ${ens.n} bets ` +
        `(${ens.members} gated members)`,
    );
    writeGeneration(g, scored, {
      seed: config.SEED,
      trainDays: split.trainDays,
      holdoutDays: split.holdoutDays,
      ensemble: ens,
    });

    finalTrainBoard = scored;
    if (g < config.GENERATIONS - 1) {
      population = reproduce(scored, rng);
    }
  }

  // ev_train non-decreasing check (allow NON_DECREASE_TOL slack).
  let nonDecreasing = true;
  for (let i = 1; i < evTrainSeries.length; i++) {
    if (evTrainSeries[i].ev < evTrainSeries[i - 1].ev - config.NON_DECREASE_TOL) {
      nonDecreasing = false;
      break;
    }
  }

  // Champion = highest-train-wilsonLB gated individual. Evaluate ONCE on holdout.
  const champScored = pickChampion(finalTrainBoard);
  let champTrain = null;
  let champHoldout = null;
  if (champScored) {
    champTrain = {
      familyId: champScored.indiv.familyId,
      params: champScored.indiv.params,
      metrics: champScored.metrics,
    };
    const hm = backtestIndividual(champScored.indiv, holdoutContexts);
    champHoldout = { familyId: champScored.indiv.familyId, ...hm };
  }

  // Full holdout board (all individuals from the final population), for the
  // randomExplorer-survival check + the report's holdout leaderboard.
  const holdoutBoard = evaluatePopulation(population, holdoutContexts);
  printRankedTable(holdoutBoard, 15, 'Final population on HOLDOUT');

  const verdictObj = decideVerdict({
    champHoldout,
    evTrainSeries,
    holdoutBoard,
    nonDecreasing,
  });

  writeChampion({
    seed: config.SEED,
    familyId: champTrain ? champTrain.familyId : null,
    params: champTrain ? champTrain.params : null,
    train: champTrain ? champTrain.metrics : null,
    holdout: champHoldout,
    verdict: verdictObj.verdict,
    warnings: verdictObj.warnings,
    nonDecreasing,
  });

  writeReport({
    split,
    evTrainSeries,
    nonDecreasing,
    champTrain,
    champHoldout,
    finalTrainBoard,
    holdoutBoard,
    verdictObj,
    tradeable: { totalOpps, lockedSkipped, lockedPct },
  });

  console.log('\n================ VERDICT ================');
  console.log(verdictObj.verdict);
  for (const w of verdictObj.warnings) console.log(w);
  console.log(`\nev_train series: ${evTrainSeries.map((e) => e.ev.toFixed(4)).join(' -> ')}`);
  console.log(`non-decreasing: ${nonDecreasing}`);
  console.log(`\nWrote tx-lab/results/{gen-*.json, champion.json, report.md}`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
