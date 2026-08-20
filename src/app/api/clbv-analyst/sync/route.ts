import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/clbv-analyst/sync — rebuild gs_clbv_analyst FROM SCRATCH over a rolling 7-day
// window, for the "Câu Lạc Bộ" 20p league ONLY (match_odds_log.match_type = '20p_club',
// league_id 1508 — real-club-named virtual league, distinct from the 16p/20p (S/V) friendlies
// the rest of the dashboard covers). Never mix leagues here.
//
// Methodology (validated by hand against 2-3 real events before wiring this up — see the
// per-event dumps checked during development; sanity mismatches on this data run ~1%, matching
// a prior analysis pass): each of the 6 metrics is graded with the house's standard Asian
// handicap quarter-line rule (ported from `gradeOne`/`gradeLeg` in
// vps-gs/tx-paper/tx-paper-bot-vbot16p-rung.mjs). A match's outcome is credited to BOTH the
// home and away team's rows identically — it's a fact about the match, not either side's own
// scoring.

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

const WINDOW_DAYS = 7;

// ── Grading (Asian handicap quarter-line, mirrors gradeOne/gradeLeg in
//    vps-gs/tx-paper/tx-paper-bot-vbot16p-rung.mjs) ──────────────────────────────────────────
// Returns a "settled fraction": full win=1, half-win=0.75, push=0.5, half-loss=0.25, full loss=0.
// `..._rate` = mean(settled_fraction) * 100 over all graded matches.
// A match counts toward the `..._avg_goals` numerator/denominator when settled_fraction > 0.5
// (full win or half-win) — push/half-loss/loss are excluded from that average.

type Side = 'tai' | 'xiu';

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

/** Parse a match_odds_log text odds/line column ("3.25", "1.5", ...). Non-numeric → null. */
function parseLine(raw: string | null): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ── Per-team accumulator ─────────────────────────────────────────────────────────────────────

interface Agg {
  teamId: number;
  teamName: string | null;

  fullN: number; fullFracSum: number; fullWinN: number; fullWinGoalsSum: number;
  h1N: number; h1FracSum: number; h1WinN: number; h1WinGoalsSum: number;

  h2N: number;
  h2TaiFracSum: number; h2TaiWinN: number; h2TaiWinGoalsSum: number;
  h2XiuFracSum: number; h2XiuWinN: number; h2XiuWinGoalsSum: number;

  rungH1N: number; rungH1WinN: number; rungH1WinGoalsSum: number;
  rungH2N: number; rungH2WinN: number; rungH2WinGoalsSum: number;
}

function newAgg(teamId: number): Agg {
  return {
    teamId, teamName: null,
    fullN: 0, fullFracSum: 0, fullWinN: 0, fullWinGoalsSum: 0,
    h1N: 0, h1FracSum: 0, h1WinN: 0, h1WinGoalsSum: 0,
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

// ── Raw row shape from the join query ────────────────────────────────────────────────────────

interface RawRow {
  event_id: string | number;
  home_team_id: number;
  away_team_id: number;
  snapshot_type: string;
  minute: number | null;
  score_home: number;
  score_away: number;
  ou_line: string | null;
  ou_h1_line: string | null;
  recorded_at: string;
  h1_home: number;
  h1_away: number;
  tt_home: number;
  tt_away: number;
}

const JOIN_SQL = `
  SELECT o.event_id, o.home_team_id, o.away_team_id, o.snapshot_type, o.minute,
         o.score_home, o.score_away, o.ou_line, o.ou_h1_line, o.recorded_at,
         h.h1_home, h.h1_away, h.tt_home, h.tt_away
  FROM match_odds_log o
  JOIN gs_matches_history h ON h.id = o.history_id
  WHERE o.match_type = '20p_club'
    AND o.match_date >= current_date - interval '${WINDOW_DAYS} days'
    AND o.history_id IS NOT NULL
    AND o.home_team_id IS NOT NULL AND o.away_team_id IS NOT NULL
    AND h.h1_home IS NOT NULL AND h.h1_away IS NOT NULL
    AND h.tt_home IS NOT NULL AND h.tt_away IS NOT NULL
  ORDER BY o.event_id, o.recorded_at
`;

// Teams seen in-window regardless of whether their matches resolve a clean FT score — every
// team that appeared as home or away must get a row (per the sync contract), even if every
// metric for it ends up null for lack of usable data.
const TEAMS_IN_WINDOW_SQL = `
  SELECT DISTINCT team_id FROM (
    SELECT home_team_id AS team_id FROM match_odds_log
    WHERE match_type = '20p_club' AND match_date >= current_date - interval '${WINDOW_DAYS} days'
      AND home_team_id IS NOT NULL
    UNION
    SELECT away_team_id AS team_id FROM match_odds_log
    WHERE match_type = '20p_club' AND match_date >= current_date - interval '${WINDOW_DAYS} days'
      AND away_team_id IS NOT NULL
  ) t
`;

export async function POST() {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' });

  try {
    const [teamsRes, rowsRes] = await Promise.all([
      pool.query<{ team_id: number }>(TEAMS_IN_WINDOW_SQL),
      pool.query<RawRow>(JOIN_SQL),
    ]);

    const agg = new Map<number, Agg>();
    for (const t of teamsRes.rows) agg.set(t.team_id, newAgg(t.team_id));

    // Group raw rows by event_id.
    const byEvent = new Map<string, RawRow[]>();
    for (const r of rowsRes.rows) {
      const k = String(r.event_id);
      const arr = byEvent.get(k);
      if (arr) arr.push(r); else byEvent.set(k, [r]);
    }

    for (const rows of byEvent.values()) {
      const first = rows[0];
      const homeId = first.home_team_id;
      const awayId = first.away_team_id;
      const htTotal = first.h1_home + first.h1_away;
      const ftTotal = first.tt_home + first.tt_away;

      const firstSeen = rows.filter((r) => r.snapshot_type === 'first_seen')[0]; // earliest (rows sorted by recorded_at)
      const kickoffH2 = rows.filter((r) => r.snapshot_type === 'kickoff_h2')[0];
      const goalH1Rows = rows.filter((r) => r.snapshot_type === 'goal_h1');
      const goalH2Rows = rows.filter((r) => r.snapshot_type === 'goal_h2');

      // ── 1. full_* — kèo Tài cả trận ──
      let fullFrac: number | null = null;
      if (firstSeen) {
        const openLine = parseLine(firstSeen.ou_line);
        if (openLine != null) fullFrac = gradeFraction('tai', openLine, ftTotal);
      }

      // ── 2. h1_* — kèo Tài hiệp 1 ──
      let h1Frac: number | null = null;
      if (firstSeen) {
        const openH1Line = parseLine(firstSeen.ou_h1_line);
        if (openH1Line != null) h1Frac = gradeFraction('tai', openH1Line, htTotal);
      }

      // ── 3 & 4. h2_tai_* / h2_xiu_* — kèo Tài/Xỉu hiệp 2 ──
      let h2TaiFrac: number | null = null;
      let h2XiuFrac: number | null = null;
      let h2Goals: number | null = null;
      if (kickoffH2) {
        const k2Line = parseLine(kickoffH2.ou_line);
        const k2Score = kickoffH2.score_home + kickoffH2.score_away;
        // Sanity: score at kickoff_h2 should equal the HT total — else the row is unreliable
        // (broken timeline), skip H2 metrics for this event rather than risk a bad line.
        if (k2Line != null && k2Score === htTotal) {
          const effLine = k2Line - k2Score;
          h2Goals = ftTotal - k2Score;
          h2TaiFrac = gradeFraction('tai', effLine, h2Goals);
          h2XiuFrac = gradeFraction('xiu', effLine, h2Goals);
        }
      }

      // ── 5. rung_h1_* — phút 30 hiệp 1 → hết hiệp 1 ──
      // Sanity: total goal_h1 rows for the event should equal the HT total (each row = 1 goal).
      let rungH1Win: boolean | null = null;
      let rungH1Goals = 0;
      if (goalH1Rows.length === htTotal) {
        const before30 = goalH1Rows.filter((r) => r.minute != null && r.minute < 30).length;
        rungH1Goals = htTotal - before30;
        rungH1Win = rungH1Goals > 0;
      }

      // ── 6. rung_h2_* — phút 30 hiệp 2 → hết trận ──
      const h2TotalGoals = ftTotal - htTotal;
      let rungH2Win: boolean | null = null;
      let rungH2Goals = 0;
      if (goalH2Rows.length === h2TotalGoals) {
        const before30h2 = goalH2Rows.filter((r) => r.minute != null && r.minute < 30).length;
        rungH2Goals = h2TotalGoals - before30h2;
        rungH2Win = rungH2Goals > 0;
      }

      // Credit both teams identically — a fact about the match, not either side's own scoring.
      for (const teamId of [homeId, awayId]) {
        let a = agg.get(teamId);
        if (!a) { a = newAgg(teamId); agg.set(teamId, a); }

        if (fullFrac != null) {
          a.fullN++; a.fullFracSum += fullFrac;
          if (fullFrac > 0.5) { a.fullWinN++; a.fullWinGoalsSum += ftTotal; }
        }
        if (h1Frac != null) {
          a.h1N++; a.h1FracSum += h1Frac;
          if (h1Frac > 0.5) { a.h1WinN++; a.h1WinGoalsSum += htTotal; }
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
      return Response.json({ ok: true, teams: 0, windowDays: WINDOW_DAYS, updatedAt: new Date().toISOString() });
    }

    // Resolve display names ("FC Porto (V)") from gs_teams.
    const namesRes = await pool.query<{ id: number; name: string; type: string }>(
      `SELECT id, name, type FROM gs_teams WHERE id = ANY($1::int[])`,
      [teamIds]
    );
    const nameById = new Map<number, string>();
    for (const r of namesRes.rows) nameById.set(r.id, `${r.name} (${r.type})`);

    // Only upsert teams we can actually name (FK requires gs_teams(id) to exist).
    const usable = teamIds.filter((id) => nameById.has(id));

    const cols = {
      team_id: usable,
      team_name: usable.map((id) => nameById.get(id) as string),
      full_n: usable.map((id) => agg.get(id)!.fullN),
      full_tai_rate: usable.map((id) => rate(agg.get(id)!.fullFracSum, agg.get(id)!.fullN)),
      full_tai_avg_goals: usable.map((id) => avgGoals(agg.get(id)!.fullWinGoalsSum, agg.get(id)!.fullWinN)),
      h1_n: usable.map((id) => agg.get(id)!.h1N),
      h1_tai_rate: usable.map((id) => rate(agg.get(id)!.h1FracSum, agg.get(id)!.h1N)),
      h1_tai_avg_goals: usable.map((id) => avgGoals(agg.get(id)!.h1WinGoalsSum, agg.get(id)!.h1WinN)),
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
        INSERT INTO gs_clbv_analyst (
          team_id, team_name,
          full_n, full_tai_rate, full_tai_avg_goals,
          h1_n, h1_tai_rate, h1_tai_avg_goals,
          h2_n, h2_tai_rate, h2_tai_avg_goals, h2_xiu_rate, h2_xiu_avg_goals,
          rung_h1_n, rung_h1_rate, rung_h1_avg_goals,
          rung_h2_n, rung_h2_rate, rung_h2_avg_goals,
          window_days, updated_at
        )
        SELECT t.*, $20::int, now() FROM UNNEST(
          $1::int[], $2::text[],
          $3::int[], $4::numeric[], $5::numeric[],
          $6::int[], $7::numeric[], $8::numeric[],
          $9::int[], $10::numeric[], $11::numeric[], $12::numeric[], $13::numeric[],
          $14::int[], $15::numeric[], $16::numeric[],
          $17::int[], $18::numeric[], $19::numeric[]
        ) AS t(
          team_id, team_name,
          full_n, full_tai_rate, full_tai_avg_goals,
          h1_n, h1_tai_rate, h1_tai_avg_goals,
          h2_n, h2_tai_rate, h2_tai_avg_goals, h2_xiu_rate, h2_xiu_avg_goals,
          rung_h1_n, rung_h1_rate, rung_h1_avg_goals,
          rung_h2_n, rung_h2_rate, rung_h2_avg_goals
        )
        ON CONFLICT (team_id) DO UPDATE SET
          team_name = EXCLUDED.team_name,
          full_n = EXCLUDED.full_n, full_tai_rate = EXCLUDED.full_tai_rate, full_tai_avg_goals = EXCLUDED.full_tai_avg_goals,
          h1_n = EXCLUDED.h1_n, h1_tai_rate = EXCLUDED.h1_tai_rate, h1_tai_avg_goals = EXCLUDED.h1_tai_avg_goals,
          h2_n = EXCLUDED.h2_n, h2_tai_rate = EXCLUDED.h2_tai_rate, h2_tai_avg_goals = EXCLUDED.h2_tai_avg_goals,
          h2_xiu_rate = EXCLUDED.h2_xiu_rate, h2_xiu_avg_goals = EXCLUDED.h2_xiu_avg_goals,
          rung_h1_n = EXCLUDED.rung_h1_n, rung_h1_rate = EXCLUDED.rung_h1_rate, rung_h1_avg_goals = EXCLUDED.rung_h1_avg_goals,
          rung_h2_n = EXCLUDED.rung_h2_n, rung_h2_rate = EXCLUDED.rung_h2_rate, rung_h2_avg_goals = EXCLUDED.rung_h2_avg_goals,
          window_days = EXCLUDED.window_days, updated_at = EXCLUDED.updated_at
        `,
        [...Object.values(cols), WINDOW_DAYS]
      );
    }

    return Response.json({
      ok: true,
      teams: usable.length,
      windowDays: WINDOW_DAYS,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
