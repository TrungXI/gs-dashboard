// families.mjs — sinh lệnh cho họ A / B / C và họ E (baseline).
// Tầng 1 của kiến trúc 2 tầng (§5.3): mỗi tổ hợp -> một dải lệnh trong một kho
// phẳng dùng chung. Tầng 2 (chấm / shuffle) chỉ đọc kho này, không dựng lại lưới.
import { config } from './config.mjs';
import { MINUTES as M } from './dataset.mjs';

export class BetStore {
  constructor(cap = 1 << 20) {
    this.n = 0;
    this.cap = cap;
    this.unitIdx = new Int32Array(cap);
    this.entryMinute = new Int16Array(cap);
    this.line = new Float64Array(cap);
    this.over = new Float64Array(cap);
    this.totalAtEntry = new Int16Array(cap);
  }

  grow() {
    const cap = this.cap * 2;
    for (const k of ['unitIdx', 'entryMinute', 'line', 'over', 'totalAtEntry']) {
      const next = new this[k].constructor(cap);
      next.set(this[k]);
      this[k] = next;
    }
    this.cap = cap;
  }

  push(unitIdx, entryMinute, line, over, totalAtEntry) {
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.unitIdx[i] = unitIdx;
    this.entryMinute[i] = entryMinute;
    this.line[i] = line;
    this.over[i] = over;
    this.totalAtEntry[i] = totalAtEntry;
  }
}

export function newFunnel() {
  return {
    units: 0,
    no_tick_flag: 0,
    flag_locked: 0,
    price_gate: 0,
    no_tick_entry: 0,
    cancelled_goal: 0,
    entry_locked: 0,
    no_rung: 0,
    no_result: 0,
    bets: 0,
  };
}

function rungAt(u, m, gapMode) {
  if (gapMode === 0.5) return Number.isNaN(u.l05[m]) ? null : [u.l05[m], u.o05[m]];
  if (gapMode === 0.75) return Number.isNaN(u.l075[m]) ? null : [u.l075[m], u.o075[m]];
  if (!Number.isNaN(u.l05[m])) return [u.l05[m], u.o05[m]];
  if (!Number.isNaN(u.l075[m])) return [u.l075[m], u.o075[m]];
  return null;
}

// gateMode 'SPEC' = xiuScore của nấc 0 (§3.6). 'BOT' = hasUnderOK nguyên văn
// V.Bot 14 (quét cả mảng, so thô, không chuẩn hoá giá âm) — chỉ dùng cho E1b.
function gateOk(u, m, s) {
  if (s.gateMode === 'BOT') {
    const mx = u.maxUnderRaw[m];
    return Number.isFinite(mx) && mx >= s.PMIN;
  }
  const g = u.gate[m];
  return Number.isFinite(g) && g >= s.PMIN && g <= s.PMAX;
}

// ---------------------------------------------------------------------------
// Sinh lệnh cho MỘT tổ hợp. Trả về số lệnh đã thêm vào store.
export function emitCombo(ds, s, store, funnel) {
  const start = store.n;
  for (const u of ds.units) {
    if (u.half !== s.half) continue;
    if (funnel) funnel.units++;
    if (s.family === 'A') emitA(u, s, store, funnel);
    else if (s.family === 'B') emitB(u, s, store, funnel);
    else if (s.family === 'C') emitC(u, s, store, funnel);
    else if (s.family === 'E2') emitE2(u, s, store, funnel);
  }
  return store.n - start;
}

function emitA(u, s, store, f) {
  const a = u.srcMinute[s.X];
  if (a < 0) return f && f.no_tick_flag++;
  if (!u.open[s.X]) return f && f.flag_locked++;
  if (!gateOk(u, s.X, s)) return f && f.price_gate++;
  const b = u.srcMinute[s.Y];
  if (b < 0) return f && f.no_tick_entry++;
  if (b <= a) return f && f.no_tick_entry++;
  if (!u.flat[a * M + b]) return f && f.cancelled_goal++;
  if (!u.open[s.Y]) return f && f.entry_locked++;
  const r = rungAt(u, s.Y, s.GAP);
  if (!r) return f && f.no_rung++;
  if (u.finalTotal == null) return f && f.no_result++;
  store.push(u.idx, b, r[0], r[1], u.totAt[s.Y]);
  if (f) f.bets++;
}

function emitB(u, s, store, f) {
  const a = u.srcMinute[s.X];
  if (a < 0) return f && f.no_tick_flag++;
  if (!u.open[s.X]) return f && f.flag_locked++;
  if (!gateOk(u, s.X, s)) return f && f.price_gate++;
  let sawTick = false;
  let lastB = -1;
  for (let m = s.Y0; m <= s.Y0 + s.D; m++) {
    const b = u.srcMinute[m];
    if (b < 0 || b <= a || b === lastB) continue;
    lastB = b;
    sawTick = true;
    if (!u.flat[a * M + b]) return f && f.cancelled_goal++; // có bàn -> huỷ hẳn
    if (!u.open[m]) continue;
    const r = rungAt(u, m, s.GAP);
    if (!r) continue;
    if (u.finalTotal == null) return f && f.no_result++;
    store.push(u.idx, b, r[0], r[1], u.totAt[m]);
    if (f) f.bets++;
    return;
  }
  if (f) sawTick ? f.entry_locked++ : f.no_tick_entry++;
}

function emitC(u, s, store, f) {
  const b = u.srcMinute[s.Y];
  if (b < 0) return f && f.no_tick_entry++;
  if (!u.open[s.Y]) return f && f.entry_locked++;
  if (!gateOk(u, s.Y, s)) return f && f.price_gate++;
  const a = Math.max(0, b - s.K);
  if (!u.flat[a * M + b]) return f && f.cancelled_goal++;
  const r = rungAt(u, s.Y, s.GAP);
  if (!r) return f && f.no_rung++;
  if (u.finalTotal == null) return f && f.no_result++;
  store.push(u.idx, b, r[0], r[1], u.totAt[s.Y]);
  if (f) f.bets++;
}

function emitE2(u, s, store, f) {
  const b = u.srcMinute[s.Y];
  if (b < 0) return f && f.no_tick_entry++;
  if (!u.open[s.Y]) return f && f.entry_locked++;
  const r = rungAt(u, s.Y, s.GAP);
  if (!r) return f && f.no_rung++;
  if (u.finalTotal == null) return f && f.no_result++;
  store.push(u.idx, b, r[0], r[1], u.totAt[s.Y]);
  if (f) f.bets++;
}

// E3 — chọn ngẫu nhiên 1 tick mở trong cửa sổ, gap PREFER_05. Seed cố định.
export function emitE3(ds, half, rng, store) {
  const [lo, hi] = config.E3_WINDOW;
  const start = store.n;
  for (const u of ds.units) {
    if (u.half !== half) continue;
    if (u.finalTotal == null) continue;
    const cands = [];
    let lastB = -1;
    for (let m = lo; m <= hi; m++) {
      const b = u.srcMinute[m];
      if (b < 0 || b === lastB) continue;
      lastB = b;
      if (!u.open[m]) continue;
      const r = rungAt(u, m, 'PREFER_05');
      if (!r) continue;
      cands.push([b, r[0], r[1], u.totAt[m]]);
    }
    if (!cands.length) continue;
    const pick = cands[Math.floor(rng.next() * cands.length)];
    store.push(u.idx, pick[0], pick[1], pick[2], pick[3]);
  }
  return store.n - start;
}

// ---------------------------------------------------------------------------
// Liệt kê không gian giả thuyết. Số tổ hợp được ĐẾM tại runtime, không hardcode.
export function enumerateCombos(families = config.FAMILIES) {
  const out = [];
  const knobs = [];
  for (const PMIN of config.PMIN_LIST)
    for (const PMAX of config.PMAX_LIST)
      for (const GAP of config.GAP_LIST) knobs.push({ PMIN, PMAX, GAP });

  for (const half of config.HALVES) {
    if (families.includes('A')) {
      for (const X of config.A_X)
        for (const Y of config.A_Y) {
          if (Y < X + config.MIN_LEAD) continue;
          for (const k of knobs) out.push({ family: 'A', X, Y, half, gateMode: 'SPEC', ...k });
        }
    }
    if (families.includes('B')) {
      for (const X of config.B_X)
        for (const Y0 of config.B_Y0)
          for (const D of config.B_D) {
            if (Y0 < X + config.MIN_LEAD) continue;
            if (Y0 + D > config.MAX_ENTRY_MIN) continue;
            for (const k of knobs)
              out.push({ family: 'B', X, Y0, D, half, gateMode: 'SPEC', ...k });
          }
    }
    if (families.includes('C')) {
      for (const K of config.C_K)
        for (const Y of config.C_Y)
          for (const k of knobs) out.push({ family: 'C', K, Y, half, gateMode: 'SPEC', ...k });
    }
  }
  return out;
}

export function comboKey(s) {
  const gap = s.GAP === 'PREFER_05' ? 'P' : String(s.GAP);
  const pmax = Number.isFinite(s.PMAX) ? s.PMAX.toFixed(2) : 'inf';
  if (s.family === 'A') return `A|${s.X}|${s.Y}|${s.PMIN}|${pmax}|${gap}|${s.half}`;
  if (s.family === 'B') return `B|${s.X}|${s.Y0}|${s.D}|${s.PMIN}|${pmax}|${gap}|${s.half}`;
  return `C|${s.K}|${s.Y}|${s.PMIN}|${pmax}|${gap}|${s.half}`;
}

export function comboLabel(s) {
  const gap = s.GAP === 'PREFER_05' ? 'PREF05' : String(s.GAP);
  const pmax = Number.isFinite(s.PMAX) ? s.PMAX.toFixed(2) : 'inf';
  if (s.family === 'A') return `A X=${s.X} Y=${s.Y} p=[${s.PMIN},${pmax}] gap=${gap} ${s.half}`;
  if (s.family === 'B')
    return `B X=${s.X} Y0=${s.Y0} D=${s.D} p=[${s.PMIN},${pmax}] gap=${gap} ${s.half}`;
  return `C K=${s.K} Y=${s.Y} p=[${s.PMIN},${pmax}] gap=${gap} ${s.half}`;
}
