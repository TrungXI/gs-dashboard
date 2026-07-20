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

// ── Row shape ───────────────────────────────────────────────────────────────

interface GsPickRow {
  event_id: number;
  home_team: string | null;
  away_team: string | null;
  side_pick: string | null;
  ou_pick: string | null;
  confidence: string | null;
  hc_line: string | null;
  ou_line: string | null;
  ht_score: string | null;
  ft_score: string | null;
  verdict: string | null;
  home_shots: number | null;
  away_shots: number | null;
  home_poss: number | null;
  away_poss: number | null;
  home_xg: string | null;
  away_xg: string | null;
}

// Lightweight pick shape returned to the client, keyed by event_id
export interface GsPickLite {
  side_pick: string | null;
  ou_pick: string | null;
  confidence: string | null;
  hc_line: string | null;
  ou_line: string | null;
  ht_score: string | null;
  ft_score: string | null;
  verdict: string | null;
  // Chỉ số H1 cốt lõi (đủ để hiện gọn ngoài list)
  home_shots: number | null;
  away_shots: number | null;
  home_poss: number | null;
  away_poss: number | null;
  home_xg: string | null;
  away_xg: string | null;
}

export interface GsPicksResponse {
  ok: boolean;
  error?: string;
  picks?: Record<number, GsPickLite>;
}

export async function GET(req: NextRequest) {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' } satisfies GsPicksResponse);

  const eventIds = (req.nextUrl.searchParams.get('eventIds') ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (eventIds.length === 0) return Response.json({ ok: true, picks: {} } satisfies GsPicksResponse);

  try {
    const res = await pool.query<GsPickRow>(
      `SELECT a.event_id, a.home_team, a.away_team, a.side_pick, a.ou_pick, a.confidence,
              a.hc_line, a.ou_line, a.ht_score, a.ft_score, a.verdict,
              s.home_shots, s.away_shots, s.home_poss, s.away_poss, s.home_xg, s.away_xg
       FROM gs_ht_analysis a
       LEFT JOIN gs_ht_stats s ON s.event_id = a.event_id
       WHERE a.event_id = ANY($1::bigint[])
         AND (a.side_pick <> 'BỎ' OR a.ou_pick <> 'BỎ')`,
      [eventIds],
    );

    const picks: Record<number, GsPickLite> = {};
    for (const r of res.rows) {
      picks[r.event_id] = {
        side_pick: r.side_pick,
        ou_pick: r.ou_pick,
        confidence: r.confidence,
        hc_line: r.hc_line,
        ou_line: r.ou_line,
        ht_score: r.ht_score,
        ft_score: r.ft_score,
        verdict: r.verdict,
        home_shots: r.home_shots,
        away_shots: r.away_shots,
        home_poss: r.home_poss,
        away_poss: r.away_poss,
        home_xg: r.home_xg,
        away_xg: r.away_xg,
      };
    }

    return Response.json({ ok: true, picks } satisfies GsPicksResponse);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) } satisfies GsPicksResponse);
  }
}
