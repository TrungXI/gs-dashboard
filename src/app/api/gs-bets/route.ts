import { NextRequest } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool — only created when DB URL is set
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// ── Row shapes ────────────────────────────────────────────────────────────────

export interface GsBetPick {
  event_id: number;
  home_team: string | null;
  away_team: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  ht_score: string | null;
  ft_score: string | null;
  side_pick: string | null;
  ou_pick: string | null;
  side_hit: boolean | null;
  ou_hit: boolean | null;
  confidence: string | null;
  verdict: string | null;
  review_note: string | null;
  settled_at: string | null;
  hc_line: string | null;
  hc_home_gives: boolean | null;
  hc_home_odds: string | null;
  hc_away_odds: string | null;
  ou_line: string | null;
  ou_over_odds: string | null;
  ou_under_odds: string | null;
}

export interface GsBetStats {
  event_id: number;
  home_team: string | null;
  away_team: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  league_variant: string | null;
  ht_score: string | null;
  home_xg: string | null; away_xg: string | null;
  home_shots: number | null; away_shots: number | null;
  home_sot: number | null; away_sot: number | null;
  home_shot_acc: string | null; away_shot_acc: string | null;
  home_poss: string | null; away_poss: string | null;
  home_passes: number | null; away_passes: number | null;
  home_pass_acc: string | null; away_pass_acc: string | null;
  home_corners: number | null; away_corners: number | null;
  home_tackles: number | null; away_tackles: number | null;
  home_tackles_won: number | null; away_tackles_won: number | null;
  home_interceptions: number | null; away_interceptions: number | null;
  home_fouls: number | null; away_fouls: number | null;
  home_offsides: number | null; away_offsides: number | null;
  home_free_kicks: number | null; away_free_kicks: number | null;
  home_penalties: number | null; away_penalties: number | null;
  home_yellow: number | null; away_yellow: number | null;
  home_red: number | null; away_red: number | null;
  home_saves: number | null; away_saves: number | null;
  home_dribble_acc: number | null; away_dribble_acc: number | null;
  stats_partial: boolean | null;
  notes: string | null;
  captured_at: string | null;
}

export interface GsBetsResponse {
  ok: boolean;
  error?: string;
  pick?: GsBetPick | null;
  stats?: GsBetStats | null;
}

export async function GET(req: NextRequest) {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' } satisfies GsBetsResponse);

  const eventId = Number(req.nextUrl.searchParams.get('eventId'));
  if (!eventId) return Response.json({ ok: false, error: 'missing eventId' } satisfies GsBetsResponse);

  try {
    const [pickRes, statsRes] = await Promise.all([
      pool.query<GsBetPick>(
        `SELECT event_id, home_team, away_team, home_team_id, away_team_id,
                ht_score, ft_score, side_pick, ou_pick, side_hit, ou_hit,
                confidence, verdict, review_note, settled_at, hc_line, hc_home_gives,
                hc_home_odds, hc_away_odds, ou_line, ou_over_odds, ou_under_odds
         FROM gs_ht_analysis WHERE event_id = $1 LIMIT 1`,
        [eventId],
      ),
      pool.query<GsBetStats>(
        `SELECT * FROM gs_ht_stats WHERE event_id = $1 LIMIT 1`,
        [eventId],
      ),
    ]);

    return Response.json({
      ok: true,
      pick: pickRes.rows[0] ?? null,
      stats: statsRes.rows[0] ?? null,
    } satisfies GsBetsResponse);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) } satisfies GsBetsResponse);
  }
}
