# tx-lab — TX-Evolution Harness (Phase 0 Backtest)

Self-contained Node backtest + genetic-evolution harness for **Tài/Xỉu live**
(16p / 20p fast markets). It replays historical `match_odds_log` snapshots as
entry opportunities, runs a population of strategy individuals, settles bets
against a ground-truth oracle, scores by **Wilson lower-bound on break-even
rate**, and evolves the population across generations on a time-based train
split — then validates the champion **out-of-sample on a holdout split**.

**This is not part of the Next.js app.** It never imports from `src/`, never
writes to any DB table, never touches `gs_tx_paper`, never sends Telegram, and
uses no real money. Read-only on `match_odds_log`.

## Run

```bash
# tests (settlement oracle 20/20, malay parse, anti-look-ahead)
npm run tx:test
#   equivalent: node --test 'tx-lab/test/*.test.mjs'

# full backtest + evolution against the real analysis DB
npm run tx:run
#   equivalent: node tx-lab/run.mjs
```

`tx:run` reads `ANALYSIS_DATABASE_URL` from `.env.local` (repo root). It is
deterministic: two runs at the same `config.SEED` produce an identical
`results/champion.json`.

> Note: the Node test runner discovers files via the glob
> `'tx-lab/test/*.test.mjs'`. `node --test tx-lab/test` (bare dir) is treated by
> Node as a single module path, not a discovery root — use the glob form, which
> is what `npm run tx:test` does.

## Output (`tx-lab/results/`, gitignored)

- `gen-XX.json` — full ranked population + metadata per generation.
- `champion.json` — final champion `{familyId, params, train, holdout, verdict}`.
- `report.md` — split dates, GA config, the `ev_train(g)` "PnL up over time"
  series, champion train-vs-holdout metrics, and the **honest verdict**.

### Verdict (honesty clause)

The report prints exactly one of:

- `EDGE CANDIDATE: <family> — ...` when the champion clears every holdout gate
  (`ev > 0`, `wilsonLB > 0.5`, `n >= MIN_BETS_HOLDOUT`), the ev_train curve is
  non-decreasing, and no `randomExplorer` topped the holdout board; **or**
- `NO DURABLE EDGE FOUND. ... These numbers are noise, not signal.` otherwise.

A loud `WARNING: noise baseline (randomExplorer) survived ...` is added if the
noise family ranked in the holdout top-`ELITE_K`. The report reflects the FIRST
full run at `config.SEED` — no smoothing, no re-seeding for a nicer curve.

## Fitness

Two modes, set by `config.FITNESS` (default **`money`**; override with
`FITNESS=winfreq node tx-lab/run.mjs`):

- **`money`** (default) — rank by **`evLB`**: the 95% lower confidence bound on
  EV per bet (`mean − Z·se` over the per-bet PnL distribution). This optimizes
  actual money. A strategy that wins bets often but at tiny Malay payouts (and
  bleeds cash) gets a negative `evLB` and cannot win the GA. **Confidence gate
  on holdout = `evLB > 0`.**
- **`winfreq`** (legacy) — rank by **`wilsonLB`**: the Wilson 95% lower-bound on
  the break-even hit-rate. This is the DECEPTIVE fitness — it is blind to payout
  size, so it climbs toward high bet-win frequency even while losing money.
  Kept only for comparison. Confidence gate = `wilsonLB > 0.5`.

Both modes always apply the hard money gate `ev > 0` on holdout, and neither
ranks by raw `winRate`. Champions must additionally clear `MIN_BETS` (default
100 — the "đủ 100 kèo" gate).

**Diversity cap.** `config.MAX_ELITE_PER_FAMILY` (default 3) limits how many
individuals of the same family may enter the elite/breeding set each generation,
preventing the board from collapsing onto a single family.

**Open-only realism.** Entry opportunities are gated on `betting_open === true`
— when the book is locked (~68% of snapshots overall, ~88% right on a goal) the
live bot cannot bet, so the backtest doesn't either. Only ENTRY is gated:
`context.history` and priors still read locked rows (the bot can see a locked
line for drift, it just can't act on it). The report prints how many snapshots
were dropped as locked so the tradeable universe is transparent.

**Family sets (`config.GEN_FAMILY_SET`).** `'G'` (default) runs the open-only
generation-G families (G1–G8, each targeting rich OPEN marks — `kickoff_h2` /
`first_seen` — and PASSing elsewhere), `'F'` runs the legacy in-play families
(F1–F12), `'ALL'` runs both. All sets always include `randomExplorer` as the
noise baseline. Override per-run: `GEN_FAMILY_SET=F node tx-lab/run.mjs`.

**H1→final prior (`priors.h1ToH2`).** Leak-free, learned at runtime (never
hardcoded): for each H1-total bucket {0..6,7+} it accumulates prior-dated
events' final-total histograms (`expFinal(h1Total)`, `pOverFinal(h1Total,line)`).
`context.h1Total` is set ONLY when H1 has closed (`kickoff_h2` or any H2
snapshot), derived from the H1 score — never from `finalTotal`. `context.leagueTag`
(matchType + (S)/(V) variant) is a leak-free prior key carrying no hardcoded value.

## Files

| File | Role |
|---|---|
| `config.mjs` | all knobs (seed, split, GA params, gates) |
| `db.mjs` | single read-only query, then close |
| `dataset.mjs` | rows → events, split, **leak-free priors** |
| `context.mjs` | EntryContext builder (**anti-look-ahead**) |
| `malay.mjs` | Malay odds parse + de-vig |
| `settle.mjs` | OU Asian settlement + Malay PnL (**oracle-exact**) |
| `metrics.mjs` | n, winRate, PnL, ev, Wilson-LB, maxDD, pnlByBucket |
| `rng.mjs` | seeded PRNG (mulberry32) |
| `strategies/*` | 12 families F1–F12 (each pure, each "why not old rule") |
| `evolve.mjs` | GA population + generations |
| `report.mjs` | console + JSON + markdown + verdict |
| `run.mjs` | CLI entrypoint |

## Strategy families (F1–F12)

F1 lineDrift · F2 poissonRemaining · F3 impliedVsBaserate · F4 shockReaction ·
F5 baserateReversion · F6 earlyGoalTempo · F7 h2hLateGoal · F8 oddsOscillation ·
F9 neededGoalsPressure · F10 metaConsensus · **F11 randomExplorer (noise
baseline)** · F12 lineValueBand. None reuse the old v1/v3/v6/v7 rules — each
file's header states why it is a genuinely distinct signal.
