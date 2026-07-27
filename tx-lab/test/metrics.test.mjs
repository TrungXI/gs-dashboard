// metrics.test.mjs — money-fitness math (evLB) + Wilson sanity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evLowerBound, computeMetrics, wilsonLowerBound } from '../metrics.mjs';

test('evLowerBound: mean, sample-sd (n-1), and lower bound', () => {
  const bets = [1, -1, 1, -1].map((pnl) => ({ pnl }));
  const mean = 0; // (1-1+1-1)/4
  const { evLB, evMean, evSd } = evLowerBound(bets, mean, 4, 1.96);
  assert.equal(evMean, 0);
  // sample variance = sum((x-0)^2)/(n-1) = 4/3 -> sd = sqrt(4/3)
  assert.ok(Math.abs(evSd - Math.sqrt(4 / 3)) < 1e-9);
  const se = Math.sqrt(4 / 3) / Math.sqrt(4);
  assert.ok(Math.abs(evLB - (0 - 1.96 * se)) < 1e-9);
  // a symmetric coin flip must have a NEGATIVE evLB (uncertainty penalty).
  assert.ok(evLB < 0);
});

test('evLowerBound: constant positive pnl -> sd 0 -> evLB == mean', () => {
  const bets = [0.5, 0.5, 0.5].map((pnl) => ({ pnl }));
  const { evLB, evSd } = evLowerBound(bets, 0.5, 3, 1.96);
  assert.equal(evSd, 0);
  assert.equal(evLB, 0.5);
});

test('computeMetrics: high hit-rate + tiny payouts = wilsonLB loves it, money hates it', () => {
  // The exact Gen-1 trap, at realistic n: 75 tiny-payout wins (+0.35) + 25 full
  // losses (-1). Hit-rate 75% -> wilsonLB clears 0.5; but ev is NEGATIVE.
  const bets = [];
  let t = 0;
  for (let i = 0; i < 75; i++) bets.push({ result: 'win', pnl: 0.3, recordedAt: new Date(++t), matchDate: 'd1' });
  for (let i = 0; i < 25; i++) bets.push({ result: 'lose', pnl: -1, recordedAt: new Date(++t), matchDate: 'd1' });
  const m = computeMetrics(bets);
  assert.equal(m.n, 100);
  assert.ok(m.wilsonLB > 0.5, `hit-rate looks great to wilsonLB (got ${m.wilsonLB})`);
  assert.ok(m.ev < 0, `but the money is negative (ev=${m.ev})`);
  assert.ok(m.evLB < m.ev, 'evLB sits below the mean ev (uncertainty penalty)');
  assert.equal(m.evMean, m.ev);
  // This is the whole point of the money fitness: rank by evLB, not wilsonLB.
});

test('wilsonLowerBound penalizes tiny samples at equal hit-rate', () => {
  // Same 80% hit-rate, different n: the larger sample must score higher (the
  // penalty is on sample size, not on the point estimate).
  const small = wilsonLowerBound(4, 5, 1.96); // 4/5 = 80%
  const big = wilsonLowerBound(80, 100, 1.96); // 80/100 = 80%
  assert.ok(big > small, '80% over 100 beats 80% over 5 on the lower bound');
  // And the LB is always below the point estimate.
  assert.ok(big < 0.8 && small < 0.8);
});
