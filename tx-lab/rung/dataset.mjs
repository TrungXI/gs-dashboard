// dataset.mjs — ticks -> units (event × half) + toàn bộ bảng tra theo phút.
//
// Một `unit` = một cặp (event_id, half). Mọi thứ mà vòng quét lưới cần đọc ở
// phút m đều được tính SẴN một lần ở đây, vì lưới sẽ đọc lại chúng ~19k lần.
import { config } from './config.mjs';
import { ladderOf, pickRung, xiuScore, gateUnder, tickOpen } from './ladder.mjs';

const M = config.MINUTE_MAX; // số ô của thang phút ảo (0..M-1)

const dayVN = (d) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

// ---------------------------------------------------------------------------
export function buildDataset({ ticks, history, inventory, ladderAssert }, tol) {
  const hist = new Map();
  for (const r of history) {
    const h1 = num(r.h1_home) + num(r.h1_away);
    const ft = num(r.tt_home) + num(r.tt_away);
    hist.set(String(r.event_id), {
      h1: r.h1_home == null || r.h1_away == null ? null : h1,
      ft: r.tt_home == null || r.tt_away == null ? null : ft,
    });
  }

  // group ticks by event, then by half (period 2 = H1, period 8 = H2)
  const byEvent = new Map();
  for (const t of ticks) {
    const id = String(t.event_id);
    let e = byEvent.get(id);
    if (!e) byEvent.set(id, (e = { H1: [], H2: [] }));
    const half = t.period === 2 ? 'H1' : 'H2';
    e[half].push(t);
  }

  const units = [];
  let noResult = 0;
  let joined = 0;
  for (const [eventId, halves] of byEvent) {
    const h = hist.get(eventId);
    if (h) joined++;
    for (const half of config.HALVES) {
      const rows = halves[half];
      if (!rows.length) continue;
      const finalTotal = h ? (half === 'H1' ? h.h1 : h.ft) : null;
      if (finalTotal == null) noResult++;
      units.push(makeUnit(eventId, half, rows, finalTotal, tol));
    }
  }

  units.sort((a, b) => a.startAt - b.startAt || (a.eventId < b.eventId ? -1 : 1));
  units.forEach((u, i) => {
    u.idx = i;
  });

  const days = [...new Set(units.map((u) => u.day))].sort();
  const sortedStarts = units.map((u) => u.startAt.getTime()).sort((a, b) => a - b);
  const medianStartAt = sortedStarts.length
    ? sortedStarts[Math.floor(sortedStarts.length / 2)]
    : 0;
  for (const u of units) u.late = u.startAt.getTime() >= medianStartAt;

  const finalTotals = new Float64Array(units.length);
  const hasResult = new Uint8Array(units.length);
  const remaining = new Int16Array(units.length * M);
  for (const u of units) {
    finalTotals[u.idx] = u.finalTotal ?? 0;
    hasResult[u.idx] = u.finalTotal == null ? 0 : 1;
    remaining.set(u.remaining, u.idx * M);
  }

  return {
    units,
    nUnits: units.length,
    gapHist: gapHistogram(ticks),
    days,
    medianStartAt,
    finalTotals,
    hasResult,
    remaining,
    tol,
    inventory,
    ladderAssert,
    joinCoverage: { events: byEvent.size, joined, noResultUnits: noResult },
    matchType: ticks.length ? ticks[0].match_type : 'n/a',
    firstTick: ticks.length ? new Date(ticks[0].recorded_at) : null,
    lastTick: ticks.length
      ? new Date(Math.max(...ticks.map((t) => new Date(t.recorded_at).getTime())))
      : null,
  };
}

// ---------------------------------------------------------------------------
function makeUnit(eventId, half, rows, finalTotal, tol) {
  const startAt = new Date(rows[0].recorded_at);

  // --- tổng bàn theo phút (forward-fill, dùng TOÀN BỘ tick, không giới hạn TOL)
  const totalAtMinute = new Int16Array(M);
  const perMinLast = new Int32Array(M).fill(-1); // index tick cuối của mỗi phút
  const perMinMin = new Int16Array(M).fill(32000);
  const perMinMax = new Int16Array(M).fill(-1);
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i];
    const m = t.minute;
    if (!Number.isFinite(m) || m < 0 || m >= M) continue;
    const tot = num(t.score_home) + num(t.score_away);
    perMinLast[m] = i;
    if (tot < perMinMin[m]) perMinMin[m] = tot;
    if (tot > perMinMax[m]) perMinMax[m] = tot;
  }
  let firstTot = null;
  for (let m = 0; m < M; m++) {
    if (perMinLast[m] >= 0) {
      firstTot = num(rows[perMinLast[m]].score_home) + num(rows[perMinLast[m]].score_away);
      break;
    }
  }
  let cur = firstTot ?? 0;
  for (let m = 0; m < M; m++) {
    if (perMinLast[m] >= 0) {
      cur = num(rows[perMinLast[m]].score_home) + num(rows[perMinLast[m]].score_away);
    }
    totalAtMinute[m] = cur;
  }

  // --- remainingGoals (trụ cột của kiểm định shuffle §6.4)
  const remaining = new Int16Array(M);
  if (finalTotal != null) {
    for (let m = 0; m < M; m++) remaining[m] = finalTotal - totalAtMinute[m];
  }

  // --- tickAt(m) với dung sai TOL: tick CUỐI có minute ∈ [m − TOL, m]
  const srcMinute = new Int16Array(M).fill(-1);
  for (let m = 0; m < M; m++) {
    for (let k = m; k >= Math.max(0, m - tol); k--) {
      if (perMinLast[k] >= 0) {
        srcMinute[m] = k;
        break;
      }
    }
  }

  // --- bảng tra theo phút, dẫn xuất từ tick đã chọn
  const open = new Uint8Array(M);
  const gate = new Float64Array(M).fill(NaN);
  const maxUnderRaw = new Float64Array(M).fill(NaN);
  const totAt = new Int16Array(M).fill(-1);
  const l05 = new Float64Array(M).fill(NaN);
  const o05 = new Float64Array(M).fill(NaN);
  const l075 = new Float64Array(M).fill(NaN);
  const o075 = new Float64Array(M).fill(NaN);
  for (let m = 0; m < M; m++) {
    const sm = srcMinute[m];
    if (sm < 0) continue;
    const t = rows[perMinLast[sm]];
    open[m] = tickOpen(t, half) ? 1 : 0;
    const g = xiuScore(gateUnder(t, half));
    if (g != null) gate[m] = g;
    const arr = half === 'H1' ? t.ou_h1_raw : t.ou_ft_raw;
    if (Array.isArray(arr)) {
      let mx = NaN;
      for (const o of arr) {
        const u = o.under != null && o.under !== '' ? Number(o.under) : NaN;
        if (Number.isFinite(u) && (Number.isNaN(mx) || u > mx)) mx = u;
      }
      maxUnderRaw[m] = mx;
    }
    const S = num(t.score_home) + num(t.score_away);
    totAt[m] = S;
    const ladder = ladderOf(t, half);
    const r05 = pickRung(ladder, S, 0.5);
    const r075 = pickRung(ladder, S, 0.75);
    if (r05) {
      l05[m] = r05.line;
      o05[m] = r05.over;
    }
    if (r075) {
      l075[m] = r075.line;
      o075[m] = r075.over;
    }
  }

  // --- flat[a][b] = "mọi tick có minute ∈ (a,b] đều giữ nguyên tỉ số tại phút a"
  const flat = new Uint8Array(M * M);
  for (let a = 0; a < M; a++) {
    const base = totalAtMinute[a];
    let ok = 1;
    for (let b = a + 1; b < M; b++) {
      if (perMinLast[b] >= 0 && (perMinMin[b] !== base || perMinMax[b] !== base)) ok = 0;
      flat[a * M + b] = ok;
    }
  }

  return {
    eventId,
    half,
    idx: -1,
    day: dayVN(startAt),
    startAt,
    late: false,
    finalTotal,
    nTicks: rows.length,
    totalAtMinute,
    remaining,
    srcMinute,
    open,
    gate,
    maxUnderRaw,
    totAt,
    l05,
    o05,
    l075,
    o075,
    flat,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Phân bố gap khả dụng trên ladder `raw` (T2b) — trả lời trực tiếp câu hỏi
// "gap 1.0 có tồn tại trên giải này không". Đọc thẳng raw, không qua unit,
// vì unit chỉ giữ hai nấc 0.5 / 0.75 mà lưới thực sự đánh.
function gapHistogram(ticks, lo = 25, hi = 43, entryLo = 30, entryHi = 42) {
  const out = { H1: new Map(), H2: new Map(), units: new Map() };
  for (const t of ticks) {
    const m = t.minute;
    if (!Number.isFinite(m) || m < lo || m > hi) continue;
    if (t.betting_open !== true || (t.match_suspended ?? false) === true) continue;
    const half = t.period === 2 ? 'H1' : 'H2';
    if ((half === 'H1' ? t.h1_susp : t.ft_susp) === true) continue;
    const arr = half === 'H1' ? t.ou_h1_raw : t.ou_ft_raw;
    if (!Array.isArray(arr)) continue;
    const S = num(t.score_home) + num(t.score_away);
    for (const l of arr) {
      if (l.suspended === true) continue;
      const line = Number(l.line);
      if (!Number.isFinite(line)) continue;
      const gap = Math.round((line - S) * 100) / 100;
      out[half].set(gap, (out[half].get(gap) ?? 0) + 1);
      // trần n của một gap = số unit có ÍT NHẤT một tick mở chào gap đó trong
      // cửa sổ vào lệnh. Đây là con số quyết định gap nào đáng đưa vào grid.
      if (m >= entryLo && m <= entryHi) {
        if (!out.units.has(gap)) out.units.set(gap, new Set());
        out.units.get(gap).add(`${t.event_id}|${half}`);
      }
    }
  }
  return out;
}

export const MINUTES = M;
