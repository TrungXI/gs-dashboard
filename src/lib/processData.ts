import rawData from '../gs-raw-all.json';
import { apiToRow, sortMatchesDesc } from './matchUtils';
import type { Match } from '../types/match';

const raw = rawData as unknown as Record<string, Record<string, unknown>[]>;

// Collect all match keys (matches20260627, matches20260628, ...)
const matchKeys = Object.keys(raw)
  .filter((k) => k.startsWith('matches'))
  .sort((a, b) => b.localeCompare(a)); // newest date first

export const ALL_MATCHES: Match[] = sortMatchesDesc(
  matchKeys.flatMap((k) => raw[k].map(apiToRow)),
);
