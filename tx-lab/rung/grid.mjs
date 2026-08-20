// grid.mjs — tầng 1 (dựng bet-list) + tầng 2 (chấm) + kiểm định grid-max shuffle.
import { config } from './config.mjs';
import { gradeLeg, pnlOf, resultShares } from './engine.mjs';
import { BetStore, emitCombo } from './families.mjs';
import { MINUTES as M } from './dataset.mjs';
import { evLowerBound, maxDrawdown } from '../metrics.mjs';

// Tầng 1 — mỗi tổ hợp một dải lệnh trong kho phẳng dùng chung.
export function buildGrid(ds, combos) {
  const store = new BetStore();
  const ranges = new Int32Array(combos.length * 2);
  for (let i = 0; i < combos.length; i++) {
    ranges[i * 2] = store.n;
    emitCombo(ds, combos[i], store, null);
    ranges[i * 2 + 1] = store.n;
  }
  return { store, ranges };
}

// Tầng 2 — chấm thật một dải lệnh.
export function scoreRange(ds, store, a, b) {
  const n = b - a;
  const empty = {
    n: 0,
    pnl: 0,
    roi: 0,
    winRate: 0,
    evLB: 0,
    sd: 0,
    mdd: 0,
    betsPerDay: 0,
    roiEarly: 0,
    roiLate: 0,
    nEarly: 0,
    nLate: 0,
  };
  if (n === 0) return empty;

  const bets = new Array(n);
  let pnl = 0;
  let winSum = 0;
  let pushSum = 0;
  let pnlE = 0;
  let nE = 0;
  let pnlL = 0;
  let nL = 0;
  for (let i = a; i < b; i++) {
    const u = ds.units[store.unitIdx[i]];
    const g = gradeLeg('tai', store.line[i], store.over[i], u.finalTotal);
    const sh = resultShares(g.result);
    pnl += g.pnl;
    winSum += sh.win;
    pushSum += sh.push;
    if (u.late) {
      pnlL += g.pnl;
      nL++;
    } else {
      pnlE += g.pnl;
      nE++;
    }
    bets[i - a] = { pnl: g.pnl, recordedAt: u.startAt, matchDate: u.day };
  }
  const mean = pnl / n;
  const { evLB, evSd } = evLowerBound(bets, mean, n, config.Z);
  const wrDen = n - pushSum;
  return {
    n,
    pnl,
    roi: mean,
    winRate: wrDen > 0 ? winSum / wrDen : 0,
    evLB,
    sd: evSd,
    mdd: maxDrawdown(bets),
    betsPerDay: ds.days.length ? n / ds.days.length : 0,
    roiEarly: nE ? pnlE / nE : 0,
    roiLate: nL ? pnlL / nL : 0,
    nEarly: nE,
    nLate: nL,
  };
}

export function scoreAll(ds, store, ranges, count) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = scoreRange(ds, store, ranges[i * 2], ranges[i * 2 + 1]);
  return out;
}

// ---------------------------------------------------------------------------
// §6.4 — grid-max shuffle. Hoán vị remainingGoals GIỮA các unit trong cùng
// (half, day): giữ nguyên hiệu ứng phút và hiệu ứng ngày, chỉ phá liên kết giữa
// điều kiện vào lệnh của một trận và kết cục của CHÍNH trận đó.
export function shuffleNull(ds, store, ranges, combos, metrics, rng, shuffles) {
  const families = [...new Set(combos.map((c) => c.family))];
  const idxByFamily = new Map(families.map((f) => [f, []]));
  for (let i = 0; i < combos.length; i++) {
    if (metrics[i].n >= config.MIN_BETS) idxByFamily.get(combos[i].family).push(i);
  }

  // nhóm donor: (half, day), chỉ lấy unit có kết quả
  const groups = new Map();
  for (const u of ds.units) {
    if (u.finalTotal == null) continue;
    const k = `${u.half}|${u.day}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(u.idx);
  }
  const groupList = [...groups.values()];

  const donorOf = new Int32Array(ds.nUnits);
  for (let i = 0; i < ds.nUnits; i++) donorOf[i] = i;

  const maxByFamily = new Map(families.map((f) => [f, []]));
  const nBets = store.n;
  const pnlBuf = new Float64Array(nBets);

  for (let b = 0; b < shuffles; b++) {
    for (const g of groupList) {
      // Fisher–Yates trên bản sao thứ tự nhóm
      const perm = g.slice();
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        const t = perm[i];
        perm[i] = perm[j];
        perm[j] = t;
      }
      for (let i = 0; i < g.length; i++) donorOf[g[i]] = perm[i];
    }
    for (let i = 0; i < nBets; i++) {
      const donor = donorOf[store.unitIdx[i]];
      const finalStar = store.totalAtEntry[i] + ds.remaining[donor * M + store.entryMinute[i]];
      pnlBuf[i] = pnlOf(store.line[i], store.over[i], finalStar);
    }
    for (const f of families) {
      let best = -Infinity;
      for (const ci of idxByFamily.get(f)) {
        const a0 = ranges[ci * 2];
        const b0 = ranges[ci * 2 + 1];
        let s = 0;
        for (let i = a0; i < b0; i++) s += pnlBuf[i];
        const roi = s / (b0 - a0);
        if (roi > best) best = roi;
      }
      if (Number.isFinite(best)) maxByFamily.get(f).push(best);
    }
  }

  const out = new Map();
  for (const f of families) {
    const arr = maxByFamily.get(f).sort((x, y) => x - y);
    out.set(f, {
      n: arr.length,
      eligible: idxByFamily.get(f).length,
      p50: pct(arr, 50),
      p90: pct(arr, 90),
      p95: pct(arr, 95),
      p99: pct(arr, 99),
      samples: arr,
    });
  }
  return out;
}

export function pct(sortedArr, p) {
  if (!sortedArr.length) return NaN;
  const i = Math.min(sortedArr.length - 1, Math.max(0, Math.ceil((p / 100) * sortedArr.length) - 1));
  return sortedArr[i];
}

// phân vị thực nghiệm của một giá trị quan sát trong phân bố null
export function empiricalPct(sortedArr, v) {
  if (!sortedArr.length) return NaN;
  let below = 0;
  for (const x of sortedArr) if (x < v) below++;
  return (100 * below) / sortedArr.length;
}
