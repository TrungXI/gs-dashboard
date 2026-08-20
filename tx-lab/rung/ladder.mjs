// ladder.mjs — đọc thang line từ raw jsonb (§3.6, §3.7).
// Cột phẳng chỉ giữ nấc 0; gap 0.75 CHỈ tồn tại trong raw->'ouLines'[1] /
// raw->'ouH1Lines'[1]. Dùng cột là mất hẳn một nửa không gian giả thuyết.

// half: 'H1' | 'H2'. Trả mảng { line, over, under, suspended } đã lọc nấc treo.
export function ladderOf(tick, half) {
  const arr = half === 'H1' ? tick.ou_h1_raw : tick.ou_ft_raw;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((l) => ({
      line: Number(l.line),
      over: Number(l.over),
      under: Number(l.under),
      suspended: l.suspended === true,
    }))
    .filter((l) => Number.isFinite(l.line) && Number.isFinite(l.over) && !l.suspended);
}

// Chọn nấc theo gap. gapMode: 0.5 | 0.75 | 'PREFER_05'
export function pickRung(ladder, currentTotal, gapMode) {
  const want = (g) => ladder.find((l) => Math.abs(l.line - (currentTotal + g)) < 1e-9);
  if (gapMode === 'PREFER_05') return want(0.5) ?? want(0.75) ?? null;
  return want(gapMode) ?? null;
}

// Malay -> "điểm nghiêng Xỉu", đơn điệu tăng, trùng chính giá khi 0 <= m <= 1.
// Giá âm (kèo Xỉu được ưa MẠNH) map lên (1,2] thay vì bị loại nhầm bởi so sánh thô.
export function xiuScore(malay) {
  if (malay === null || !Number.isFinite(malay)) return null;
  return malay >= 0 ? malay : 2 - Math.abs(malay);
}

// Giá gate = giá Xỉu của NẤC 0 (line chính nhà cái ghim) — chính là cột
// ft_xiu / h1_xiu (§1.3 đã verify cột ≡ raw[0]). Không lọc suspended ở đây:
// gate mở kèo được xét riêng ở tickOpen().
export function gateUnder(tick, half) {
  const arr = half === 'H1' ? tick.ou_h1_raw : tick.ou_ft_raw;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = Number(arr[0].under);
  return Number.isFinite(v) ? v : null;
}

// Bản gate NGUYÊN VĂN của V.Bot 14 (`hasUnderOK`): quét TOÀN BỘ mảng, so THÔ
// `under >= UNDER_MIN`, không chuẩn hoá giá âm. Chỉ dùng cho biến thể E1b để
// đo chênh lệch giữa quy ước của SPEC (§3.6) và bot thật.
export function hasUnderOK(tick, half, underMin) {
  const arr = half === 'H1' ? tick.ou_h1_raw : tick.ou_ft_raw;
  if (!Array.isArray(arr)) return false;
  for (const o of arr) {
    const under = o.under != null && o.under !== '' ? Number(o.under) : NaN;
    if (Number.isFinite(under) && under >= underMin) return true;
  }
  return false;
}

export function tickOpen(tick, half) {
  const halfSusp = half === 'H1' ? tick.h1_susp : tick.ft_susp;
  return (
    tick.betting_open === true &&
    (tick.match_suspended ?? false) === false &&
    (halfSusp ?? false) === false
  );
}
