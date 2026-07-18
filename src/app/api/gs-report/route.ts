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

// ── Types ───────────────────────────────────────────────────────────────────

/** Granular Asian handicap / over-under outcome for one leg of a pick. */
export type AsianResult =
  | 'win'
  | 'half-win'
  | 'push'
  | 'half-loss'
  | 'loss'
  | 'skip' // pick was BỎ / BO
  | 'pending'; // no ft_score yet

/** Raw row read from gs_ht_analysis (subset used by the report). */
export interface GsReportRowRaw {
  event_id: number;
  created_at: string | null;
  home_team: string | null;
  away_team: string | null;
  ht_score: string | null;
  ft_score: string | null;
  side_pick: string | null;
  side_hit: boolean | null;
  ou_pick: string | null;
  ou_hit: boolean | null;
  confidence: string | null;
  verdict: string | null;
  review_note: string | null;
  hc_line: string | null;
  hc_home_gives: boolean | null;
  hc_home_odds: string | null;
  hc_away_odds: string | null;
  ou_line: string | null;
  ou_over_odds: string | null;
  ou_under_odds: string | null;
  settled_at: string | null;
}

/** Row enriched with the server-derived granular results. */
export interface GsReportRow extends GsReportRowRaw {
  side_result: AsianResult;
  ou_result: AsianResult;
}

export interface ResultBuckets {
  win: number;
  'half-win': number;
  push: number;
  'half-loss': number;
  loss: number;
  skip: number;
  pending: number;
}

export interface LegSummary {
  buckets: ResultBuckets;
  settled: number; // graded legs (win/half-win/push/half-loss/loss)
  winRate: number | null; // 0..1, half-win counts 0.5, push excluded from denominator
}

export interface GsReportSummary {
  total: number; // total rows
  skipped: number; // số BỎ (either leg skip counts once at row level)
  pending: number; // số chờ (rows with no ft_score)
  halfWin: number; // combined half-win legs
  halfLoss: number; // combined half-loss legs
  side: LegSummary; // chấp
  ou: LegSummary; // Tài/Xỉu
}

export interface GsReportTrend {
  last: number | null; // win-rate of last 20 settled legs (both markets combined)
  prev: number | null; // win-rate of previous 20 settled legs
  direction: 'up' | 'down' | 'flat' | null;
}

export interface GsReportResponse {
  ok: boolean;
  error?: string;
  rows?: GsReportRow[];
  rowsTotal?: number; // true count of rows matching the active filter (independent of limit/offset)
  summary?: GsReportSummary;
  trend?: GsReportTrend;
}

/** Row-list filter — mirrors the client filter chips, applied server-side. */
export type ReportFilter = 'all' | 'settled' | 'win' | 'loss' | 'skip';

// ── Derivation helpers ────────────────────────────────────────────────────────

/** Parse "2-1" / "2:1" → [home, away]; null if unparseable. */
function parseScore(s: string | null): [number, number] | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const a = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return [h, a];
}

/**
 * Handicap magnitude (positive) from a possibly split line ("0.5", "0.5-1", "0/0.5").
 * Returns the averaged absolute value, or null.
 */
function lineMagnitude(lineStr: string | null): number | null {
  if (lineStr == null) return null;
  const m = String(lineStr)
    .trim()
    .replace('/', '-')
    .match(/^(-?\d+(?:\.\d+)?)(?:-(-?\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = m[2] != null ? parseFloat(m[2]) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs((a + b) / 2);
}

/** True if the pick text is a skip (BỎ / BO / no pick). */
function isSkip(pick: string | null): boolean {
  if (!pick) return true;
  const t = pick.trim().toUpperCase();
  return t === 'BỎ' || t === 'BO' || t === 'BỎ KÈO' || t.startsWith('BỎ') || t === '-' || t === '—';
}

/** Compare a residual margin to zero. >0 win, <0 loss, =0 push. */
function gradeResidual(residual: number): 'win' | 'push' | 'loss' {
  if (residual > 1e-9) return 'win';
  if (residual < -1e-9) return 'loss';
  return 'push';
}

/**
 * Grade the picked side. `rawMargin` = goals for the picked side minus goals
 * against (before handicap). `signedLine` = the handicap in the picked side's
 * favour (positive helps the pick). Quarter lines (x.25/x.75) split the stake.
 */
function gradePick(rawMargin: number, signedLine: number): AsianResult {
  const mag = Math.abs(signedLine);
  const dir = Math.sign(signedLine) || 1;
  const frac = Math.round((mag - Math.floor(mag)) * 100) / 100;
  if (frac === 0.25 || frac === 0.75) {
    const low = mag - 0.25;
    const high = mag + 0.25;
    const g1 = gradeResidual(rawMargin + dir * low);
    const g2 = gradeResidual(rawMargin + dir * high);
    return combineHalves(g1, g2);
  }
  return gradeResidual(rawMargin + signedLine);
}

function combineHalves(
  a: 'win' | 'push' | 'loss',
  b: 'win' | 'push' | 'loss',
): AsianResult {
  const score = (r: 'win' | 'push' | 'loss') => (r === 'win' ? 1 : r === 'loss' ? -1 : 0);
  const s = score(a) + score(b); // -2..2
  if (s === 2) return 'win';
  if (s === 1) return 'half-win';
  if (s === 0) return 'push';
  if (s === -1) return 'half-loss';
  return 'loss';
}

/**
 * Decide which side (home | away) the handicap pick backs, from the free-text
 * side_pick + team names.
 */
function pickedSide(sidePick: string, home: string | null, away: string | null): 'home' | 'away' | null {
  const t = sidePick.toLowerCase();
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
  const h = home ? norm(home) : '';
  const a = away ? norm(away) : '';

  // Prefer explicit team-name mention.
  const hasHomeName = h.length >= 3 && t.includes(h);
  const hasAwayName = a.length >= 3 && t.includes(a);
  if (hasHomeName && !hasAwayName) return 'home';
  if (hasAwayName && !hasHomeName) return 'away';

  // Vietnamese keywords.
  if (/\bnhà\b|chủ nhà|cửa trên|đội nhà/.test(t)) return 'home';
  if (/\bkhách\b|cửa dưới|đội khách/.test(t)) return 'away';

  // If both/neither name matched, fall back to name that appears first.
  if (hasHomeName && hasAwayName) {
    return t.indexOf(h) <= t.indexOf(a) ? 'home' : 'away';
  }
  return null;
}

/** Derive the granular Asian handicap result for the second half (H2 = FT − HT). */
function deriveSideResult(row: GsReportRowRaw): AsianResult {
  if (isSkip(row.side_pick)) return 'skip';
  const ft = parseScore(row.ft_score);
  if (!ft) return 'pending';
  const ht = parseScore(row.ht_score) ?? [0, 0];
  const mag = lineMagnitude(row.hc_line);
  if (mag == null) {
    // No line info — fall back to the stored boolean if present.
    if (row.side_hit === true) return 'win';
    if (row.side_hit === false) return 'loss';
    return 'pending';
  }

  // H2 goal margin from home's perspective (FT − HT).
  const h2Home = (ft[0] - ft[1]) - (ht[0] - ht[1]);

  // Signed handicap in HOME's favour: home gives → home is favourite (−mag).
  const homeSignedLine = row.hc_home_gives ? -mag : mag;

  const side = pickedSide(row.side_pick ?? '', row.home_team, row.away_team);
  // Default to home when the side can't be determined — keeps grading deterministic.
  if (side === 'away') {
    return gradePick(-h2Home, -homeSignedLine);
  }
  return gradePick(h2Home, homeSignedLine);
}

/**
 * Derive the granular O/U (Tài/Xỉu) result.
 *
 * The O/U pick is a FULL-MATCH total line (the "⚡H2 bùng" picks bet the whole-match
 * over line on the expectation the 2nd half delivers goals), so it is graded against
 * the full-time total — matching how settle.js on the VPS stores `ou_hit`. Grading
 * against 2nd-half-only goals (FT − HT) understates the total and wrongly flips winning
 * Tài picks to THUA whenever the first half already scored.
 */
function deriveOuResult(row: GsReportRowRaw): AsianResult {
  if (isSkip(row.ou_pick)) return 'skip';
  const ft = parseScore(row.ft_score);
  if (!ft) return 'pending';
  const mag = lineMagnitude(row.ou_line);
  if (mag == null) {
    if (row.ou_hit === true) return 'win';
    if (row.ou_hit === false) return 'loss';
    return 'pending';
  }

  const ftTotal = ft[0] + ft[1];
  const pickText = (row.ou_pick ?? '').toLowerCase();
  const isOver = /tài|over/.test(pickText) && !/xỉu|under/.test(pickText);

  const frac = Math.round((mag - Math.floor(mag)) * 100) / 100;
  const grade = (line: number): 'win' | 'push' | 'loss' => {
    const diff = ftTotal - line;
    if (isOver) {
      if (diff > 0) return 'win';
      if (diff < 0) return 'loss';
      return 'push';
    }
    // Under (Xỉu) — default
    if (diff < 0) return 'win';
    if (diff > 0) return 'loss';
    return 'push';
  };

  if (frac === 0.25 || frac === 0.75) {
    return combineHalves(grade(mag - 0.25), grade(mag + 0.25));
  }
  return grade(mag);
}

// ── Summary / trend aggregation ───────────────────────────────────────────────

function emptyBuckets(): ResultBuckets {
  return { win: 0, 'half-win': 0, push: 0, 'half-loss': 0, loss: 0, skip: 0, pending: 0 };
}

const GRADED: AsianResult[] = ['win', 'half-win', 'push', 'half-loss', 'loss'];

function legWinValue(r: AsianResult): number | null {
  // Win-rate contribution; push excluded (returns null), non-graded excluded.
  switch (r) {
    case 'win':
      return 1;
    case 'half-win':
      return 0.5;
    case 'half-loss':
      return 0.5; // half-loss still recovers half the stake as a "win share"
    case 'loss':
      return 0;
    default:
      return null; // push / skip / pending excluded from denominator
  }
}

function legSummary(results: AsianResult[]): LegSummary {
  const buckets = emptyBuckets();
  let num = 0;
  let den = 0;
  let settled = 0;
  for (const r of results) {
    buckets[r] += 1;
    if (GRADED.includes(r)) settled += 1;
    const v = legWinValue(r);
    if (v != null) {
      num += v;
      den += 1;
    }
  }
  return { buckets, settled, winRate: den > 0 ? num / den : null };
}

function buildTrend(orderedGradedLegs: AsianResult[]): GsReportTrend {
  // orderedGradedLegs is newest-first, already filtered to graded legs.
  const rate = (arr: AsianResult[]): number | null => {
    let num = 0;
    let den = 0;
    for (const r of arr) {
      const v = legWinValue(r);
      if (v != null) {
        num += v;
        den += 1;
      }
    }
    return den > 0 ? num / den : null;
  };
  const last = rate(orderedGradedLegs.slice(0, 20));
  const prev = rate(orderedGradedLegs.slice(20, 40));
  let direction: GsReportTrend['direction'] = null;
  if (last != null && prev != null) {
    if (last > prev + 0.001) direction = 'up';
    else if (last < prev - 0.001) direction = 'down';
    else direction = 'flat';
  }
  return { last, prev, direction };
}

// ── Row-list filter (server-side) ─────────────────────────────────────────────

const WIN_SET: AsianResult[] = ['win', 'half-win'];
const LOSS_SET: AsianResult[] = ['loss', 'half-loss'];

/** Match a derived row against the active filter — mirrors the client chips. */
function rowMatchesFilter(row: GsReportRow, f: ReportFilter): boolean {
  const results = [row.side_result, row.ou_result];
  switch (f) {
    case 'all':
      return true;
    case 'settled':
      return results.some((r) => GRADED.includes(r));
    case 'win':
      return results.some((r) => WIN_SET.includes(r));
    case 'loss':
      return results.some((r) => LOSS_SET.includes(r));
    case 'skip':
      return results.some((r) => r === 'skip');
    default:
      return true;
  }
}

function parseFilter(v: string | null): ReportFilter {
  switch (v) {
    case 'settled':
    case 'win':
    case 'loss':
    case 'skip':
      return v;
    default:
      return 'all';
  }
}

function parseIntParam(v: string | null, fallback: number, min: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) return fallback;
  return n;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' } satisfies GsReportResponse);

  const url = new URL(req.url);
  const filter = parseFilter(url.searchParams.get('filter'));
  const limit = parseIntParam(url.searchParams.get('limit'), 50, 1);
  const offset = parseIntParam(url.searchParams.get('offset'), 0, 0);

  try {
    // Read every raw row once (newest-first). The derived Asian results that both
    // the summary/trend and the row filter depend on are computed here in JS, so
    // filtering/paginating happens against derived rows on the server — the client
    // only ever receives a single page.
    const res = await pool.query<GsReportRowRaw>(
      `SELECT event_id, created_at, home_team, away_team, ht_score, ft_score,
              side_pick, side_hit, ou_pick, ou_hit, confidence, verdict, review_note,
              hc_line, hc_home_gives, hc_home_odds, hc_away_odds,
              ou_line, ou_over_odds, ou_under_odds, settled_at
       FROM gs_ht_analysis
       ORDER BY created_at DESC NULLS LAST`,
    );

    const allRows: GsReportRow[] = res.rows.map((r) => ({
      ...r,
      side_result: deriveSideResult(r),
      ou_result: deriveOuResult(r),
    }));

    // Summary / trend stay over ALL rows (unfiltered) — the full dataset.
    const side = legSummary(allRows.map((r) => r.side_result));
    const ou = legSummary(allRows.map((r) => r.ou_result));

    const skipped = allRows.filter((r) => r.side_result === 'skip' || r.ou_result === 'skip').length;
    const pending = allRows.filter((r) => !parseScore(r.ft_score)).length;
    const halfWin = side.buckets['half-win'] + ou.buckets['half-win'];
    const halfLoss = side.buckets['half-loss'] + ou.buckets['half-loss'];

    const summary: GsReportSummary = {
      total: allRows.length,
      skipped,
      pending,
      halfWin,
      halfLoss,
      side,
      ou,
    };

    // Trend: combined graded legs, newest-first (rows already sorted DESC).
    const gradedLegs: AsianResult[] = [];
    for (const r of allRows) {
      if (GRADED.includes(r.side_result)) gradedLegs.push(r.side_result);
      if (GRADED.includes(r.ou_result)) gradedLegs.push(r.ou_result);
    }
    const trend = buildTrend(gradedLegs);

    // Rows page: apply the active filter, count the full filtered set, then slice.
    const filteredRows = filter === 'all' ? allRows : allRows.filter((r) => rowMatchesFilter(r, filter));
    const rowsTotal = filteredRows.length;
    const rows = filteredRows.slice(offset, offset + limit);

    return Response.json({ ok: true, rows, rowsTotal, summary, trend } satisfies GsReportResponse);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) } satisfies GsReportResponse);
  }
}
