export interface VoltaMatch {
  matchId: number;
  date: string;    // DD/MM/YYYY
  time: string;    // HH:mm (VN time)
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: string;
  homeLogo: string;
  awayLogo: string;
}
