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
}
