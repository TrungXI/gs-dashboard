// run.mjs — entrypoint. `npm run rung:run`
//
// Verdict mặc định là INSUFFICIENT_DATA. Harness được viết để tự chứng minh
// mình sai trước khi tin mình đúng: mọi khối §6.1–§6.9 đều in ra, kể cả khi xấu.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.mjs';
import { fetchLeague } from './db.mjs';
import { buildDataset, MINUTES as M } from './dataset.mjs';
import {
  BetStore,
  emitCombo,
  emitE3,
  enumerateCombos,
  comboKey,
  comboLabel,
  newFunnel,
} from './families.mjs';
import { buildGrid, scoreAll, scoreRange, shuffleNull, empiricalPct } from './grid.mjs';
import { gradeLeg } from './engine.mjs';
import { indexCombos, plateau, e2RoiFor, gates, daysNeeded, verdictOf } from './validate.mjs';
import { makeRng } from '../rng.mjs';
import { renderReport } from './report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');

const t0 = Date.now();
const log = (s) => process.stderr.write(`${s}\n`);

// ---------------------------------------------------------------------------
log(`[rung] league=${config.LEAGUE} tol=${config.MINUTE_TOL} shuffles=${config.SHUFFLES}`);
const raw = await fetchLeague(config.LEAGUE);
log(`[rung] ticks=${raw.ticks.length} history=${raw.history.length} (${Date.now() - t0}ms)`);

const dsByTol = new Map();
for (const tol of config.TOL_SWEEP) dsByTol.set(tol, buildDataset(raw, tol));
const ds = dsByTol.get(config.MINUTE_TOL) ?? buildDataset(raw, config.MINUTE_TOL);
log(`[rung] units=${ds.nUnits} days=${ds.days.join(',')} (${Date.now() - t0}ms)`);

// --- hợp đồng dữ liệu §1.3: cột phẳng phải là nấc 0 của ladder ---------------
const la = raw.ladderAssert;
const ftRate = Number(la.ft_have) ? Number(la.ft_match) / Number(la.ft_have) : 1;
const h1Rate = Number(la.h1_have) ? Number(la.h1_match) / Number(la.h1_have) : 1;
if (ftRate < 0.99 || h1Rate < 0.99) {
  throw new Error(
    `HỢP ĐỒNG DỮ LIỆU ĐÃ ĐỔI: cột phẳng không còn là nấc 0 của ladder ` +
      `(ft ${(ftRate * 100).toFixed(1)}%, h1 ${(h1Rate * 100).toFixed(1)}%). Dừng.`,
  );
}

// --- lưới chính --------------------------------------------------------------
const combos = enumerateCombos();
const { store, ranges } = buildGrid(ds, combos);
log(`[rung] combos=${combos.length} bets=${store.n} (${Date.now() - t0}ms)`);
const metrics = scoreAll(ds, store, ranges, combos.length);
log(`[rung] scored (${Date.now() - t0}ms)`);

// --- họ E: baseline / control (§2.6) ----------------------------------------
function runOne(dataset, spec, withFunnel = false) {
  const s = new BetStore(4096);
  const f = withFunnel ? newFunnel() : null;
  emitCombo(dataset, spec, s, f);
  return { m: scoreRange(dataset, s, 0, s.n), funnel: f, store: s };
}

const E1 = {};
const E1b = {};
for (const half of config.HALVES) {
  const base = { family: 'A', ...config.E1, half, gateMode: 'SPEC' };
  E1[half] = runOne(ds, base, true);
  E1b[half] = runOne(ds, { ...base, gateMode: 'BOT' }, true);
}

const e2Rows = [];
const e2Map = new Map();
for (const half of config.HALVES) {
  for (const Y of config.E2_Y) {
    for (const GAP of config.GAP_LIST) {
      const spec = { family: 'E2', Y, GAP, half, PMIN: -Infinity, PMAX: Infinity, gateMode: 'SPEC' };
      const r = runOne(ds, spec);
      const gap = GAP === 'PREFER_05' ? 'P' : String(GAP);
      e2Rows.push({ Y, GAP, half, ...r.m });
      e2Map.set(`${Y}|${gap}|${half}`, r.m);
    }
  }
}

const e3Rows = [];
for (const half of config.HALVES) {
  const rng = makeRng(config.SEED + (half === 'H1' ? 1 : 2));
  const acc = { n: 0, roi: 0, winRate: 0, evLB: 0, mdd: 0, betsPerDay: 0 };
  for (let r = 0; r < config.E3_REPS; r++) {
    const s = new BetStore(4096);
    emitE3(ds, half, rng, s);
    const m = scoreRange(ds, s, 0, s.n);
    acc.n += m.n;
    acc.roi += m.roi;
    acc.winRate += m.winRate;
    acc.evLB += m.evLB;
    acc.mdd += m.mdd;
    acc.betsPerDay += m.betsPerDay;
  }
  const k = config.E3_REPS;
  e3Rows.push({ half, n: acc.n / k, roi: acc.roi / k, winRate: acc.winRate / k, evLB: acc.evLB / k, mdd: acc.mdd / k, betsPerDay: acc.betsPerDay / k });
}
log(`[rung] baselines done (${Date.now() - t0}ms)`);

// --- §6.2 cao nguyên ---------------------------------------------------------
const index = indexCombos(combos);
const plats = new Array(combos.length).fill(null);
for (let i = 0; i < combos.length; i++) {
  if (metrics[i].n >= config.WEAK_MIN_BETS) plats[i] = plateau(combos, metrics, index, i);
}

// --- §6.4 grid-max shuffle ---------------------------------------------------
const nullDist = shuffleNull(
  ds,
  store,
  ranges,
  combos,
  metrics,
  makeRng(config.SEED),
  config.SHUFFLES,
);
log(`[rung] shuffle done (${Date.now() - t0}ms)`);

// --- cổng 1..7 cho mọi tổ hợp ------------------------------------------------
const e2roiOf = combos.map((s) => e2RoiFor(s, e2Map));
const gate17 = combos.map((s, i) =>
  gates(s, metrics[i], plats[i], nullDist.get(s.family), e2roiOf[i], null),
);

const order = [...combos.keys()].sort((a, b) => {
  const d = gate17[b].passed17 - gate17[a].passed17;
  if (d) return d;
  return metrics[b].evLB - metrics[a].evLB;
});

// --- §6.5 prior chéo (chỉ cho top ứng viên — mỗi lần chạy là một dataset mới) -
const crossDs = new Map();
for (const lg of config.CROSS_LEAGUES) {
  const rawX = await fetchLeague(lg);
  crossDs.set(lg, buildDataset(rawX, config.MINUTE_TOL));
  log(`[rung] cross ${lg}: units=${crossDs.get(lg).nUnits} (${Date.now() - t0}ms)`);
}
function crossRun(spec) {
  return config.CROSS_LEAGUES.map((lg) => {
    const d = crossDs.get(lg);
    const r = runOne(d, spec);
    return { league: lg, matchType: d.matchType, ...r.m };
  });
}

const topIdx = order.slice(0, config.CROSS_CANDIDATES);
const crossByIdx = new Map();
for (const i of topIdx) crossByIdx.set(i, crossRun(combos[i]));

const gate18 = new Map();
for (const i of topIdx) {
  gate18.set(
    i,
    gates(combos[i], metrics[i], plats[i], nullDist.get(combos[i].family), e2roiOf[i], crossByIdx.get(i)),
  );
}
const champIdx = topIdx.length
  ? topIdx.slice().sort((a, b) => {
      const d = gate18.get(b).passedAll - gate18.get(a).passedAll;
      if (d) return d;
      return metrics[b].evLB - metrics[a].evLB;
    })[0]
  : -1;

// --- §6.6 độ bền TOL (chạy lại TOÀN LƯỚI ở mỗi mức dung sai) -----------------
const tolRows = [];
for (const tol of config.TOL_SWEEP) {
  const d = dsByTol.get(tol);
  if (champIdx < 0) break;
  const g = buildGrid(d, combos);
  const ms = scoreAll(d, g.store, g.ranges, combos.length);
  let bestRoi = -Infinity;
  let bestLabel = '';
  for (let i = 0; i < combos.length; i++) {
    if (ms[i].n >= config.MIN_BETS && ms[i].roi > bestRoi) {
      bestRoi = ms[i].roi;
      bestLabel = comboLabel(combos[i]);
    }
  }
  tolRows.push({ tol, champ: ms[champIdx], gridBestRoi: bestRoi, gridBestLabel: bestLabel });
  log(`[rung] tol=${tol} champ n=${ms[champIdx].n} roi=${(ms[champIdx].roi * 100).toFixed(2)}%`);
}
const tolSpread =
  tolRows.length > 1
    ? Math.max(...tolRows.map((r) => r.champ.roi)) - Math.min(...tolRows.map((r) => r.champ.roi))
    : 0;
const fragileTol = tolSpread > config.FRAGILE_TOL_SPREAD;

// --- verdict -----------------------------------------------------------------
const champ =
  champIdx >= 0
    ? {
        idx: champIdx,
        spec: combos[champIdx],
        label: comboLabel(combos[champIdx]),
        key: comboKey(combos[champIdx]),
        m: metrics[champIdx],
        plat: plats[champIdx],
        cross: crossByIdx.get(champIdx),
        gate: gate18.get(champIdx),
        e2roi: e2roiOf[champIdx],
        funnel: runOne(ds, combos[champIdx], true).funnel,
        need: daysNeeded(metrics[champIdx]),
      }
    : null;
const verdict = champ ? verdictOf(champ.gate, champ.m, fragileTol) : 'INSUFFICIENT_DATA';

// --- §7 (verdict INSUFFICIENT_DATA) bộ tham số paper: BỀN nhất, không phải ROI cao nhất
let paper = null;
{
  let best = null;
  for (let i = 0; i < combos.length; i++) {
    const m = metrics[i];
    if (m.n < config.MIN_BETS) continue;
    if (!(m.roiEarly > 0 && m.roiLate > 0)) continue;
    const p = plats[i];
    if (!p || !Number.isFinite(p.medianNb)) continue;
    if (!best || p.medianNb > best.medianNb) best = { i, medianNb: p.medianNb };
  }
  if (best)
    paper = {
      label: comboLabel(combos[best.i]),
      spec: combos[best.i],
      m: metrics[best.i],
      medianNb: best.medianNb,
      cross: crossRun(combos[best.i]),
    };
}

// --- §6.1 bao nhiêu tổ hợp vượt cổng OOS ------------------------------------
let eligible = 0;
let passOos = 0;
for (let i = 0; i < combos.length; i++) {
  if (metrics[i].n < config.MIN_BETS) continue;
  eligible++;
  if (metrics[i].roiEarly > 0 && metrics[i].roiLate > 0) passOos++;
}

// --- T2b: availability ladder theo phút + số lệnh có giá gate âm ------------
const avail = [];
for (let m = 25; m <= config.MAX_ENTRY_MIN; m++) {
  const row = { minute: m, H1: { g05: 0, g075: 0, other: 0, open: 0 }, H2: { g05: 0, g075: 0, other: 0, open: 0 } };
  for (const u of ds.units) {
    if (u.srcMinute[m] < 0 || !u.open[m]) continue;
    const h = row[u.half];
    h.open++;
    if (!Number.isNaN(u.l05[m])) h.g05++;
    if (!Number.isNaN(u.l075[m])) h.g075++;
    if (Number.isNaN(u.l05[m]) && Number.isNaN(u.l075[m])) h.other++;
  }
  avail.push(row);
}
let negGateBets = 0;
if (champ) {
  const s = champ.spec;
  const flagMin = s.family === 'C' ? s.Y : s.X;
  const st = new BetStore(4096);
  emitCombo(ds, s, st, null);
  for (let i = 0; i < st.n; i++) {
    const u = ds.units[st.unitIdx[i]];
    if (u.gate[flagMin] > 1) negGateBets++;
  }
}

// --- T8: PnL theo ngày của ứng viên -----------------------------------------
let byDay = [];
if (champ) {
  const st = new BetStore(4096);
  emitCombo(ds, champ.spec, st, null);
  const map = new Map();
  for (let i = 0; i < st.n; i++) {
    const u = ds.units[st.unitIdx[i]];
    const g = gradeLeg('tai', st.line[i], st.over[i], u.finalTotal);
    const cur = map.get(u.day) ?? { n: 0, pnl: 0 };
    cur.n++;
    cur.pnl += g.pnl;
    map.set(u.day, cur);
  }
  let cum = 0;
  byDay = [...map.keys()].sort().map((d) => {
    cum += map.get(d).pnl;
    return { day: d, n: map.get(d).n, pnl: map.get(d).pnl, cum };
  });
}

// --- §6.4 phân vị thực nghiệm của ROI quan sát ------------------------------
const shuffleRows = [];
for (const [family, dist] of nullDist) {
  let obs = -Infinity;
  let obsLabel = '';
  for (let i = 0; i < combos.length; i++) {
    if (combos[i].family !== family) continue;
    if (metrics[i].n < config.MIN_BETS) continue;
    if (metrics[i].roi > obs) {
      obs = metrics[i].roi;
      obsLabel = comboLabel(combos[i]);
    }
  }
  shuffleRows.push({
    family,
    obs,
    obsLabel,
    eligible: dist.eligible,
    p50: dist.p50,
    p90: dist.p90,
    p95: dist.p95,
    p99: dist.p99,
    empirical: empiricalPct(dist.samples, obs),
    pass: Number.isFinite(dist.p95) && obs > dist.p95,
  });
}

// --- T4 top 20 mỗi họ --------------------------------------------------------
const topByFamily = new Map();
for (const f of config.FAMILIES) {
  const idxs = order.filter((i) => combos[i].family === f).slice(0, 20);
  topByFamily.set(
    f,
    idxs.map((i) => ({
      i,
      spec: combos[i],
      m: metrics[i],
      gate: (gate18.get(i) ?? gate17[i]).str,
      plat: plats[i],
    })),
  );
}

// --- T5 heatmap --------------------------------------------------------------
let heat = null;
if (champ) {
  const s = champ.spec;
  const rowsK = s.family === 'C' ? config.C_K : s.family === 'B' ? config.B_X : config.A_X;
  const colsY = s.family === 'B' ? config.B_Y0 : s.family === 'C' ? config.C_Y : config.A_Y;
  heat = { rowLabel: s.family === 'C' ? 'K' : 'X', colLabel: s.family === 'B' ? 'Y0' : 'Y', rows: [] };
  for (const rk of rowsK) {
    const cells = [];
    for (const y of colsY) {
      const probe =
        s.family === 'A'
          ? { ...s, X: rk, Y: y }
          : s.family === 'B'
            ? { ...s, X: rk, Y0: y }
            : { ...s, K: rk, Y: y };
      const j = index.get(comboKey(probe));
      cells.push(j == null ? null : metrics[j]);
    }
    heat.rows.push({ key: rk, cells });
  }
  heat.cols = colsY;
}

// ---------------------------------------------------------------------------
const ctx = {
  config,
  ds,
  combos,
  metrics,
  comboCount: combos.length,
  betCount: store.n,
  E1,
  E1b,
  e2Rows,
  e3Rows,
  topByFamily,
  tolRows,
  tolSpread,
  fragileTol,
  shuffleRows,
  champ,
  verdict,
  paper,
  eligible,
  passOos,
  avail,
  negGateBets,
  byDay,
  heat,
  elapsedMs: Date.now() - t0,
};

const report = renderReport(ctx);
process.stdout.write(`${report}\n`);

mkdirSync(RESULTS, { recursive: true });
writeFileSync(join(RESULTS, `report-${config.LEAGUE}.md`), `${report}\n`);
writeFileSync(
  join(RESULTS, `grid-${config.LEAGUE}.json`),
  JSON.stringify(
    combos.map((s, i) => ({
      ...s,
      PMAX: Number.isFinite(s.PMAX) ? s.PMAX : 'Infinity',
      ...metrics[i],
      gates: (gate18.get(i) ?? gate17[i]).str,
    })),
    null,
    0,
  ),
);
writeFileSync(
  join(RESULTS, `champion-${config.LEAGUE}.json`),
  JSON.stringify(
    {
      verdict,
      league: config.LEAGUE,
      seed: config.SEED,
      minuteTol: config.MINUTE_TOL,
      shuffles: config.SHUFFLES,
      comboCount: combos.length,
      champion: champ
        ? {
            label: champ.label,
            spec: { ...champ.spec, PMAX: Number.isFinite(champ.spec.PMAX) ? champ.spec.PMAX : 'Infinity' },
            metrics: champ.m,
            gates: champ.gate.str,
            e2roi: champ.e2roi,
            cross: champ.cross,
            need: champ.need,
            plateau: champ.plat,
            funnel: champ.funnel,
            byDay,
          }
        : null,
      paper: paper
        ? {
            label: paper.label,
            spec: { ...paper.spec, PMAX: Number.isFinite(paper.spec.PMAX) ? paper.spec.PMAX : 'Infinity' },
            metrics: paper.m,
            medianNeighbourRoi: paper.medianNb,
            cross: paper.cross,
          }
        : null,
      shuffle: shuffleRows,
      tolSweep: tolRows.map((r) => ({ tol: r.tol, n: r.champ.n, roi: r.champ.roi })),
    },
    null,
    2,
  ),
);
log(`[rung] done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${RESULTS}`);
