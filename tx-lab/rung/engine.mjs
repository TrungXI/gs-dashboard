// engine.mjs — bản sao nguyên văn engine chấm của bot. KHÔNG sửa.
// Malay odds: m ∈ [-1,1]. m >= 0 -> stake 1 ăn m. m < 0 -> stake |m| ăn 1.

export function gradeOne(side, line, total) {
  if (side !== 'tai') throw new Error('harness chỉ đánh Over (tai)');
  if (total > line) return 'win';
  if (Number.isInteger(line) && total === line) return 'push';
  return 'lose';
}

export function unitPnl(result, m) {
  if (result === 'push') return 0;
  if (result === 'win') return m >= 0 ? m : 1;
  return m >= 0 ? -1 : m; // lose
}

export function gradeLeg(side, line, m, total) {
  const isQuarter = Math.abs(line * 2 - Math.round(line * 2)) > 1e-9;
  if (!isQuarter) {
    const r = gradeOne(side, line, total);
    return { result: r, pnl: unitPnl(r, m) };
  }
  const rA = gradeOne(side, line - 0.25, total);
  const rB = gradeOne(side, line + 0.25, total);
  return {
    result: `${rA}/${rB}`,
    pnl: 0.5 * unitPnl(rA, m) + 0.5 * unitPnl(rB, m),
  };
}

// ---------------------------------------------------------------------------
// Fast path — allocation-free PnL, used ONLY inside the shuffle null loop
// (§6.4 chấm lại 1.2M lệnh × 200 lần; gradeLeg cấp phát 1 object/lệnh nên
// không chịu nổi tải đó). Nó KHÔNG phải engine thứ hai: test/engine.test.mjs
// khoá `pnlOf ≡ gradeLeg().pnl` trên toàn bộ lưới oracle, lệch bất kỳ ô nào là FAIL.
export function pnlOf(line, m, total) {
  const isQuarter = Math.abs(line * 2 - Math.round(line * 2)) > 1e-9;
  if (!isQuarter) {
    return unitPnl(gradeOne('tai', line, total), m);
  }
  return (
    0.5 * unitPnl(gradeOne('tai', line - 0.25, total), m) +
    0.5 * unitPnl(gradeOne('tai', line + 0.25, total), m)
  );
}

// Tách chuỗi result của gradeLeg thành phần thắng / phần hoà, để tính
// winRate = (win + 0.5×halfWin) / (n − push) mà không phải sửa gradeLeg.
export function resultShares(result) {
  if (result.includes('/')) {
    const [a, b] = result.split('/');
    return {
      win: (a === 'win' ? 0.5 : 0) + (b === 'win' ? 0.5 : 0),
      push: (a === 'push' ? 0.5 : 0) + (b === 'push' ? 0.5 : 0),
    };
  }
  return { win: result === 'win' ? 1 : 0, push: result === 'push' ? 1 : 0 };
}
