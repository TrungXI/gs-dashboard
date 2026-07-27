// malay.test.mjs — Malay parse + de-vig cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMalay,
  malayToDecimal,
  impliedProbFromMalayPair,
} from '../malay.mjs';

test('parseMalay handles text, number, null, junk', () => {
  assert.equal(parseMalay('0.85'), 0.85);
  assert.equal(parseMalay('-0.52'), -0.52);
  assert.equal(parseMalay(0.9), 0.9);
  assert.equal(parseMalay(null), null);
  assert.equal(parseMalay(undefined), null);
  assert.equal(parseMalay(''), null);
  assert.equal(parseMalay('null'), null);
  assert.equal(parseMalay('abc'), null);
  // clamp to Malay band
  assert.equal(parseMalay('1.5'), 1);
  assert.equal(parseMalay('-2'), -1);
});

test('malayToDecimal both signs', () => {
  assert.equal(malayToDecimal(0.85), 1.85);
  assert.equal(malayToDecimal(0), 1);
  assert.ok(Math.abs(malayToDecimal(-0.5) - 3) < 1e-9); // 1 + 1/0.5
  assert.ok(Math.abs(malayToDecimal(-0.8) - 2.25) < 1e-9); // 1 + 1/0.8
});

test('impliedProbFromMalayPair de-vigs to sum 1', () => {
  const p = impliedProbFromMalayPair('0.85', '0.85');
  assert.ok(p !== null);
  assert.ok(Math.abs(p.pTai + p.pXiu - 1) < 1e-9);
  // symmetric prices -> ~50/50
  assert.ok(Math.abs(p.pTai - 0.5) < 1e-9);

  // asymmetric: lower over price (0.5) => lower payout => HIGHER implied
  // prob for Tai than the higher-priced under (0.9).
  const q = impliedProbFromMalayPair('0.5', '0.9');
  assert.ok(q.pTai > q.pXiu);

  assert.equal(impliedProbFromMalayPair(null, '0.9'), null);
  assert.equal(impliedProbFromMalayPair('0.9', 'null'), null);
});
