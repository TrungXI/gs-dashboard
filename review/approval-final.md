# Review: APPROVED (FINAL GATE)

Verdict: **APPROVED** — the whole uncommitted "Quy luật phong độ" cluster is safe to commit.

## 6-line summary
1. `npm run build` passes clean — Next.js 16.2.10 / Turbopack, TypeScript OK, all 5 static pages generated (tail pasted below).
2. AI removal is complete: zero remaining refs to `RefereeSummary` / `.referee` / `gs-ai-judge` / `gs-postmortem` / `gs-ai-pick` / "Trọng tài AI" / `gs_ai_verdicts` / `judge_correct` anywhere in `src/`; gs-report no longer queries `gs_ai_verdicts` and no longer touches Claude/Anthropic; `V2_CUTOFF` still live (gs-report:455, gs-paper:91).
3. Adaptive narrative buckets are sound (≥85/60-84/40-59/16-39/≤15), thin(<10)/very-thin(<5) softening fires, n===0 → EmptyScenario "Chưa gặp tình huống này.", no NaN/undefined/empty-string leaks; DB spot-check (China (V) vs North Korea (V), 35 meetings) — every rendered sentence maps correctly to raw aggregates.
4. Drawer tabs: `MatchupView` uses only MatchupCard's public `{matchup,loading,error}` contract; MatchDetailDrawer passes `home`/`away`, GSLive passes `live.homeTeam`/`live.awayTeam`; default tabs unchanged (`'h1'` / `isH2?'keo':'confront'`); 0-meetings graceful; no crash path; GSLive tab array + userPickedTabRef logic intact.
5. No regression: gs-team-history v1 branch (GSLive history) untouched, v2 non-matchup (standalone Quy luật phong độ) untouched, matchup mode branches early to handleMatchup, `computeMatchup` numbers unchanged (teamForm.ts is a new file, not re-edited).
6. Surgical: gs-report + BetStatsView are pure deletions; MatchDetailDrawer's 342-line removal is the intentional AI-pick tab teardown (verified against HEAD — old file had `'ai'` tab → `/api/gs-ai-pick`, now deleted with zero other consumers); no prettier reflow observed.

## Hard gates
- **Build** ✅ `✓ Compiled successfully in 2.4s` / `Finished TypeScript in 3.5s` / `✓ Generating static pages (5/5)` — no errors, no warnings.
- **AI removal complete & safe** ✅ all greps empty; `GsReportSummary` type + BetStatsView (its only `summary` consumer) compile; deleted routes had no other importers.
- **Adaptive narrative** ✅ buckets/softening/n=0 verified against live DB.
- **Drawer tabs** ✅ contract + suffixed names + default-tab + graceful-empty all hold.
- **No regression** ✅ v1/v2/matchup/gs-bets/Dashboard paths intact.
- **Surgical** ✅ only the expected files.

## DB spot-check (China (V) vs North Korea (V), n=35, not thin)
Raw: aWin 18 / draw 8 / bWin 9 · ft_avg 3.7 · level_n 10 · A-leads-H1 15 (held 12) · B-leads-H1 10 (held 5).
- summaryLine → "China (V) nhỉnh hơn (51% vs 26%)" — correct (neither ≥60 so not "áp đảo"; 51−26>10 so not "khá cân").
- Bullet 3 (China leads H1, 80%) → "thường giữ được (12/15 trận), bị gỡ/ngược 3/15. (n=15)" — correct 60–84 band.
- Bullet 2 (NK leads H1, 50%) → "hay bị gỡ/ngược (chỉ giữ 5/10)…" — correct <60 band.
- Bullet 1 (level, ft 3.7 ≥3.5) → "nhiều bàn" — correct.

## Full changed/new/deleted file set (from `git status` — commit must include all)
Deleted:
- `src/app/api/gs-ai-judge/route.ts`
- `src/app/api/gs-ai-pick/route.ts`
- `src/app/api/gs-postmortem/route.ts`

Modified:
- `src/app/api/gs-report/route.ts`
- `src/app/api/gs-team-history/route.ts`
- `src/components/BetStatsView.tsx`
- `src/components/Dashboard.tsx`
- `src/components/GSLive.tsx`
- `src/components/MatchDetailDrawer.tsx`

New (untracked, must `git add`):
- `src/components/MatchupCard.tsx`
- `src/components/MatchupView.tsx`
- `src/components/TeamFormReport.tsx`
- `src/lib/matchupNarrative.ts`
- `src/lib/teamForm.ts`

Untracked artifacts NOT to commit (screenshots / mcp scratch / this review dir — exclude or gitignore):
- `.playwright-mcp/`
- `match-detail-drawer.png`, `match-detail-drawer-mobile.png`
- `review/`

## NIT (non-blocking, no fix required)
- `leadSentence` recomputes `heldCount = round(leaderHeldPct/100 * n)` from the already-rounded percent; in rare edge cases this can drift ±1 from the true held count. In the spot-check both matched exactly (80%→12, 50%→5). It is display-only wording and the authoritative per-row list is rendered separately, so harmless. Could pass the raw count through if ever polished.
