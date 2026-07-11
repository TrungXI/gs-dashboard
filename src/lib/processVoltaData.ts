import type { VoltaMatch } from '../types/voltaMatch';
import rawData from '../volta-raw.json';

function toVnTime(iso: string): { date: string; time: string } {
  const dt = new Date(iso);
  const vn = new Date(dt.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()}`,
    time: `${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`,
  };
}

export function apiToVoltaRow(m: Record<string, unknown>): VoltaMatch {
  const { date, time } = toVnTime(m['0'] as string);
  const rStr = (m['13'] as Record<string, string> | undefined)?.r ?? '';
  const scoreMatch = rStr.match(/_{(\d+),(\d+)}_/);
  return {
    matchId: m['10'] as number,
    date,
    time,
    homeTeam: m['2'] as string,
    awayTeam: m['3'] as string,
    homeScore: scoreMatch ? parseInt(scoreMatch[1]) : 0,
    awayScore: scoreMatch ? parseInt(scoreMatch[2]) : 0,
    winner: m['11'] as string,
    homeLogo: (m['14'] as string) || '',
    awayLogo: (m['15'] as string) || '',
  };
}

const raw = rawData as { total: number; items: Record<string, unknown>[] };

export const ALL_VOLTA_MATCHES: VoltaMatch[] = raw.items.map(apiToVoltaRow);
