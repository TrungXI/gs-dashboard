// engine.test.mjs — parity gate (§4). Hai engine viết ĐỘC LẬP:
//   rung/engine.mjs  — chép nguyên văn gradeLeg của bot (tách quarter ở line±0.25)
//   tx-lab/settle.mjs — mô hình 5-way của tx-lab (tách .25 -> ⌊L⌋/⌊L⌋+0.5, .75 -> ⌊L⌋+0.5/⌊L⌋+1)
// Khớp nhau trên toàn bộ lưới oracle là bằng chứng cả hai đúng. Lệch bất kỳ ô nào
// ⇒ FAIL, dừng trước khi chạy backtest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeLeg, pnlOf, resultShares } from '../engine.mjs';
import { settle } from '../../settle.mjs';

const LINES = [0.5, 1, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5];
const TOTALS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const PRICES = [-0.95, -0.5, 0.05, 0.5, 0.95];

test('gradeLeg ≡ settle trên toàn bộ lưới oracle', () => {
  let n = 0;
  for (const line of LINES) {
    for (const total of TOTALS) {
      for (const m of PRICES) {
        const a = gradeLeg('tai', line, m, total).pnl;
        const b = settle('tai', line, m, total).pnl;
        assert.ok(
          Math.abs(a - b) < 1e-9,
          `line=${line} total=${total} m=${m}: gradeLeg=${a} settle=${b}`,
        );
        n++;
      }
    }
  }
  assert.equal(n, LINES.length * TOTALS.length * PRICES.length);
});

test('pnlOf (fast path dùng trong shuffle) ≡ gradeLeg', () => {
  for (const line of LINES) {
    for (const total of TOTALS) {
      for (const m of PRICES) {
        assert.ok(
          Math.abs(pnlOf(line, m, total) - gradeLeg('tai', line, m, total).pnl) < 1e-12,
          `line=${line} total=${total} m=${m}`,
        );
      }
    }
  }
});

test('resultShares tách đúng win/push của line quarter', () => {
  assert.deepEqual(resultShares('win'), { win: 1, push: 0 });
  assert.deepEqual(resultShares('push'), { win: 0, push: 1 });
  assert.deepEqual(resultShares('lose'), { win: 0, push: 0 });
  assert.deepEqual(resultShares('win/push'), { win: 0.5, push: 0.5 });
  assert.deepEqual(resultShares('lose/lose'), { win: 0, push: 0 });
});

test('chỉ đánh Over — side khác phải ném lỗi', () => {
  assert.throws(() => gradeLeg('xiu', 2.5, 0.9, 3));
});
