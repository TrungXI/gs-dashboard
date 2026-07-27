# Frontend Summary — Matchup (Diễn biến) tab in both match-detail drawers

## Files changed

| File | Change |
| --- | --- |
| `src/components/MatchupView.tsx` | **NEW** — reusable fetch+render shell. |
| `src/components/MatchDetailDrawer.tsx` | import; widen tab union; add `matchup` tabDef; add render block. |
| `src/components/GSLive.tsx` | import; widen `LiveAnalysisDrawer` activeTab union; add tab-def row; add render block. |

No other files touched. `MatchupCard.tsx`, `TeamFormReport.tsx`, `teamForm.ts`, `gs-team-history/route.ts`, `MatchAnalysis.tsx`, `BetStatsView.tsx`, `Dashboard.tsx` untouched by this task. No prettier reflow.

## MatchupView contract

```ts
export default function MatchupView({ teamA, teamB }: { teamA: string; teamB: string }): JSX.Element
```

- `teamA` / `teamB` are the **suffixed** team names (`"Saudi Arabia (V)"`), passed through verbatim — no strip/remap.
- Owns `{matchup, loading, error}` state; fetches `GET /api/gs-team-history?v=2&mode=matchup&teamA=&teamB=` on mount / prop change, mirroring `TeamFormReport.tsx`'s matchup branch.
- Maps `error === 'no db'` to the VN "chưa cấu hình ANALYSIS_DATABASE_URL" message; any other `ok:false` uses `json.error` or a generic VN fallback; network failure → generic VN error.
- Guard: empty or equal team names → `loading=false, matchup=null, error=null` (safety no-op; drawers never pass such values).
- Delegates ALL rendering (loading spinner / error box / `meetings===0` "chưa từng gặp nhau" empty state / normal card) to `<MatchupCard matchup loading error />`. No duplicated UI.
- Wraps in `<div className="px-3 pb-4 md:px-4">` to match the embedded-tab padding used by `<MatchAnalysis embedded>`.

## Tab insertion #1 — `MatchDetailDrawer.tsx` (Thống kê kèo)

- Import `MatchupView` after `MatchAnalysis` import.
- Union widened: `useState<'h1' | 'h2h' | 'matchup'>('h1')` — default tab **unchanged** (`'h1'`).
- `tabDefs` now `['h1','📊 Chỉ Số H1'], ['matchup','🔥 Diễn biến'], ['h2h','⚔️ Đối Kháng']` — new tab sits between H1 stats and Đối Kháng.
- Body render, inserted before the existing `h2h` block:
  ```tsx
  {tab === 'matchup' && <MatchupView teamA={home} teamB={away} />}
  ```

## Tab insertion #2 — `LiveAnalysisDrawer` inside `GSLive.tsx` (GS Live)

- Import `MatchupView` after `MatchAnalysis` import (top of file).
- Union widened to include `'matchup'`; initial-tab expression left untouched (`live.isH2 ? 'keo' : 'confront'`) — default tab **unchanged**.
- Tab-def array: `['matchup', '🔥', 'Diễn biến', 'border-[#fb7185]']` inserted immediately after the `confront` row (rose accent, distinct from existing colors). (Note: the array's actual on-disk order is stats/suggest/confront/history/keo with a conditional `frames` append — the SPEC's stated order differed slightly; I anchored the insert on the `confront` row per SPEC intent, so `⚔️ Đối Kháng` and `🔥 Diễn biến` stay adjacent.)
- Body render, inserted immediately after the `confront` block:
  ```tsx
  {activeTab === 'matchup' && (
    <MatchupView teamA={live.homeTeam} teamB={live.awayTeam} />
  )}
  ```
- No change to `userPickedTabRef` / `betsFetchedRef` auto-tab logic — the tab is self-contained (fetches in its own `useEffect`), like `confront`.

## Build result

`npm run build` (Next.js 16.2.10, Turbopack — real `next build`):

```
✓ Compiled successfully in 4.0s
  Running TypeScript ...
  Finished TypeScript in 6.1s ...
✓ Generating static pages using 9 workers (5/5) in 107ms
  Finalizing page optimization ...
```

PASS — 0 errors. Standalone `npx tsc --noEmit` also clean: `TypeScript: No errors found`.

## Verification (dev server on :3000, real API)

No browser MCP was available this session, so verified via the live API exactly as `MatchupView` constructs the request (`v=2&mode=matchup&teamA=&teamB=`, URL-encoded suffixed names) plus the full production build + type-check as the render check.

Real home/away pairs pulled from `/api/gs-report`, then hit the matchup API:

| Pair (suffixed) | Result |
| --- | --- |
| `Saudi Arabia (V)` vs `Japan (V)` | `ok=true`, teamA/teamB echoed exactly, `meetings=28` |
| `Indonesia (S)` vs `Cambodia (S)` | `ok=true`, `meetings=13` |
| `Thailand (S)` vs `Singapore (S)` | `ok=true`, `meetings=19` |
| `Nowhere FC (V)` vs `Japan (V)` (mismatch) | `ok=true`, `meetings=0` → MatchupCard renders "chưa từng gặp nhau", no crash |

This proves: (1) the suffix passes through unmodified and the exact-text DB match succeeds for real pairs; (2) the never-met / name-mismatch path is the graceful `meetings=0` empty-state, not an error. DB-down (`'no db'`) and generic-error paths are handled by MatchupView's error mapping and rendered by MatchupCard's error box (code path verified by inspection + type-check; not reproduced live since DB is configured).

## Not done (per SPEC)
- Did not commit or push.
- Did not change `MatchupCard` internals, the API route, `TeamFormReport`, single-team/list modes, or Dashboard.
