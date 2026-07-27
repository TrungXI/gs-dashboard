// strategies/index.mjs — registry of all strategy families.
// Each family exports { id, defaults, paramSpec, fn }. The GA reads FAMILIES for
// its genome pool (selected by config.GEN_FAMILY_SET), and FAMILY_BY_ID for
// lookup / nested-meta resolution across BOTH sets.
import { config } from '../config.mjs';

// -- legacy in-play set (F1–F12) ---------------------------------------------
import { lineDrift } from './lineDrift.mjs';
import { poissonRemaining } from './poissonRemaining.mjs';
import { impliedVsBaserate } from './impliedVsBaserate.mjs';
import { shockReaction } from './shockReaction.mjs';
import { baserateReversion } from './baserateReversion.mjs';
import { earlyGoalTempo } from './earlyGoalTempo.mjs';
import { h2hLateGoal } from './h2hLateGoal.mjs';
import { oddsOscillation } from './oddsOscillation.mjs';
import { neededGoalsPressure } from './neededGoalsPressure.mjs';
import { metaConsensus } from './metaConsensus.mjs';
import { randomExplorer } from './randomExplorer.mjs';
import { lineValueBand } from './lineValueBand.mjs';

// -- generation-G open-only set (G1–G8) --------------------------------------
import { h1ContinuationOU } from './G1_h1ContinuationOU.mjs';
import { h1TempoStats } from './G2_h1TempoStats.mjs';
import { kickoffH2LineValue } from './G3_kickoffH2LineValue.mjs';
import { preMatchValue } from './G4_preMatchValue.mjs';
import { scorelessOrBlowout } from './G5_scorelessOrBlowout.mjs';
import { leagueOpenPrior } from './G6_leagueOpenPrior.mjs';
import { openGoalValue } from './G7_openGoalValue.mjs';
import { metaOpenConsensus } from './G8_metaOpenConsensus.mjs';

// F1..F12 (metaConsensus/F10 depends on F1–F9 + F12; randomExplorer = baseline).
export const F_FAMILIES = [
  lineDrift,
  poissonRemaining,
  impliedVsBaserate,
  shockReaction,
  baserateReversion,
  earlyGoalTempo,
  h2hLateGoal,
  oddsOscillation,
  neededGoalsPressure,
  metaConsensus,
  randomExplorer, // noise baseline (shared)
  lineValueBand,
];

// G1..G8 open-only + the SAME randomExplorer noise baseline (mandatory in pool).
export const G_FAMILIES = [
  h1ContinuationOU, // G1
  h1TempoStats, // G2
  kickoffH2LineValue, // G3
  preMatchValue, // G4
  scorelessOrBlowout, // G5
  leagueOpenPrior, // G6
  openGoalValue, // G7
  metaOpenConsensus, // G8 (depends on G1–G7)
  randomExplorer, // noise baseline
];

// Every family from both sets, for FAMILY_BY_ID (nested metas resolve across sets).
const ALL_FAMILIES = [
  ...F_FAMILIES.filter((f) => f.id !== 'randomExplorer'),
  ...G_FAMILIES, // includes the single shared randomExplorer
];

export const FAMILY_BY_ID = Object.fromEntries(
  ALL_FAMILIES.map((f) => [f.id, f]),
);

// The GA genome pool, selected by config.GEN_FAMILY_SET ('G' default | 'F' | 'ALL').
function selectPool(set) {
  if (set === 'F') return F_FAMILIES;
  if (set === 'ALL') return ALL_FAMILIES;
  return G_FAMILIES; // 'G' default
}

export const FAMILIES = selectPool(config.GEN_FAMILY_SET);
