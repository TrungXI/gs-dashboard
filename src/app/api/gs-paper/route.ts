import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

/**
 * Same V2 cutoff used by gs-report — paper picks are only tracked from the
 * moment engine v2 went live (giờ DB). Anything older is ignored.
 */
const V2_CUTOFF = '2026-07-19 12:27:22.690527+07';

// Lazy pool — only created when DB URL is set
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * One "paper" (shadow) pick the engine WOULD have made at a near-miss (soft)
 * gate. Tracked for learning only — NOT bet, NOT sent to Telegram.
 * `hit`: true = ăn, false = thua, null = push-or-pending (chưa chấm / hoà).
 */
export interface GsPaperRow {
  event_id: number;
  leg: 'HC' | 'OU';
  pick: string | null;
  hc_line: string | null;
  hc_home_gives: boolean | null;
  ou_line: string | null;
  home_team: string | null;
  away_team: string | null;
  variant: string | null;
  rule: string | null;
  odds: string | null;
  confidence: string | null;
  ht_score: string | null;
  ft_score: string | null;
  hit: boolean | null;
  created_at: string | null;
  settled_at: string | null;
}

export interface GsPaperSummary {
  total: number; // tổng paper picks (v2-era)
  settled: number; // đã chấm win/loss (hit != null)
  win: number; // hit = true
  loss: number; // hit = false
  push: number; // đã chấm nhưng hoà (hit = null && ft_score có)
  pending: number; // chưa chấm (hit = null && chưa có ft_score)
  winRate: number | null; // 0..1 = win / (win + loss); null nếu chưa có leg đã chấm
  hcWin: number;
  hcSettled: number;
  ouWin: number;
  ouSettled: number;
}

export interface GsPaperResponse {
  ok: boolean;
  error?: string;
  rows?: GsPaperRow[];
  summary?: GsPaperSummary;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True if a final score is present (used to split push vs pending). */
function hasFtScore(ft: string | null): boolean {
  return !!ft && /^\s*\d+\s*[-:]\s*\d+\s*$/.test(ft);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' } satisfies GsPaperResponse);

  try {
    const res = await pool.query<GsPaperRow>(
      `SELECT event_id, leg, pick, hc_line, hc_home_gives, ou_line,
              home_team, away_team, variant, rule, odds, confidence,
              ht_score, ft_score, hit, created_at, settled_at
       FROM gs_paper_picks
       WHERE created_at >= $1
       ORDER BY created_at DESC NULLS LAST`,
      [V2_CUTOFF],
    );
    const rows = res.rows;

    // ── Summary — paper-only, computed independently from the real header ──
    let win = 0;
    let loss = 0;
    let push = 0;
    let pending = 0;
    let hcWin = 0;
    let hcSettled = 0;
    let ouWin = 0;
    let ouSettled = 0;

    for (const r of rows) {
      if (r.hit === true) {
        win += 1;
        if (r.leg === 'HC') { hcWin += 1; hcSettled += 1; }
        else if (r.leg === 'OU') { ouWin += 1; ouSettled += 1; }
      } else if (r.hit === false) {
        loss += 1;
        if (r.leg === 'HC') hcSettled += 1;
        else if (r.leg === 'OU') ouSettled += 1;
      } else if (hasFtScore(r.ft_score)) {
        // hit null but game is over → push / hoà (not a win-rate denominator).
        push += 1;
      } else {
        pending += 1;
      }
    }

    const settled = win + loss; // graded, push excluded
    const winRate = settled > 0 ? win / settled : null;

    const summary: GsPaperSummary = {
      total: rows.length,
      settled,
      win,
      loss,
      push,
      pending,
      winRate,
      hcWin,
      hcSettled,
      ouWin,
      ouSettled,
    };

    return Response.json({ ok: true, rows, summary } satisfies GsPaperResponse);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) } satisfies GsPaperResponse);
  }
}
