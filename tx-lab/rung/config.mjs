// config.mjs — toàn bộ knob của harness "kèo rung". Không hardcode kết quả ở
// bất kỳ file nào khác: mọi phút / ngưỡng giá / gap đều bắt nguồn từ đây.
const num = (k, d) => (process.env[k] != null ? Number(process.env[k]) : d);
const str = (k, d) => (process.env[k] != null ? String(process.env[k]) : d);

export const config = {
  LEAGUE: num('RUNG_LEAGUE', 1508),
  CROSS_LEAGUES: str('RUNG_CROSS_LEAGUES', '1485,2140')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite),
  SHUFFLES: num('RUNG_SHUFFLES', 200),
  SEED: num('RUNG_SEED', 42),
  MINUTE_TOL: num('RUNG_MINUTE_TOL', 1),
  TOL_SWEEP: [0, 1, 2], // §6.6 độ bền dung sai phút
  MIN_BETS: num('RUNG_MIN_BETS', 40),
  FAMILIES: str('RUNG_FAMILIES', 'A,B,C')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  Z: 1.96,

  // ---- không gian giả thuyết (§2) ----
  PMIN_LIST: [0.55, 0.6, 0.65, 0.7, 0.75, 0.8],
  PMAX_LIST: [0.9, Infinity],
  GAP_LIST: [0.5, 0.75, 'PREFER_05'],
  HALVES: ['H1', 'H2'],

  A_X: rangeInt(25, 32),
  A_Y: rangeInt(30, 42),
  B_X: rangeInt(26, 32),
  B_Y0: rangeInt(30, 40),
  B_D: [2, 4],
  C_K: [8, 10, 12, 15],
  C_Y: rangeInt(30, 42),

  MIN_LEAD: 2, // ràng buộc Y >= X + MIN_LEAD
  MAX_ENTRY_MIN: 42, // H2 đóng kèo cứng sau phút 42 (§1.2)

  // ---- baseline / control (§2.6) ----
  E1: { X: 29, Y: 34, PMIN: 0.7, PMAX: Infinity, GAP: 'PREFER_05' },
  E2_Y: rangeInt(30, 42),
  E3_WINDOW: [30, 42],
  E3_REPS: num('RUNG_E3_REPS', 200),

  // ---- cổng chấp nhận (§7) ----
  GATE_PLATEAU_MIN_POS: 6, // ≥6/8 hàng xóm ROI > 0
  GATE_PLATEAU_MEDIAN_FRAC: 0.5, // median hàng xóm ≥ 0.5 × ô trung tâm
  GATE_BASELINE_MARGIN: 0.05, // 7.7 phải hơn E2 5 điểm ROI
  GATE_SHUFFLE_PCT: 95, // 7.4 phải vượt p95 null
  FRAGILE_TOL_SPREAD: 0.05, // §6.6 lệch >5 điểm ROI ⇒ FRAGILE_TOL
  WEAK_MIN_BETS: 20, // 20 <= n < 40 ⇒ WEAK_SUGGESTION
  CROSS_CANDIDATES: num('RUNG_CROSS_CANDIDATES', 8), // số ô top chạy prior chéo
  MINUTE_MAX: 53, // thang phút ảo lớn nhất quan sát được (§1.1) + biên
};

function rangeInt(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export const gapLabel = (g) => (g === 'PREFER_05' ? 'PREF05' : String(g));
export const pmaxLabel = (p) => (Number.isFinite(p) ? p.toFixed(2) : 'inf');
