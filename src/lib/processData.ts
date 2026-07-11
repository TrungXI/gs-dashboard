import rawData from '../gs-raw-all.json';
import { apiToRow } from './matchUtils';
import type { Match } from '../types/match';

// Cached — only processed once at build/startup
const raw = rawData as unknown as Record<string, Record<string, unknown>[]>;
export const ALL_MATCHES: Match[] = [
  ...raw.matches11.map(apiToRow),
  ...raw.matches10.map(apiToRow),
  ...raw.matches09.map(apiToRow),
  ...raw.matches08.map(apiToRow),
  ...raw.matches07.map(apiToRow),
  ...raw.matches06.map(apiToRow),
  ...raw.matches05.map(apiToRow),
];
