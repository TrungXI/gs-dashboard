export interface Match {
  date: string; // "11/07/2026"
  time: string; // "11/07/2026 10:35 AM"
  // `20p_intl` stays separate from Asian 20p in history/UI analytics.
  matchType: '20p' | '20p_intl' | '16p';
  league: string;
  homeTeam: string;
  awayTeam: string;
  h1Home: string;
  h1Away: string;
  ttHome: string;
  ttAway: string;
  // ── Chấp mở kèo (opening handicap) ──────────────────────────────────────
  // Chấp phút ~1 của trận, market chính (hcLines[0]). Nguồn chính là
  // match_odds_log (snapshot first_seen, period 2); fallback gs_16p_ticks
  // (tick sớm nhất) khi odds_log không có. `null` khi cả hai nguồn đều thiếu.
  hcOpenLine?: number | null; // độ chấp tuyệt đối (0, 0.25, 0.5…)
  hcOpenFav?: 'home' | 'away' | null; // bên chấp (đội trên)
  hcOpenSource?: 'odds' | '16p' | null; // nguồn dữ liệu đã dùng
}
