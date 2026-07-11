export interface Match {
  date: string; // "11/07/2026"
  time: string; // "11/07/2026 10:35 AM"
  matchType: '20p' | '16p';
  league: string;
  homeTeam: string;
  awayTeam: string;
  h1Home: string;
  h1Away: string;
  ttHome: string;
  ttAway: string;
}
