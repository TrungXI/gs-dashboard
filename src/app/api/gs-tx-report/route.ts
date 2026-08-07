import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool — only created when DB URL is set.
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface TxReportRow {
  id: number;
  calcVersion: string;
  entryAt: string; // ISO
  eventId: number;
  homeTeam: string;
  awayTeam: string;
  market: 'h1' | 'ft';
  side: 'tai' | 'xiu';
  line: number;
  lineRaw: string | null;
  price: number;
  pModel: number;
  edge: number | null;
  kind: 'primary' | 'nhoi';
  prevLine: number | null;
  scoredAtEntry: number;
  scoreHomeAtEntry: number | null;
  scoreAwayAtEntry: number | null;
  finalTotal: number | null;
  result: 'win' | 'half-win' | 'lose' | 'half-lose' | 'push' | null;
  pnl: number | null;
  arm29: Arm29 | null; // kèo rung VBot14: OU line Tài/Xỉu lúc phút 29 (lúc cắm cờ)
  arm25: Arm29 | null; // V.Bot 16 kèo rung 16p: OU line lúc phút 25 (cắm mốc)
  arm32: Arm29 | null; // V.Bot 16: OU line lúc phút 32 (chốt cửa sổ, đếm bàn)
  entryOdds: EntryOdds | null; // V.Bot 16: giá lúc VÀO lệnh (line over + giá)
  entryMin: number | null; // V.Bot 16: phút (trong hiệp) lúc đặt lệnh
}

// Snapshot OU line lúc phút 29 (VBot14 kèo rung) — hiển thị chi tiết lệnh.
export interface Arm29 {
  min: number;
  score: number;
  ou: Array<{ line: string; xiu: string | number | null; tai: string | number | null }>;
}
export interface EntryOdds { line: string; over: string | number | null; under: string | number | null }

export interface TxAggLine {
  bets: number;
  win: number;
  halfWin: number;
  lose: number;
  halfLose: number;
  push: number;
  winRate: number | null; // (win + 0.5·halfWin) / (win + 0.5·halfWin + lose + 0.5·halfLose)
  pnl: number;
}

export interface TxVersionAgg {
  calcVersion: string;
  primaryOnly: TxAggLine; // kind='primary' only
  withNhoi: TxAggLine; // primary + nhoi combined
  nhoiOnly: TxAggLine; // kind='nhoi' only
  openBets: number; // kèo pending vào <15' gần đây (đang thật sự vô kèo) — mọi kind; kèo mồ côi cũ KHÔNG tính
}

export interface TxReportResponse {
  ok: boolean;
  error?: string;
  versions: string[]; // all distinct calc_version, latest-first
  selectedVersion: string | 'all';
  rows: TxReportRow[]; // detail, entry_at DESC, 1 trang (pageSize)
  page: number; // 0-based
  pageSize: number;
  totalRows: number; // tổng số kèo (theo version filter) → tính số trang
  summaryByVersion: TxVersionAgg[]; // GROUP BY calc_version — always ALL versions
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_RESPONSE: TxReportResponse = {
  ok: true,
  versions: [],
  selectedVersion: 'all',
  rows: [],
  page: 0,
  pageSize: 20,
  totalRows: 0,
  summaryByVersion: [],
};

const emptyAgg = (): TxAggLine => ({ bets: 0, win: 0, halfWin: 0, lose: 0, halfLose: 0, push: 0, winRate: null, pnl: 0 });

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// One GROUP BY (calc_version, kind) aggregate row from Postgres.
interface AggDbRow {
  calc_version: string;
  kind: 'primary' | 'nhoi';
  bets: number | string;
  win: number | string;
  half_win: number | string;
  lose: number | string;
  half_lose: number | string;
  push: number | string;
  open_bets: number | string;
  pnl: number | string | null;
}

function finalizeLine(line: TxAggLine): TxAggLine {
  const winU = line.win + 0.5 * line.halfWin; // nửa-ăn = 0.5 win
  const loseU = line.lose + 0.5 * line.halfLose;
  const decided = winU + loseU;
  line.winRate = decided > 0 ? winU / decided : null;
  line.pnl = Math.round(line.pnl * 1000) / 1000;
  return line;
}

function addInto(
  dst: TxAggLine,
  src: { bets: number; win: number; halfWin: number; lose: number; halfLose: number; push: number; pnl: number },
) {
  dst.bets += src.bets;
  dst.win += src.win;
  dst.halfWin += src.halfWin;
  dst.lose += src.lose;
  dst.halfLose += src.halfLose;
  dst.push += src.push;
  dst.pnl += src.pnl;
}

// ── Row mapping ──────────────────────────────────────────────────────────────

interface TxDbRow {
  id: number | string;
  calc_version: string;
  entry_at: string | Date;
  event_id: number | string;
  home_team: string;
  away_team: string;
  market: 'h1' | 'ft';
  side: 'tai' | 'xiu';
  line: string | number;
  line_raw: string | null;
  price: string | number;
  p_model: string | number;
  edge: string | number | null;
  kind: 'primary' | 'nhoi';
  prev_line: string | number | null;
  scored_at_entry: number | string;
  score_home_at_entry: number | string | null;
  score_away_at_entry: number | string | null;
  final_total: number | string | null;
  result: 'win' | 'half-win' | 'lose' | 'half-lose' | 'push' | null;
  pnl: string | number | null;
  arm29: Arm29 | null;
  arm25: Arm29 | null;
  arm32: Arm29 | null;
  entry_odds: EntryOdds | null;
  entry_min: string | number | null;
}

function toRow(r: TxDbRow): TxReportRow {
  return {
    id: Number(r.id),
    calcVersion: r.calc_version,
    entryAt: new Date(r.entry_at).toISOString(),
    eventId: Number(r.event_id),
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    market: r.market,
    side: r.side,
    line: Number(r.line),
    lineRaw: r.line_raw,
    price: Number(r.price),
    pModel: Number(r.p_model),
    edge: r.edge == null ? null : Number(r.edge),
    kind: r.kind,
    prevLine: r.prev_line == null ? null : Number(r.prev_line),
    scoredAtEntry: Number(r.scored_at_entry),
    scoreHomeAtEntry: r.score_home_at_entry == null ? null : Number(r.score_home_at_entry),
    scoreAwayAtEntry: r.score_away_at_entry == null ? null : Number(r.score_away_at_entry),
    finalTotal: r.final_total == null ? null : Number(r.final_total),
    result: r.result,
    pnl: r.pnl == null ? null : Number(r.pnl),
    arm29: r.arm29 ?? null,
    arm25: r.arm25 ?? null,
    arm32: r.arm32 ?? null,
    entryOdds: r.entry_odds ?? null,
    entryMin: r.entry_min == null ? null : Number(r.entry_min),
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const pool = getPool();
  if (!pool) return Response.json(EMPTY_RESPONSE satisfies TxReportResponse);

  try {
    const { searchParams } = new URL(req.url);
    const versionParam = searchParams.get('version'); // specific | 'all' | null (=latest)
    const pageSize = Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), 100); // 20/trang
    const page = Math.max(Number(searchParams.get('page')) || 0, 0);
    const offset = page * pageSize;

    // 1) Distinct versions, latest (most-recent entry_at) first.
    const versionsRes = await pool.query<{ calc_version: string }>(
      `SELECT calc_version
         FROM gs_tx_paper
         GROUP BY calc_version
         ORDER BY MAX(entry_at) DESC`,
    );
    const versions = versionsRes.rows.map((r) => r.calc_version);
    const latest = versions[0] ?? null;

    // Resolve the selected version: explicit, 'all', or default → latest.
    let selectedVersion: string | 'all';
    if (versionParam === 'all') selectedVersion = 'all';
    else if (versionParam && versions.includes(versionParam)) selectedVersion = versionParam;
    else selectedVersion = latest ?? 'all';

    // 2) Detail rows — 1 TRANG (pageSize) theo version filter, ORDER BY entry_at DESC, OFFSET page.
    //    + đếm tổng số kèo (theo filter) để tính số trang.
    let rowsRes;
    let totalRes;
    if (selectedVersion === 'all') {
      rowsRes = await pool.query<TxDbRow>(
        `SELECT id, calc_version, entry_at, event_id, home_team, away_team, market, side,
                line, line_raw, price, p_model, edge, kind, prev_line, scored_at_entry,
                score_home_at_entry, score_away_at_entry,
                final_total, result, pnl, snapshot->'arm29' AS arm29,
                snapshot->'arm25' AS arm25, snapshot->'arm32' AS arm32, snapshot->'entryOdds' AS entry_odds,
                snapshot->>'minuteAtBet' AS entry_min
           FROM gs_tx_paper
           ORDER BY entry_at DESC
           LIMIT $1 OFFSET $2`,
        [pageSize, offset],
      );
      totalRes = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM gs_tx_paper`);
    } else {
      rowsRes = await pool.query<TxDbRow>(
        `SELECT id, calc_version, entry_at, event_id, home_team, away_team, market, side,
                line, line_raw, price, p_model, edge, kind, prev_line, scored_at_entry,
                score_home_at_entry, score_away_at_entry,
                final_total, result, pnl, snapshot->'arm29' AS arm29,
                snapshot->'arm25' AS arm25, snapshot->'arm32' AS arm32, snapshot->'entryOdds' AS entry_odds,
                snapshot->>'minuteAtBet' AS entry_min
           FROM gs_tx_paper
           WHERE calc_version = $1
           ORDER BY entry_at DESC
           LIMIT $2 OFFSET $3`,
        [selectedVersion, pageSize, offset],
      );
      totalRes = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM gs_tx_paper WHERE calc_version = $1`,
        [selectedVersion],
      );
    }
    const rows = rowsRes.rows.map(toRow);
    const totalRows = Number(totalRes.rows[0]?.n ?? 0);

    // 3) Aggregates — GROUP BY (calc_version, kind), ALWAYS all versions (drives compare table).
    //    Only graded legs (result IS NOT NULL) count toward win/lose/push/pnl.
    const aggRes = await pool.query<AggDbRow>(
      `SELECT calc_version, kind,
              COUNT(*) FILTER (WHERE result IS NOT NULL)::int AS bets,
              COUNT(*) FILTER (WHERE result = 'win')::int       AS win,
              COUNT(*) FILTER (WHERE result = 'half-win')::int  AS half_win,
              COUNT(*) FILTER (WHERE result = 'lose')::int      AS lose,
              COUNT(*) FILTER (WHERE result = 'half-lose')::int AS half_lose,
              COUNT(*) FILTER (WHERE result = 'push')::int      AS push,
              COUNT(*) FILTER (WHERE result IS NULL AND entry_at > now() - interval '2 hours')::int AS open_bets,
              COALESCE(SUM(pnl) FILTER (WHERE result IS NOT NULL), 0) AS pnl
         FROM gs_tx_paper
         GROUP BY calc_version, kind`,
    );

    // Assemble TxVersionAgg per calc_version.
    const byVersion = new Map<string, TxVersionAgg>();
    const ensure = (v: string): TxVersionAgg => {
      let a = byVersion.get(v);
      if (!a) {
        a = { calcVersion: v, primaryOnly: emptyAgg(), withNhoi: emptyAgg(), nhoiOnly: emptyAgg(), openBets: 0 };
        byVersion.set(v, a);
      }
      return a;
    };
    for (const r of aggRes.rows) {
      const agg = ensure(r.calc_version);
      const line = { bets: num(r.bets), win: num(r.win), halfWin: num(r.half_win), lose: num(r.lose), halfLose: num(r.half_lose), push: num(r.push), pnl: num(r.pnl) };
      addInto(agg.withNhoi, line);
      if (r.kind === 'primary') addInto(agg.primaryOnly, line);
      else addInto(agg.nhoiOnly, line);
      agg.openBets += num(r.open_bets); // gộp kèo pending <15' của mọi kind
    }
    // Keep the version ordering (latest-first) and finalize win rates.
    const summaryByVersion: TxVersionAgg[] = versions.map((v) => {
      const agg = ensure(v);
      finalizeLine(agg.primaryOnly);
      finalizeLine(agg.withNhoi);
      finalizeLine(agg.nhoiOnly);
      return agg;
    });

    return Response.json({
      ok: true,
      versions,
      selectedVersion,
      rows,
      page,
      pageSize,
      totalRows,
      summaryByVersion,
    } satisfies TxReportResponse);
  } catch (e) {
    return Response.json({ ...EMPTY_RESPONSE, ok: false, error: String(e) } satisfies TxReportResponse);
  }
}
