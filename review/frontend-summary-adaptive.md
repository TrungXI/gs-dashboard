# Matchup narrative — deterministic adaptive phrasing

Made the 2-team matchup wording adapt to the numbers via fixed threshold buckets.
No AI / Claude — same input → same words, every time. The computed numbers, route,
flags, single-team view, list modes, and Dashboard are untouched; only the WORDING
of the 4 scenario bullets + the summary line changed.

## Files

- **`src/lib/matchupNarrative.ts`** (new) — the phrasing helper. Pure functions over
  the existing `ScenarioBlock` / `MatchupSummary` shapes, no new state.
- **`src/components/MatchupCard.tsx`** (edited) — the 4 bullet bodies + a new adaptive
  summary line now call the helper; the fixed sentence templates were removed. `n`
  chips (`Nflag`/`ScenarioFlag`), the `EmptyScenario` "Chưa gặp tình huống này.", the
  `meetings === 0` card, and the honesty footer are unchanged. Dead `num()`/`pctStr()`
  helpers (no longer referenced) removed so the build lints clean.

Both files were already untracked (part of the uncommitted matchup work) — no tracked
file changed. Nothing committed or pushed.

## Threshold table

**Rate → qualifier** (`rateQualifier`, applied to hold-rate / win-rate; `draw=true`
swaps the mid band):

| rate    | normal        | draw variant     |
| ------- | ------------- | ---------------- |
| ≥ 85%   | gần như chắc  | gần như luôn     |
| 60–84%  | thường        | thường           |
| 40–59%  | khá cân       | hay dắt nhau     |
| 16–39%  | hiếm khi      | hiếm khi         |
| ≤ 15%   | gần như không | gần như không    |

**FT goal volume** (`goalVolume`): ≥ 3.5 → "nhiều bàn" · ≤ 2 → "ít bàn" · else "số bàn
vừa phải" · `null` → "chưa rõ số bàn" (no `NaN`/`undefined` leaks).

**Sample-size / softening** (load-bearing honesty):
- `n` is ALWAYS shown via `sampleNote`: `n<5 → " (n=… · chỉ tham khảo)"`,
  `n<10 → " (n=… · mẫu còn ít)"`, else `" (n=…)"`.
- Strong claims (≥85% or ≤15%) SOFTEN, never assert, on small samples:
  `n<5 → "— mẫu quá ít, chỉ tham khảo"`; a saturated 100%/0% on `n<20 →
  "(mẫu ít nên chưa chắc chắn)"`; a thin (`n<10`) strong claim → "(mẫu còn ít nên
  chưa chắc chắn)". So **100% on n=10 renders "10/10 … (mẫu ít nên chưa chắc chắn)"**,
  not a hard certainty.
- `n === 0` → "Chưa gặp tình huống này." (unchanged, handled in the card).
- Boundaries safe: exact 50% (`≥40` bucket), 0 counts, and `null` avgs all guarded.

**Per-scenario dominant signal:**
1. **Level (hoà):** if `draw%` is the max of {aWin,draw,bWin} → "hay dắt nhau về hoà
   (X%)"; else the modal team "gần như luôn thắng" (≥85%) / "nhỉnh hơn". Adds H2-goals
   avg + FT-volume words.
2 & 3. **A/B leads H1:** hold-rate → ≥85% "dẫn H1 gần như chắc thắng — giữ trọn h/n
   trận"; 60–84% "thường giữ được (h/n)"; else "hay bị gỡ/ngược (chỉ giữ h/n)". Pegged
   count woven in.
4. **H2 chung:** higher H2-scoring team named + qualifier; change-of-outcome <25% "ít
   khi lật kèo (~x/y trận)" · 25–40% "thỉnh thoảng đổi cục diện" · >40% "hay đảo cục
   diện".
- **Summary line:** dominant record (≥60%) → "{team} áp đảo cặp này (X%)"; near-even /
  draw-heavy → "hai đội khá cân"; else "{team} nhỉnh hơn"; + lean tail "nhỉnh hơn ở
  hiệp 1/2"; thin sample → "— mẫu còn ít" / "— chỉ tham khảo".

## `npm run build` — PASS

```
  Creating an optimized production build ...
✓ Compiled successfully in 4.1s
  Running TypeScript ...
  Finished TypeScript in 6.5s ...
✓ Generating static pages using 9 workers (5/5) in 108ms
  Finalizing page optimization ...
```

Also confirmed the running dev server (:3000, live DB) compiles the updated component
tree — `GET /` → HTTP 200, and `GET /api/gs-team-history?v=2&mode=matchup&teamA=Japan
(V)&teamB=Korea Republic (V)` → `meetings:32` (matches ground truth below).
Browser MCP (playwright / claude-in-chrome) was not registered in this environment, so
UI verification was done against real DB data through the running server + exact
render of the helper on ground-truth blocks.

## Rendered sentences (real data pulled via SSH, computed with the exact
`computeMatchup` numbers, then run through the helper)

### Japan (V) vs Korea Republic (V) — 32 meetings (100%-hold + draw-heavy H1)
```
SUMMARY : hai đội khá cân · Japan (V) nhỉnh hơn ở hiệp 2.
B1 hoà : Khi H1 hoà nhau, hay dắt nhau về hoà (50%); H2 thêm TB 1.6 bàn, cả trận
         thường số bàn vừa phải (TB 3.4). (n=12)
B2 KOR : Korea Republic (V) dẫn H1 gần như chắc thắng — giữ trọn 9/10 trận,
         bị gỡ/ngược 1/10. (n=10)
B3 JPN : Japan (V) dẫn H1 gần như chắc thắng — giữ trọn 10/10 trận
         (mẫu ít nên chưa chắc chắn). (n=10)      ← 100% softened
B4 H2  : Nhìn chung H2: TB 1.9 bàn/H2; Japan (V) thường ghi bàn ở H2 (72% vs 56%);
         ít khi lật kèo (~7/32 trận đổi kết quả so với H1).
```
- 100% hold (n=10) → **softened** with "(mẫu ít nên chưa chắc chắn)".
- draw is modal at H1 → **"hay dắt nhau về hoà (50%)"**.

### Indonesia (V) vs Thailand (V) — 36 meetings (one-sided 14/19/67 + very-thin lead)
```
SUMMARY : Thailand (V) áp đảo cặp này (67%) · Indonesia (V) nhỉnh hơn ở hiệp 2.  ← áp đảo
B1 hoà : Khi H1 hoà nhau, Thailand (V) nhỉnh hơn (50%); H2 thêm TB 1.6 bàn, cả trận
         thường ít bàn (TB 1.8). (n=16)
B2 THA : Thailand (V) dẫn H1 gần như chắc thắng — giữ trọn 15/17 trận,
         bị gỡ/ngược 2/17. (n=17)
B3 IDN : Indonesia (V) dẫn H1 thì thường giữ được (2/3 trận), bị gỡ/ngược 1/3
         — mẫu quá ít, chỉ tham khảo. (n=3 · chỉ tham khảo)     ← very-thin softened
B4 H2  : Nhìn chung H2: TB 1.7 bàn/H2; Thailand (V) thường ghi bàn ở H2 (64% vs 47%);
         thỉnh thoảng đổi cục diện (14/36 trận).
```
- 67% record → **"Thailand (V) áp đảo cặp này (67%)"**.
- n=3 lead scenario → **"— mẫu quá ít, chỉ tham khảo"**.

### Algeria (S) vs Senegal (S) — 1 meeting (very-thin softening must fire)
```
SUMMARY : Algeria (S) áp đảo cặp này (100%) · Algeria (S) nhỉnh hơn ở hiệp 2
          — chỉ tham khảo.                                       ← chỉ tham khảo
B1 hoà : Khi H1 hoà nhau, Algeria (S) gần như luôn thắng (100%); H2 thêm TB 1 bàn,
         cả trận thường ít bàn (TB 1) — mẫu quá ít, chỉ tham khảo. (n=1 · chỉ tham khảo)
B2 SEN : Chưa gặp tình huống này.
B3 ALG : Chưa gặp tình huống này.
B4 H2  : Nhìn chung H2: TB 1 bàn/H2; Algeria (S) gần như chắc ghi bàn ở H2
         (100% vs 0%); hay đảo cục diện (1/1 trận).
```
- Every line carries **"chỉ tham khảo"** (n=1); the two empty lead scenarios fall back
  to "Chưa gặp tình huống này." — no `NaN`/`undefined`, no hard claim on n=1.
