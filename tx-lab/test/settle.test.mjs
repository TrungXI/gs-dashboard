// settle.test.mjs — encodes ALL 20 oracle rows from
// research/settlement-oracle.md §"Test cases". This is the binding contract:
// every row must match result AND pnl (to 3 decimals). node:test + node:assert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, ouResult, malayPnl } from '../settle.mjs';

// (side, line, price, finalTotal) -> (result, pnl)
const ORACLE = [
  ['tai', 0.75, 0.73, 0, 'lose', -1],
  ['tai', 1, 0.73, 1, 'push', 0],
  ['tai', 1.75, 0.71, 2, 'half-win', 0.355],
  ['tai', 2.25, 0.85, 2, 'half-lose', -0.5],
  ['tai', 1, 0.72, 2, 'win', 0.72],
  ['tai', 2.5, -0.33, 2, 'lose', -0.33],
  ['tai', 4.5, -0.5, 4, 'lose', -0.5],
  ['tai', 0.75, 0.76, 1, 'half-win', 0.38],
  ['xiu', 2.25, 0.8, 1, 'win', 0.8],
  ['xiu', 1.75, 0.8, 2, 'half-lose', -0.5],
  ['tai', 3.5, 0.75, 4, 'win', 0.75],
  ['tai', 1.5, 0.72, 1, 'lose', -1],
  ['tai', 1.75, 0.75, 2, 'half-win', 0.375],
  ['tai', 1.25, 0.73, 1, 'half-lose', -0.5],
  ['tai', 1.5, -0.57, 1, 'lose', -0.57],
  ['tai', 1, -0.89, 2, 'win', 1],
  ['xiu', 7.5, 0.71, 9, 'lose', -1],
  ['tai', 3.25, 0.83, 2, 'lose', -1],
  ['tai', 2.75, 0.74, 3, 'half-win', 0.37],
  ['tai', 0.75, 0.95, 1, 'half-win', 0.475],
];

test('settle matches the settlement oracle exactly (20 rows)', () => {
  assert.equal(ORACLE.length, 20, 'oracle must have 20 rows');
  for (const [side, line, price, finalTotal, wantResult, wantPnl] of ORACLE) {
    const { result, pnl } = settle(side, line, price, finalTotal);
    const label = `${side} | ${line} | ${price} | ${finalTotal}`;
    assert.equal(result, wantResult, `result mismatch for ${label}`);
    assert.ok(
      Math.abs(pnl - wantPnl) < 5e-4,
      `pnl mismatch for ${label}: got ${pnl}, want ${wantPnl}`,
    );
  }
});

test('whole-line push semantics', () => {
  assert.equal(ouResult('tai', 2, 2), 'push');
  assert.equal(ouResult('xiu', 2, 2), 'push');
  assert.equal(ouResult('tai', 2, 3), 'win');
  assert.equal(ouResult('xiu', 2, 3), 'lose');
});

test('half-line never pushes', () => {
  assert.equal(ouResult('tai', 2.5, 2), 'lose');
  assert.equal(ouResult('xiu', 2.5, 2), 'win');
});

test('malay negative-price payouts', () => {
  assert.equal(malayPnl('win', -0.5), 1);
  assert.equal(malayPnl('lose', -0.5), -0.5);
  assert.equal(malayPnl('half-win', -0.5), 0.5);
  assert.equal(malayPnl('half-lose', -0.5), -0.25);
});
