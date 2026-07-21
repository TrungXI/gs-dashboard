// Màu tên đội theo mức chênh lệch thắng H2H của 1 hiệp — tái dùng cùng ngưỡng
// với panel "⚽ Ghi bàn tiếp" (PredictCard trong LiveAnalysisDrawer): |A% − B%| ≤ 8
// coi là "cân bằng"; lệch hơn 8 điểm % là "mạnh/yếu phân biệt".

export interface HalfSplit {
  aWinPct: number;
  drawPct: number;
  bWinPct: number;
}

export const STRENGTH_STRONG = '#4ade80'; // đội mạnh (thắng H2H áp đảo)
export const STRENGTH_WEAK = '#f87171'; // đội yếu

export interface TeamNameColors {
  /** Màu override cho tên đội nhà/khách; null khi cân bằng (giữ màu mặc định). */
  home: string | null;
  away: string | null;
  balanced: boolean;
}

/**
 * Từ split H2H của hiệp hiện tại, quyết định cân bằng hay mạnh/yếu phân biệt.
 * Cân bằng (|A% − B%| ≤ 8) → trả null cho cả hai (caller giữ màu mặc định).
 * Lệch → đội thắng nhiều hơn = STRONG (xanh), đội còn lại = WEAK (đỏ).
 */
export function teamNameColors(s: HalfSplit | null | undefined): TeamNameColors {
  if (!s) return { home: null, away: null, balanced: true };
  const diff = s.aWinPct - s.bWinPct;
  if (Math.abs(diff) <= 8) return { home: null, away: null, balanced: true };
  const homeLeads = diff > 0;
  return {
    home: homeLeads ? STRENGTH_STRONG : STRENGTH_WEAK,
    away: homeLeads ? STRENGTH_WEAK : STRENGTH_STRONG,
    balanced: false,
  };
}

export interface StrengthPct {
  homePct: number; // % ưu thế đội nhà (A% + Hoà%/2)
  awayPct: number; // % ưu thế đội khách (B% + Hoà%/2), homePct + awayPct = 100
  homeLeads: boolean;
  isBalanced: boolean; // |homePct − awayPct| ≤ 8
}

/**
 * Quy split H2H của 1 hiệp thành % ưu thế: hoà chia đôi cho 2 đội.
 * Cùng ngưỡng ±8 với teamNameColors → nhãn/thanh & màu tên đội luôn đồng bộ.
 */
export function h2hStrength(s: HalfSplit | null | undefined): StrengthPct | null {
  if (!s) return null;
  const homePct = Math.round(s.aWinPct + s.drawPct / 2);
  const awayPct = 100 - homePct;
  return {
    homePct,
    awayPct,
    homeLeads: homePct > awayPct,
    isBalanced: Math.abs(homePct - awayPct) <= 8,
  };
}
