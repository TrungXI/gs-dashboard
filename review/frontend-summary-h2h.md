# Frontend summary — H2H matchup summary + match list, goal-timing removal

Target: `/Users/trung.nv/Desktop/Person/gs-dashboard` (uncommitted working tree). Two changes, four files.

## Files changed

- `src/lib/teamForm.ts`
- `src/app/api/gs-team-history/route.ts`
- `src/components/TeamFormReport.tsx`
- `src/components/MatchupCard.tsx`

No other files touched. Single-team + all-teams list, the rule panel, the v1 route (GSLive), and `Dashboard.tsx` are untouched.

---

## CHANGE 1 — goal-timing "⚡ Tốc độ & mở bàn" removed entirely

Removed symbols / code (dead helpers deleted, no dangling references):

**`teamForm.ts`**
- Types: `TempoLean`, `GoalTiming`, `GoalTimingRaw`, `EarlyH2Block`.
- Consts/fns: `EMPTY_GOAL_TIMING`, `buildGoalTiming`, `buildEarlyH2`.
- Fields: `goalTiming` on `TeamFormBlock`; `earlyH2` on `MatchupBlock`; `eventId` on `MatchupRow` (only fed the early-H2 join).
- `computeTeamForm` return type changed `Omit<…, 'team'|'matches'|'goalTiming'>` → `Omit<…, 'team'|'matches'>`.
- `computeMatchup` return type changed `Omit<MatchupBlock, 'earlyH2'>` → `MatchupBlock`.

**`route.ts`**
- Deleted `GoalTimingDbRow` interface + the entire `fetchGoalTiming()` function (the `match_odds_log` goal_h1/goal_h2 CTE that only fed goal-timing).
- Deleted the goal-timing map build in `handleV2` and the `goalTiming` field on each block.
- Deleted `OpenerDbRow` + the early-H2 opener `match_odds_log` join in `handleMatchup` (the block that always degraded to "chưa đủ dữ liệu").
- Dropped `buildGoalTiming`, `buildEarlyH2`, `GoalTimingRaw` from imports.

**`TeamFormReport.tsx`**
- Removed the `<GoalTimingCard gt={goalTiming} />` render + the whole `GoalTimingCard` component.
- Removed `TEMPO_LABEL`, the `GoalTiming`/`TempoLean` type imports, and `goalTiming` from the `TeamBlock` destructure.

**`MatchupCard.tsx`**
- Removed bullet 5 ("5 · Mở bàn sớm đầu Hiệp 2" — the `earlyH2` block) and dropped `earlyH2` from the destructure.

---

## CHANGE 2 — matchup summary card + H2H match list

### New `MatchupSummary` contract (in `teamForm.ts`, on `MatchupBlock.summary`)

Computed in `computeMatchup()` via `buildMatchupSummary(rows)`, all from **Team A's perspective** over the meetings, reusing the exact `round1/round2/pct/mean/resultScore` helpers + the same lean/lowConfidence thresholds `computeTeamForm` uses (so single-team and matchup stay visually consistent):

```ts
interface MatchupSummary {
  meetings: number;             // = MatchupBlock.meetings (the n shown everywhere)
  form: number[];               // A's per-meeting FT result −1|0|+1, CHRONOLOGICAL (oldest→newest)
  halves: {
    h1GoalDiff: number;         // avg (aH1 − bH1), 2dp
    h2GoalDiff: number;         // avg (aH2 − bH2), 2dp
    lean: 'h1' | 'h2' | 'balanced';   // leanDelta = h1GoalDiff − h2GoalDiff; >0.15 h1, <−0.15 h2, else balanced
    lowConfidence: boolean;     // |leanDelta| < 0.25 || meetings < 30  (identical to single-team)
  };
  record: {
    aWin: number; draw: number; bWin: number;
    aWinPct: number; drawPct: number; bWinPct: number;  // pct() rounding
  };
}
```

`MatchupRow` now carries `league: string` (added to the SELECT + `toMatchupRows`) for the match list; `eventId` removed.

### UI (`MatchupCard.tsx`)

- **`SummaryGrid`** rendered ABOVE the 4 diễn-biến bullets — a 3-column grid mirroring the single-team summary:
  1. **📈 Phong độ gần đây** — `FormSparkline` dot strip of A's W/D/L over the meetings (reused single-team style; green W / amber D / red L; newest on the right).
  2. **📊 W / D / L** — three `BarRow`s: `{A} thắng` / `Hoà` / `{B} thắng` with counts + %.
  3. **⏱ Hiệp 1 vs Hiệp 2** — A's H1 vs H2 goal-diff + the reused `LEAN_LABEL` descriptor + the `⚠ độ tin thấp` low-confidence flag.
- The 4 kept bullets are unchanged (dằng co / B dẫn H1 / A dẫn H1 / H2 chung), each still showing its `n` + thin/very-thin flags; the caveat footer stays.
- **`MatchupMatchList`** rendered BELOW the footer — newest→oldest, columns: `#` · time · `{A} aH1-bH1 → aFT-bFT {B}` (team-oriented, A's goals first) · league · result dot. Reuses the single-team match-row style.

Honesty preserved: every summary stat carries `meetings` as its sample size; header thin(<10)/very-thin(<5) flags stay; per-scenario `n` flags stay; summary lean is low-confidence-flagged; the max-36-trận caveat footer stays.

---

## `npm run build` result — PASS

```
> next build
▲ Next.js 16.2.10 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 3.7s
  Running TypeScript ...
  Finished TypeScript in 5.1s ...
✓ Generating static pages using 9 workers (5/5) in 113ms
  Finalizing page optimization ...
Route (app)
┌ ƒ /
├ ƒ /api/gs-team-history
└ ƒ /api/match-analysis
```

TypeScript clean, all routes compile, no dangling references to removed symbols (grep-verified).

---

## SSH data verification

### Indonesia (V) vs Thailand (V) — well-met (36 meetings)

A-perspective aggregates (SQL, matches the code's `buildMatchupSummary`):

```
meetings | a_win | draw | b_win | h1_gd | h2_gd
   36    |   5   |  7   |  24   | -0.81 | -0.53
```

Resulting `summary` (as the API returns it):

```jsonc
{
  "meetings": 36,
  "record": { "aWin": 5, "draw": 7, "bWin": 24,
              "aWinPct": 14, "drawPct": 19, "bWinPct": 67 },
  "halves": { "h1GoalDiff": -0.81, "h2GoalDiff": -0.53,
              "lean": "h2",            // leanDelta = -0.81 - (-0.53) = -0.28 < -0.15
              "lowConfidence": false } // |−0.28| ≥ 0.25 AND meetings 36 ≥ 30 → confident
}
```

Full match list present (36 rows). First 5 (newest→oldest), rendered as `Indonesia(V) aHT → aFT Thailand(V) · league`:

```
20/07/2026 19:25 · 0-4 → 1-4 · GS Asian Friendlies (Virtual) - 20 minutes
20/07/2026 06:30 · 0-0 → 1-0 · GS Asian Friendlies (Virtual) - 20 minutes
19/07/2026 22:50 · 0-1 → 0-3 · GS Asian Friendlies (Virtual) - 20 minutes
19/07/2026 10:00 · 0-0 → 0-0 · GS Asian Friendlies (Virtual) - 20 minutes
18/07/2026 22:55 · 0-2 → 1-2 · GS Asian Friendlies (Virtual) - 20 minutes
```

Sanity: Indonesia only wins 14% of the 36 meetings vs Thailand — a real, confident (non-low-conf) H2H skew, exactly the kind of signal the summary is meant to surface.

### Algeria (S) vs Panama (S) — thin (1 meeting)

```
01/07/2026 13:21 · Panama(S) 0-0 → 0-1 Algeria(S) · GS FIFA World Cup 2026 (Virtual) - 16 minutes
```

With `teamA = Algeria (S)` (A was away): summary → `meetings:1`, `record {aWin:1,draw:0,bWin:0 → aWinPct:100,...}`, `halves.lowConfidence: true` (meetings < 30). Header shows `⚠️ rất ít trận (n=1) — chỉ tham khảo` (veryThinOverall), all 4 bullets flag `n=… · chỉ tham khảo`, and the match list shows the single row. Thin-sample honesty intact.
