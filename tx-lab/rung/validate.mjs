// validate.mjs — §6.1 out-of-sample · §6.2 cao nguyên · §6.4 cổng shuffle ·
// §6.5 prior chéo · §6.8 cần thêm bao nhiêu ngày · §7 bảng 8 cổng.
import { config } from './config.mjs';
import { comboKey } from './families.mjs';
import { empiricalPct } from './grid.mjs';

// Bảng tra tổ hợp -> chỉ số, để dò hàng xóm trong lưới.
export function indexCombos(combos) {
  const m = new Map();
  for (let i = 0; i < combos.length; i++) m.set(comboKey(combos[i]), i);
  return m;
}

function withPmin(s, pmin) {
  return { ...s, PMIN: pmin };
}

// Hàng xóm ±1 phút trong mặt phẳng (X,Y) — họ C dùng (K,Y).
function minuteNeighbours(s) {
  const out = [];
  if (s.family === 'A') {
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue;
        out.push({ ...s, X: s.X + dx, Y: s.Y + dy });
      }
  } else if (s.family === 'B') {
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue;
        out.push({ ...s, X: s.X + dx, Y0: s.Y0 + dy });
      }
  } else {
    const ki = config.C_K.indexOf(s.K);
    for (const dk of [-1, 0, 1])
      for (const dy of [-1, 0, 1]) {
        if (dk === 0 && dy === 0) continue;
        const K = config.C_K[ki + dk];
        out.push(K == null ? null : { ...s, K, Y: s.Y + dy });
      }
  }
  return out;
}

// §6.2 — hàng xóm ngoài dải quét tính là TRƯỢT, không bỏ qua.
export function plateau(combos, metrics, index, i) {
  const s = combos[i];
  const center = metrics[i].roi;
  const rois = [];
  let positive = 0;
  for (const nb of minuteNeighbours(s)) {
    const j = nb ? index.get(comboKey(nb)) : undefined;
    const roi = j == null ? null : metrics[j].roi;
    rois.push(roi);
    if (roi != null && roi > 0) positive++;
  }
  const finite = rois.filter((r) => r != null).sort((a, b) => a - b);
  // ô ngoài lưới coi như ROI = -Infinity khi lấy median (trượt)
  const filled = rois.map((r) => (r == null ? -Infinity : r)).sort((a, b) => a - b);
  const med = filled.length
    ? (filled[Math.floor((filled.length - 1) / 2)] + filled[Math.ceil((filled.length - 1) / 2)]) / 2
    : -Infinity;

  const pi = config.PMIN_LIST.indexOf(s.PMIN);
  const pminNb = [config.PMIN_LIST[pi - 1], config.PMIN_LIST[pi + 1]].map((p) => {
    if (p == null) return null;
    const j = index.get(comboKey(withPmin(s, p)));
    return j == null ? null : metrics[j].roi;
  });

  const c1 = positive >= config.GATE_PLATEAU_MIN_POS;
  const c2 = Number.isFinite(med) && med >= config.GATE_PLATEAU_MEDIAN_FRAC * center;
  const c3 = pminNb.every((r) => r != null && r > 0);
  return {
    pass: c1 && c2 && c3,
    positive,
    medianNb: med,
    center,
    pminNb,
    c1,
    c2,
    c3,
    neighbourRois: finite,
  };
}

// §7.7 — baseline vô điều kiện cùng (Y, GAP, hiệp).
export function e2RoiFor(s, e2Map) {
  const y = s.family === 'B' ? s.Y0 : s.Y;
  const gap = s.GAP === 'PREFER_05' ? 'P' : String(s.GAP);
  const hit = e2Map.get(`${y}|${gap}|${s.half}`);
  return hit ? hit.roi : 0;
}

// §7 — 8 cổng. cross = kết quả prior chéo (null nếu chưa chạy).
export function gates(s, m, plat, nullDist, e2roi, cross) {
  const g1 = m.n >= config.MIN_BETS;
  const g2 = m.roiEarly > 0 && m.roiLate > 0;
  const g3 = plat ? plat.pass : false;
  const p95 = nullDist ? nullDist.p95 : NaN;
  const g4 = Number.isFinite(p95) ? m.roi > p95 : false;
  const g5 = m.evLB > 0;
  const g6 = m.mdd < m.pnl;
  const g7 = m.roi >= e2roi + config.GATE_BASELINE_MARGIN;
  const g8 = cross
    ? cross.some((c) => c.n >= config.MIN_BETS && c.roi > 0)
    : null;
  const arr = [g1, g2, g3, g4, g5, g6, g7, g8];
  return {
    list: arr,
    str: arr.map((x) => (x == null ? '?' : x ? '✓' : '✗')).join(''),
    passed17: arr.slice(0, 7).filter(Boolean).length,
    passedAll: arr.filter((x) => x === true).length,
    all: arr.every((x) => x === true),
    p95,
    e2roi,
  };
}

// §6.8 — cần thêm bao nhiêu lệnh / bao nhiêu ngày để CI 95% hẹp hơn |roi|.
export function daysNeeded(m) {
  if (!m.n || !Number.isFinite(m.roi) || Math.abs(m.roi) < 1e-9 || !Number.isFinite(m.sd)) {
    return { nNeeded: Infinity, daysNeeded: Infinity };
  }
  const nNeeded = Math.ceil(Math.pow((config.Z * m.sd) / Math.abs(m.roi), 2));
  const perDay = m.betsPerDay;
  const d = perDay > 0 ? Math.ceil(Math.max(0, nNeeded - m.n) / perDay) : Infinity;
  return { nNeeded, daysNeeded: d };
}

export function verdictOf(gateInfo, m, fragileTol) {
  if (gateInfo.all && !fragileTol && m.n >= config.MIN_BETS) return 'EDGE_CANDIDATE';
  const g = gateInfo.list;
  const first7 = g.slice(0, 7).every((x) => x === true);
  if (first7 && (g[7] === false || fragileTol)) return 'WEAK_SUGGESTION';
  if (first7 && m.n >= config.WEAK_MIN_BETS && m.n < config.MIN_BETS) return 'WEAK_SUGGESTION';
  return 'INSUFFICIENT_DATA';
}

export { empiricalPct };
