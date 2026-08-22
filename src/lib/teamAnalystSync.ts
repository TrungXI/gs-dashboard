import type { Pool } from 'pg';

// Shared sync logic for gs_clbv_analyst (match_type='20p_club') and gs_asians_analyst
// (match_type='16p') — both tables have an IDENTICAL schema and methodology; only the
// source league (match_type) and destination table differ. Consolidated here 2026-08-22
// (previously hand-duplicated between the two /sync routes — see gs-sync-auditor's mandate
// against exactly this kind of copy) when both were switched to read from `gs_full_ticks`
// instead of `match_odds_log` JOIN `gs_matches_history`.
//
// WHY gs_full_ticks: match_odds_log only logs discrete named snapshots (first_seen,
// kickoff_h2, goal_h1, goal_h2) — good enough for goal-COUNT-based rung detection with a
// strict "row count == HT/FT goal count" sanity gate. gs_full_ticks logs a row on ANY score/
// odds/period change (or every ~30s heartbeat) across ALL 4 leagues, with numeric line/price
// columns (no text parsing) and FT score backfilled onto every row of an event. That
// continuous sampling lets rung detection read the running score total at the minute-30
// boundary directly, instead of counting discrete goal events — simpler and not dependent on
// collector.js never missing/duplicating a goal_h1/goal_h2 snapshot.
//
// gs_full_ticks does NOT store a half-time score column — it's derived here as the score at
// the LAST tick observed while still in H1 (is_h2=false), which is safe because ANY score
// change generates a new tick (see tx-16p-tick-logger.mjs's `sig` fingerprint), so no goal can
// happen between that tick and the true HT score without also generating a tick.

export type Side = 'tai' | 'xiu';

function oneLegFraction(side: Side, line: number, total: number): number {
  const intLine = Number.isInteger(line);
  if (side === 'tai') {
    if (total > line) return 1;
    if (intLine && total === line) return 0.5;
    return 0;
  }
  if (total < line) return 1;
  if (intLine && total === line) return 0.5;
  return 0;
}

function gradeFraction(side: Side, line: number, total: number): number {
  const isQuarter = Math.abs(line * 2 - Math.round(line * 2)) > 1e-9;
  if (!isQuarter) return oneLegFraction(side, line, total);
  const lo = oneLegFraction(side, line - 0.25, total);
  const hi = oneLegFraction(side, line + 0.25, total);
  return (lo + hi) / 2;
}

interface Agg {
  teamId: number;
  fullN: number; fullFracSum: number; fullWinN: number; fullWinGoalsSum: number;
  fullXiuFracSum: number; fullXiuWinN: number; fullXiuWinGoalsSum: number;
  h1N: number; h1FracSum: number; h1WinN: number; h1WinGoalsSum: number;
  h1XiuFracSum: number; h1XiuWinN: number; h1XiuWinGoalsSum: number;
  h2N: number;
  h2TaiFracSum: number; h2TaiWinN: number; h2TaiWinGoalsSum: number;
  h2XiuFracSum: number; h2XiuWinN: number; h2XiuWinGoalsSum: number;
  rungH1N: number; rungH1WinN: number; rungH1WinGoalsSum: number;
  rungH2N: number; rungH2WinN: number; rungH2WinGoalsSum: number;
}

function newAgg(teamId: number): Agg {
  return {
    teamId,
    fullN: 0, fullFracSum: 0, fullWinN: 0, fullWinGoalsSum: 0,
    fullXiuFracSum: 0, fullXiuWinN: 0, fullXiuWinGoalsSum: 0,
    h1N: 0, h1FracSum: 0, h1WinN: 0, h1WinGoalsSum: 0,
    h1XiuFracSum: 0, h1XiuWinN: 0, h1XiuWinGoalsSum: 0,
    h2N: 0,
    h2TaiFracSum: 0, h2TaiWinN: 0, h2TaiWinGoalsSum: 0,
    h2XiuFracSum: 0, h2XiuWinN: 0, h2XiuWinGoalsSum: 0,
    rungH1N: 0, rungH1WinN: 0, rungH1WinGoalsSum: 0,
    rungH2N: 0, rungH2WinN: 0, rungH2WinGoalsSum: 0,
  };
}

function rate(sumFrac: number, n: number): number | null {
  return n > 0 ? Math.round((sumFrac / n) * 100 * 100) / 100 : null;
}
function avgGoals(sumGoals: number, winN: number): number | null {
  return winN > 0 ? Math.round((sumGoals / winN) * 1000) / 1000 : null;
}

interface TickRow {
  event_id: string | number;
  home_team_id: number;
  away_team_id: number;
  recorded_at: string;
  minute: number | null;
  period: number | null;
  is_h2: boolean | null;
  score_home: number | null;
  score_away: number | null;
  ft_line: string | null;
  h1_line: string | null;
  ft_home: number;
  ft_away: number;
}

const num = (v: string | number | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Only these two tables are ever passed in — never user input — but keep an explicit
// allowlist so a future caller can't accidentally interpolate an arbitrary identifier.
const ALLOWED_TABLES = new Set(['gs_clbv_analyst', 'gs_asians_analyst']);

export interface SyncResult {
  ok: true;
  teams: number;
  windowDays: number;
  updatedAt: string;
}

export async function syncTeamAnalyst(
  pool: Pool,
  opts: { matchType: string; table: string; windowDays?: number }
): Promise<SyncResult> {
  const { matchType } = opts;
  const table = opts.table;
  if (!ALLOWED_TABLES.has(table)) throw new Error(`unknown analyst table: ${table}`);
  const WINDOW_DAYS = opts.windowDays ?? 7;
  // Interpolated directly into the interval literal below (can't bind an interval as a query
  // param) — both current callers omit windowDays so this is inert today, but validate anyway
  // so a future caller can never turn it into an injection surface.
  if (!Number.isInteger(WINDOW_DAYS) || WINDOW_DAYS < 1 || WINDOW_DAYS > 365) {
    throw new Error(`invalid windowDays: ${WINDOW_DAYS}`);
  }

  const [teamsRes, rowsRes] = await Promise.all([
    pool.query<{ team_id: number }>(
      `SELECT DISTINCT team_id FROM (
         SELECT home_team_id AS team_id FROM gs_full_ticks
         WHERE match_type = $1 AND recorded_at >= now() - interval '${WINDOW_DAYS} days'
           AND home_team_id IS NOT NULL
         UNION
         SELECT away_team_id AS team_id FROM gs_full_ticks
         WHERE match_type = $1 AND recorded_at >= now() - interval '${WINDOW_DAYS} days'
           AND away_team_id IS NOT NULL
       ) t`,
      [matchType]
    ),
    pool.query<TickRow>(
      `SELECT event_id, home_team_id, away_team_id, recorded_at, minute, period, is_h2,
              score_home, score_away, ft_line, h1_line, ft_home, ft_away
         FROM gs_full_ticks
        WHERE match_type = $1
          AND recorded_at >= now() - interval '${WINDOW_DAYS} days'
          AND history_id IS NOT NULL
          AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
          AND ft_home IS NOT NULL AND ft_away IS NOT NULL
        ORDER BY event_id, recorded_at`,
      [matchType]
    ),
  ]);

  const agg = new Map<number, Agg>();
  for (const t of teamsRes.rows) agg.set(t.team_id, newAgg(t.team_id));

  const byEvent = new Map<string, TickRow[]>();
  for (const r of rowsRes.rows) {
    const k = String(r.event_id);
    const arr = byEvent.get(k);
    if (arr) arr.push(r); else byEvent.set(k, [r]);
  }

  for (const rows of byEvent.values()) {
    const first = rows[0]; // earliest tick — "first_seen" equivalent
    const homeId = first.home_team_id;
    const awayId = first.away_team_id;
    const ftTotal = first.ft_home + first.ft_away; // backfilled onto every row of the event

    // HT total = score at the LAST tick still in H1 — safe because any score change emits a
    // new tick (see module header), so nothing can be missed between that tick and kickoff_h2.
    // 2026-08-22 (review): filter on period IN (2, 4) explicitly — NOT `is_h2 === false` — since
    // a rare non-standard period value (seen live: period=16, ~5 rows total across the whole
    // table, likely a post-match/finished status) also reports is_h2=false. If such a tick is
    // the LAST one recorded for an event, it would otherwise be picked as "the HT tick" and
    // silently corrupt htTotal to the FT score. period=4 (half-time break, ball not in play) is
    // included on purpose — the score during HT break IS the true HT score, so keeping it here
    // is harmless and correctly ties the HT total to the true last-of-H1 hemisphere.
    const h1Rows = rows.filter((r) => r.period === 2 || r.period === 4);
    const h1Home = num(h1Rows.length ? String(h1Rows[h1Rows.length - 1].score_home) : null);
    const h1Away = num(h1Rows.length ? String(h1Rows[h1Rows.length - 1].score_away) : null);
    const htTotal = h1Home != null && h1Away != null ? h1Home + h1Away : null;

    // ── 1. full_* — kèo Tài/Xỉu cả trận (line tại tick sớm nhất, có thể null nếu chưa mở kèo) ──
    let fullFrac: number | null = null;
    let fullXiuFrac: number | null = null;
    const openLine = num(first.ft_line);
    if (openLine != null) {
      fullFrac = gradeFraction('tai', openLine, ftTotal);
      fullXiuFrac = gradeFraction('xiu', openLine, ftTotal);
    }

    // ── 2. h1_* — kèo Tài/Xỉu hiệp 1 ──
    let h1Frac: number | null = null;
    let h1XiuFrac: number | null = null;
    const openH1Line = num(first.h1_line);
    if (openH1Line != null && htTotal != null) {
      h1Frac = gradeFraction('tai', openH1Line, htTotal);
      h1XiuFrac = gradeFraction('xiu', openH1Line, htTotal);
    }

    // ── 3 & 4. h2_tai_* / h2_xiu_* — kèo Tài/Xỉu hiệp 2 (mức CẢ TRẬN tại kickoff_h2) ──
    let h2TaiFrac: number | null = null;
    let h2XiuFrac: number | null = null;
    let h2Goals: number | null = null;
    const h2Rows = rows.filter((r) => r.is_h2 === true);
    if (h2Rows.length && htTotal != null) {
      const kickoffH2 = h2Rows[0]; // earliest tick after half-time
      const k2Line = num(kickoffH2.ft_line);
      const k2Home = num(kickoffH2.score_home);
      const k2Away = num(kickoffH2.score_away);
      if (k2Line != null && k2Home != null && k2Away != null) {
        const k2Score = k2Home + k2Away;
        // Sanity: score at kickoff_h2 should equal the HT total — else the boundary tick is
        // unreliable (e.g. a goal landed exactly between our two boundary reads), skip H2.
        if (k2Score === htTotal) {
          const effLine = k2Line - k2Score;
          h2Goals = ftTotal - k2Score;
          h2TaiFrac = gradeFraction('tai', effLine, h2Goals);
          h2XiuFrac = gradeFraction('xiu', effLine, h2Goals);
        }
      }
    }

    // ── 5. rung_h1_* — tổng bàn tại mốc phút 30 hiệp 1 so với tổng bàn cuối hiệp 1 (HT) ──
    // 2026-08-22 (review, defense-in-depth): lọc RIÊNG period===2 ở đây (không dùng chung h1Rows,
    // vốn cũng gồm period=4 half-time-break cho mục đích tính htTotal) — dù đã xác nhận thực tế
    // period=4 luôn có minute trong [46,50] (rất xa mốc 30, vô hại), tách riêng bộ lọc này loại
    // bỏ hoàn toàn phụ thuộc ngầm vào sự kiện đó luôn đúng trong tương lai.
    let rungH1Win: boolean | null = null;
    let rungH1Goals = 0;
    {
      const before30 = h1Rows.filter((r) => r.period === 2 && r.minute != null && r.minute < 30 && r.score_home != null && r.score_away != null);
      if (before30.length && htTotal != null) {
        const last = before30[before30.length - 1];
        const totalBefore30 = Number(last.score_home) + Number(last.score_away);
        rungH1Goals = htTotal - totalBefore30;
        rungH1Win = rungH1Goals > 0;
      }
    }

    // ── 6. rung_h2_* — tổng bàn CẢ TRẬN tại mốc phút 30 hiệp 2 so với FT ──
    const h2TotalGoals = htTotal != null ? ftTotal - htTotal : null;
    let rungH2Win: boolean | null = null;
    let rungH2Goals = 0;
    {
      const before30h2 = h2Rows.filter((r) => r.minute != null && r.minute < 30 && r.score_home != null && r.score_away != null);
      if (before30h2.length) {
        const last = before30h2[before30h2.length - 1];
        const totalBefore30h2 = Number(last.score_home) + Number(last.score_away);
        rungH2Goals = ftTotal - totalBefore30h2;
        rungH2Win = rungH2Goals > 0;
      }
    }
    void h2TotalGoals; // kept for parity with the previous methodology's naming; not needed directly

    // Credit both teams identically — a fact about the match, not either side's own scoring.
    for (const teamId of [homeId, awayId]) {
      let a = agg.get(teamId);
      if (!a) { a = newAgg(teamId); agg.set(teamId, a); }

      if (fullFrac != null && fullXiuFrac != null) {
        a.fullN++; a.fullFracSum += fullFrac;
        if (fullFrac > 0.5) { a.fullWinN++; a.fullWinGoalsSum += ftTotal; }
        a.fullXiuFracSum += fullXiuFrac;
        if (fullXiuFrac > 0.5) { a.fullXiuWinN++; a.fullXiuWinGoalsSum += ftTotal; }
      }
      if (h1Frac != null && h1XiuFrac != null && htTotal != null) {
        a.h1N++; a.h1FracSum += h1Frac;
        if (h1Frac > 0.5) { a.h1WinN++; a.h1WinGoalsSum += htTotal; }
        a.h1XiuFracSum += h1XiuFrac;
        if (h1XiuFrac > 0.5) { a.h1XiuWinN++; a.h1XiuWinGoalsSum += htTotal; }
      }
      if (h2TaiFrac != null && h2XiuFrac != null && h2Goals != null) {
        a.h2N++;
        a.h2TaiFracSum += h2TaiFrac;
        if (h2TaiFrac > 0.5) { a.h2TaiWinN++; a.h2TaiWinGoalsSum += h2Goals; }
        a.h2XiuFracSum += h2XiuFrac;
        if (h2XiuFrac > 0.5) { a.h2XiuWinN++; a.h2XiuWinGoalsSum += h2Goals; }
      }
      if (rungH1Win != null) {
        a.rungH1N++;
        if (rungH1Win) { a.rungH1WinN++; a.rungH1WinGoalsSum += rungH1Goals; }
      }
      if (rungH2Win != null) {
        a.rungH2N++;
        if (rungH2Win) { a.rungH2WinN++; a.rungH2WinGoalsSum += rungH2Goals; }
      }
    }
  }

  const teamIds = [...agg.keys()];
  if (teamIds.length === 0) {
    // "Rebuild FROM SCRATCH" contract — no team seen in-window means the table should end up
    // empty too, not keep whatever a previous sync (over a different window) left behind.
    await pool.query(`DELETE FROM ${table}`);
    return { ok: true, teams: 0, windowDays: WINDOW_DAYS, updatedAt: new Date().toISOString() };
  }

  const namesRes = await pool.query<{ id: number; name: string; type: string }>(
    `SELECT id, name, type FROM gs_teams WHERE id = ANY($1::int[])`,
    [teamIds]
  );
  const nameById = new Map<number, string>();
  for (const r of namesRes.rows) nameById.set(r.id, `${r.name} (${r.type})`);

  // Only upsert teams we can actually name (FK requires gs_teams(id) to exist).
  const usable = teamIds.filter((id) => nameById.has(id));

  // 2026-08-22 (review): the upsert below only ever adds/updates rows — a team that drops out
  // of the rolling window (hasn't played in `windowDays`) previously kept its stale row forever,
  // contradicting the "rebuild FROM SCRATCH" comment at the top of this file. That matters now:
  // the Goal-bot family (checkMatchEligible in tx-paper-bot-*-goalxiu*.mjs) treats a NULL
  // avg-goals column as "ineligible", and a stale non-NULL value from days ago would silently
  // defeat that guard. Purge every row whose team wasn't seen in THIS run's window first.
  await pool.query(`DELETE FROM ${table} WHERE team_id <> ALL($1::int[])`, [usable]);

  const cols = {
    team_id: usable,
    team_name: usable.map((id) => nameById.get(id) as string),
    full_n: usable.map((id) => agg.get(id)!.fullN),
    full_tai_rate: usable.map((id) => rate(agg.get(id)!.fullFracSum, agg.get(id)!.fullN)),
    full_tai_avg_goals: usable.map((id) => avgGoals(agg.get(id)!.fullWinGoalsSum, agg.get(id)!.fullWinN)),
    full_xiu_rate: usable.map((id) => rate(agg.get(id)!.fullXiuFracSum, agg.get(id)!.fullN)),
    full_xiu_avg_goals: usable.map((id) => avgGoals(agg.get(id)!.fullXiuWinGoalsSum, agg.get(id)!.fullXiuWinN)),
    h1_n: usable.map((id) => agg.get(id)!.h1N),
    h1_tai_rate: usable.map((id) => rate(agg.get(id)!.h1FracSum, agg.get(id)!.h1N)),
    h1_tai_avg_goals: usable.map((id) => avgGoals(agg.get(id)!.h1WinGoalsSum, agg.get(id)!.h1WinN)),
    h1_xiu_rate: usable.map((id) => rate(agg.get(id)!.h1XiuFracSum, agg.get(id)!.h1N)),
    h1_xiu_avg_goals: usable.map((id) => avgGoals(agg.get(id)!.h1XiuWinGoalsSum, agg.get(id)!.h1XiuWinN)),
    h2_n: usable.map((id) => agg.get(id)!.h2N),
    h2_tai_rate: usable.map((id) => rate(agg.get(id)!.h2TaiFracSum, agg.get(id)!.h2N)),
    h2_tai_avg_goals: usable.map((id) => avgGoals(agg.get(id)!.h2TaiWinGoalsSum, agg.get(id)!.h2TaiWinN)),
    h2_xiu_rate: usable.map((id) => rate(agg.get(id)!.h2XiuFracSum, agg.get(id)!.h2N)),
    h2_xiu_avg_goals: usable.map((id) => avgGoals(agg.get(id)!.h2XiuWinGoalsSum, agg.get(id)!.h2XiuWinN)),
    rung_h1_n: usable.map((id) => agg.get(id)!.rungH1N),
    rung_h1_rate: usable.map((id) => rate(agg.get(id)!.rungH1WinN, agg.get(id)!.rungH1N)),
    rung_h1_avg_goals: usable.map((id) => avgGoals(agg.get(id)!.rungH1WinGoalsSum, agg.get(id)!.rungH1WinN)),
    rung_h2_n: usable.map((id) => agg.get(id)!.rungH2N),
    rung_h2_rate: usable.map((id) => rate(agg.get(id)!.rungH2WinN, agg.get(id)!.rungH2N)),
    rung_h2_avg_goals: usable.map((id) => avgGoals(agg.get(id)!.rungH2WinGoalsSum, agg.get(id)!.rungH2WinN)),
  };

  if (usable.length > 0) {
    await pool.query(
      `
      INSERT INTO ${table} (
        team_id, team_name,
        full_n, full_tai_rate, full_tai_avg_goals, full_xiu_rate, full_xiu_avg_goals,
        h1_n, h1_tai_rate, h1_tai_avg_goals, h1_xiu_rate, h1_xiu_avg_goals,
        h2_n, h2_tai_rate, h2_tai_avg_goals, h2_xiu_rate, h2_xiu_avg_goals,
        rung_h1_n, rung_h1_rate, rung_h1_avg_goals,
        rung_h2_n, rung_h2_rate, rung_h2_avg_goals,
        window_days, updated_at
      )
      SELECT t.*, $24::int, now() FROM UNNEST(
        $1::int[], $2::text[],
        $3::int[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[],
        $8::int[], $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[],
        $13::int[], $14::numeric[], $15::numeric[], $16::numeric[], $17::numeric[],
        $18::int[], $19::numeric[], $20::numeric[],
        $21::int[], $22::numeric[], $23::numeric[]
      ) AS t(
        team_id, team_name,
        full_n, full_tai_rate, full_tai_avg_goals, full_xiu_rate, full_xiu_avg_goals,
        h1_n, h1_tai_rate, h1_tai_avg_goals, h1_xiu_rate, h1_xiu_avg_goals,
        h2_n, h2_tai_rate, h2_tai_avg_goals, h2_xiu_rate, h2_xiu_avg_goals,
        rung_h1_n, rung_h1_rate, rung_h1_avg_goals,
        rung_h2_n, rung_h2_rate, rung_h2_avg_goals
      )
      ON CONFLICT (team_id) DO UPDATE SET
        team_name = EXCLUDED.team_name,
        full_n = EXCLUDED.full_n, full_tai_rate = EXCLUDED.full_tai_rate, full_tai_avg_goals = EXCLUDED.full_tai_avg_goals,
        full_xiu_rate = EXCLUDED.full_xiu_rate, full_xiu_avg_goals = EXCLUDED.full_xiu_avg_goals,
        h1_n = EXCLUDED.h1_n, h1_tai_rate = EXCLUDED.h1_tai_rate, h1_tai_avg_goals = EXCLUDED.h1_tai_avg_goals,
        h1_xiu_rate = EXCLUDED.h1_xiu_rate, h1_xiu_avg_goals = EXCLUDED.h1_xiu_avg_goals,
        h2_n = EXCLUDED.h2_n, h2_tai_rate = EXCLUDED.h2_tai_rate, h2_tai_avg_goals = EXCLUDED.h2_tai_avg_goals,
        h2_xiu_rate = EXCLUDED.h2_xiu_rate, h2_xiu_avg_goals = EXCLUDED.h2_xiu_avg_goals,
        rung_h1_n = EXCLUDED.rung_h1_n, rung_h1_rate = EXCLUDED.rung_h1_rate, rung_h1_avg_goals = EXCLUDED.rung_h1_avg_goals,
        rung_h2_n = EXCLUDED.rung_h2_n, rung_h2_rate = EXCLUDED.rung_h2_rate, rung_h2_avg_goals = EXCLUDED.rung_h2_avg_goals,
        window_days = EXCLUDED.window_days, updated_at = EXCLUDED.updated_at
      `,
      [...Object.values(cols), WINDOW_DAYS]
    );
  }

  return {
    ok: true,
    teams: usable.length,
    windowDays: WINDOW_DAYS,
    updatedAt: new Date().toISOString(),
  };
}
