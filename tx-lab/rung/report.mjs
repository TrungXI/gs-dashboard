// report.mjs — in khối 0 + T1..T9 theo đúng thứ tự §8. Cùng nội dung ra stdout
// và results/report-<league>.md.
import { config, gapLabel, pmaxLabel } from './config.mjs';
import { comboLabel } from './families.mjs';

const P = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : 'n/a');
const U = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const E = (x) => (Number.isFinite(x) ? x.toFixed(4) : 'n/a');
const N = (x) => (Number.isFinite(x) ? String(Math.round(x)) : 'n/a');

const MULTIPLE_TESTING_WARNING = (combos, opps) =>
  `> Đã thử ${combos.toLocaleString('en-US')} tổ hợp trên tối đa ${opps.toLocaleString('en-US')} ` +
  `cơ hội nửa-trận (≈${(combos / Math.max(1, opps)).toFixed(0)} tổ hợp / 1 quan sát). ` +
  `Ở mật độ này ô tốt nhất của lưới CHẮC CHẮN đẹp do ngẫu nhiên. Hiệu chỉnh kiểu Bonferroni ` +
  `là vô nghĩa ở đây. Bằng chứng duy nhất được chấp nhận là kiểm định grid-max shuffle (§6.4) ` +
  `+ cao nguyên (§6.2) + out-of-sample (§6.1).`;

const SHUFFLE_FAIL_TEXT =
  '> Ô tốt nhất của lưới KHÔNG vượt được mức tốt nhất mà cùng lưới đó đạt được trên dữ liệu ' +
  'đã xáo. Đây là nhiễu do quét nhiều tổ hợp, không phải edge.';

function table(head, rows) {
  const out = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  return out.join('\n');
}

function specCols(s) {
  if (s.family === 'A') return [s.family, s.X, s.Y, '', s.PMIN, pmaxLabel(s.PMAX), gapLabel(s.GAP), s.half];
  if (s.family === 'B') return [s.family, s.X, s.Y0, s.D, s.PMIN, pmaxLabel(s.PMAX), gapLabel(s.GAP), s.half];
  if (s.family === 'C') return [s.family, s.K, s.Y, '', s.PMIN, pmaxLabel(s.PMAX), gapLabel(s.GAP), s.half];
  return [s.family, '', s.Y ?? '', '', '', '', gapLabel(s.GAP), s.half];
}

// ---------------------------------------------------------------------------
export function renderReport(c) {
  const L = [];
  const { ds, champ } = c;

  // ---- Khối 0 --------------------------------------------------------------
  const openOpps = countOpenOpportunities(ds);
  L.push(`# Backtest "kèo rung" — league ${config.LEAGUE} (${ds.matchType})`);
  L.push('');
  L.push(
    table(
      ['tham số', 'giá trị'],
      [
        ['league / match_type', `${config.LEAGUE} / ${ds.matchType}`],
        ['khoảng ngày', `${ds.days[0] ?? '?'} → ${ds.days[ds.days.length - 1] ?? '?'} (${ds.days.length} ngày)`],
        ['events (có tick, period 2/8)', ds.joinCoverage.events],
        ['units (event × hiệp)', ds.nUnits],
        ['units không có kết quả FT/HT', ds.joinCoverage.noResultUnits],
        ['seed', config.SEED],
        ['RUNG_SHUFFLES', config.SHUFFLES],
        ['RUNG_MINUTE_TOL', config.MINUTE_TOL],
        ['RUNG_MIN_BETS', config.MIN_BETS],
        ['**tổ hợp đã quét (đếm tại runtime)**', `**${c.comboCount.toLocaleString('en-US')}**`],
        ['tổng lệnh sinh ra trên toàn lưới', c.betCount.toLocaleString('en-US')],
        ['trần cơ hội nửa-trận (tick mở trong 32–36)', openOpps.total],
      ],
    ),
  );
  L.push('');
  L.push(MULTIPLE_TESTING_WARNING(c.comboCount, openOpps.total));
  L.push('');

  // ---- T1 ------------------------------------------------------------------
  L.push('## T1 — Kiểm kê dữ liệu');
  L.push('');
  L.push(
    table(
      ['league', 'match_type', 'is_h2', 'ticks', 'events', 'min(minute)', 'max(minute)'],
      ds.inventory.map((r) => [
        r.league_id,
        r.match_type,
        r.is_h2,
        r.ticks,
        r.events,
        r.min_minute,
        r.max_minute,
      ]),
    ),
  );
  L.push('');
  const cov = ds.joinCoverage.joined / Math.max(1, ds.joinCoverage.events);
  L.push(
    table(
      ['chỉ số', 'giá trị', 'SPEC §1', 'lệch'],
      [
        [
          'độ phủ join gs_matches_history',
          `${ds.joinCoverage.joined}/${ds.joinCoverage.events} = ${P(cov)}`,
          config.LEAGUE === 1508 ? '97.6%' : '—',
          config.LEAGUE === 1508 ? flag(cov, 0.976) : '—',
        ],
        ['bàn TB H1', U(avgFinal(ds, 'H1')), config.LEAGUE === 1508 ? '1.679' : '—', config.LEAGUE === 1508 ? flag(avgFinal(ds, 'H1'), 1.679) : '—'],
        ['bàn TB FT', U(avgFinal(ds, 'H2')), config.LEAGUE === 1508 ? '3.369' : '—', config.LEAGUE === 1508 ? flag(avgFinal(ds, 'H2'), 3.369) : '—'],
        ['cột phẳng ≡ ladder[0] (FT)', P(rate(ds.ladderAssert.ft_match, ds.ladderAssert.ft_have)), '≥99%', ''],
        ['cột phẳng ≡ ladder[0] (H1)', P(rate(ds.ladderAssert.h1_match, ds.ladderAssert.h1_have)), '≥99%', ''],
      ],
    ),
  );
  L.push('');
  L.push(
    table(
      ['ngày (VN)', 'units', 'events'],
      ds.days.map((d) => {
        const us = ds.units.filter((u) => u.day === d);
        return [d, us.length, new Set(us.map((u) => u.eventId)).size];
      }),
    ),
  );
  L.push('');

  // ---- T2 ------------------------------------------------------------------
  L.push('## T2 — Funnel gate');
  L.push('');
  L.push('E1 = V.Bot 14 bê nguyên (X=29, Y=34, PMIN=0.70, PMAX=∞, gap PREFER_05).');
  L.push('');
  const funnelRows = [];
  for (const half of config.HALVES) funnelRows.push(funnelRow(`E1 ${half}`, c.E1[half].funnel));
  for (const half of config.HALVES) funnelRows.push(funnelRow(`E1b-bot ${half}`, c.E1b[half].funnel));
  if (champ) funnelRows.push(funnelRow(`ỨNG VIÊN ${champ.spec.half}`, champ.funnel));
  L.push(
    table(
      ['luật', 'units', 'có tick cắm cờ', 'tick cắm cờ mở', 'qua gate giá', 'không có bàn X→Y', 'tick vào mở', 'ladder có nấc', 'có kết quả', 'LỆNH'],
      funnelRows,
    ),
  );
  L.push('');
  L.push(
    '`E1b-bot` = cùng tham số nhưng dùng gate NGUYÊN VĂN của bot (`hasUnderOK`: quét cả mảng, so thô `under >= 0.70`, ' +
      'không chuẩn hoá giá âm). Chênh lệch giữa hai dòng chính là tác động của quy ước `xiuScore` ở SPEC §3.6.',
  );
  L.push('');

  // ---- T2b -----------------------------------------------------------------
  L.push('## T2b — Availability ladder + tác động quy ước giá âm');
  L.push('');
  L.push(
    table(
      ['phút', 'H1 tick mở', 'H1 gap .5', 'H1 gap .75', 'H1 không nấc', 'H2 tick mở', 'H2 gap .5', 'H2 gap .75', 'H2 không nấc'],
      c.avail.map((r) => [
        r.minute,
        r.H1.open,
        r.H1.g05,
        r.H1.g075,
        r.H1.other,
        r.H2.open,
        r.H2.g05,
        r.H2.g075,
        r.H2.other,
      ]),
    ),
  );
  L.push('');
  const gh = ds.gapHist;
  const allGaps = [...new Set([...gh.H1.keys(), ...gh.H2.keys()])].sort((a, b) => a - b);
  L.push('Phân bố gap trên ladder `raw` (phút 25–43, tick mở, nấc không treo):');
  L.push('');
  const unitCeil = (g) => (gh.units.get(g) ? gh.units.get(g).size : 0);
  L.push(
    table(
      ['gap', 'H1 (ouH1Lines)', 'H2 (ouLines)', 'trần n (units có nấc này, phút 30–42)'],
      allGaps.map((g) => [g, gh.H1.get(g) ?? 0, gh.H2.get(g) ?? 0, unitCeil(g)]),
    ),
  );
  L.push('');
  const g1h1 = gh.H1.get(1) ?? 0;
  const g1h2 = gh.H2.get(1) ?? 0;
  const g1ceil = unitCeil(1);
  L.push(
    `**Gap 1.0 đo lại được ${g1h1} nấc H1 / ${g1h2} nấc H2** (SPEC §1.3 đo ra 1 — cửa sổ phút khác nhau). ` +
      `Trần n của nó vẫn chỉ **${g1ceil} unit** trong cửa sổ vào lệnh, ` +
      `${g1ceil < config.MIN_BETS ? `dưới ngưỡng n ≥ ${config.MIN_BETS}` : `so với ${unitCeil(0.5)} unit của gap 0.5`}` +
      ` ⇒ **không có tổ hợp gap-1.0 nào có thể qua cổng 7.1**, giữ nguyên quyết định loại khỏi grid (§10.2).`,
  );
  L.push('');
  L.push(
    `Số lệnh của ứng viên có giá gate ÂM (được cứu nhờ \`xiuScore\` §3.6, thay vì bị so thô loại nhầm): **${c.negGateBets}**.`,
  );
  L.push('');

  // ---- T3 ------------------------------------------------------------------
  L.push('## T3 — Baseline / control (họ E)');
  L.push('');
  L.push('### E1 — V.Bot 14 bê nguyên sang giải này');
  L.push('');
  L.push(
    table(
      ['biến thể', 'hiệp', 'n', 'roi', 'winRate', 'evLB', 'mdd (u)', 'pnl (u)', 'lệnh/ngày', 'roiEarly', 'roiLate'],
      [
        ...config.HALVES.map((h) => ['E1 (gate SPEC)', h, ...mrow(c.E1[h].m)]),
        ...config.HALVES.map((h) => ['E1b (gate bot)', h, ...mrow(c.E1b[h].m)]),
      ],
    ),
  );
  L.push('');
  L.push('### E2 — vô điều kiện (ĐỐI CHỨNG QUYẾT ĐỊNH, §7.7)');
  L.push('');
  L.push(
    table(
      ['hiệp', 'Y', 'gap', 'n', 'roi', 'winRate', 'evLB', 'mdd (u)', 'pnl (u)', 'lệnh/ngày', 'roiEarly', 'roiLate'],
      c.e2Rows.map((r) => [r.half, r.Y, gapLabel(r.GAP), ...mrow(r)]),
    ),
  );
  L.push('');
  L.push('### E3 — ngẫu nhiên (tick mở bất kỳ trong cửa sổ, gap PREFER_05, trung bình ' + config.E3_REPS + ' lần)');
  L.push('');
  L.push(
    table(
      ['hiệp', 'n TB', 'roi', 'winRate', 'evLB', 'mdd (u)', 'lệnh/ngày'],
      c.e3Rows.map((r) => [r.half, N(r.n), P(r.roi), P(r.winRate), E(r.evLB), U(r.mdd), U(r.betsPerDay)]),
    ),
  );
  L.push('');

  // ---- T4 ------------------------------------------------------------------
  L.push('## T4 — Top 20 mỗi họ');
  L.push('');
  L.push(
    'Sắp theo **số cổng đạt** (giảm dần) rồi `evLB` — KHÔNG sắp theo ROI. ' +
      '`GATES` = 8 ký tự ứng với cổng 7.1…7.8 (`?` = chưa chạy prior chéo cho ô đó).',
  );
  L.push('');
  for (const [f, rows] of c.topByFamily) {
    L.push(`### Họ ${f}`);
    L.push('');
    L.push(
      table(
        ['fam', 'X/K', 'Y/Y0', 'D', 'PMIN', 'PMAX', 'GAP', 'hiệp', 'n', 'roi', 'winRate', 'evLB', 'mdd', 'pnl', 'l/ngày', 'roiEarly', 'roiLate', 'GATES'],
        rows.map((r) => [...specCols(r.spec), ...mrow(r.m), r.gate]),
      ),
    );
    L.push('');
  }

  // ---- T4b -----------------------------------------------------------------
  L.push('## T4b — Độ bền theo dung sai phút (TOL)');
  L.push('');
  if (c.tolRows.length) {
    L.push(
      table(
        ['TOL', 'ứng viên n', 'ứng viên roi', 'ứng viên evLB', 'ô tốt nhất TOÀN LƯỚI (roi)', 'ô đó là'],
        c.tolRows.map((r) => [
          r.tol,
          r.champ.n,
          P(r.champ.roi),
          E(r.champ.evLB),
          P(r.gridBestRoi),
          r.gridBestLabel,
        ]),
      ),
    );
    L.push('');
    L.push(
      `Biên độ ROI của ứng viên giữa 3 mức TOL = **${P(c.tolSpread)}** ` +
        `(ngưỡng ${P(config.FRAGILE_TOL_SPREAD)}) ⇒ ${c.fragileTol ? '**FRAGILE_TOL — hạ nhãn**' : 'không fragile'}.`,
    );
  } else {
    L.push('_không có ứng viên để đo._');
  }
  L.push('');

  // ---- T5 ------------------------------------------------------------------
  L.push('## T5 — Bản đồ nhiệt cao nguyên');
  L.push('');
  if (champ && c.heat) {
    const s = champ.spec;
    L.push(
      `Lưới ROI theo (${c.heat.rowLabel}, ${c.heat.colLabel}) tại PMIN=${s.PMIN}, PMAX=${pmaxLabel(s.PMAX)}, ` +
        `gap=${gapLabel(s.GAP)}, hiệp=${s.half}. Ô \`n < ${config.WEAK_MIN_BETS}\` in \`·\`.`,
    );
    L.push('');
    L.push('```');
    L.push(`${c.heat.rowLabel.padStart(4)} | ` + c.heat.cols.map((y) => String(y).padStart(8)).join(''));
    L.push(`${'-'.repeat(5)}+${'-'.repeat(8 * c.heat.cols.length)}`);
    for (const r of c.heat.rows) {
      const cells = r.cells.map((m) =>
        m == null || m.n < config.WEAK_MIN_BETS ? '·'.padStart(8) : `${(m.roi * 100).toFixed(1)}`.padStart(8),
      );
      L.push(`${String(r.key).padStart(4)} | ${cells.join('')}`);
    }
    L.push('');
    L.push('n mỗi ô:');
    L.push(`${c.heat.rowLabel.padStart(4)} | ` + c.heat.cols.map((y) => String(y).padStart(6)).join(''));
    for (const r of c.heat.rows) {
      L.push(
        `${String(r.key).padStart(4)} | ` +
          r.cells.map((m) => (m == null ? '-' : String(m.n)).padStart(6)).join(''),
      );
    }
    L.push('```');
    L.push('');
    const p = champ.plat;
    L.push(
      table(
        ['điều kiện cao nguyên §6.2', 'đo được', 'ngưỡng', 'kết quả'],
        [
          ['1. hàng xóm (X,Y) có ROI > 0', `${p.positive}/8`, `≥ ${config.GATE_PLATEAU_MIN_POS}/8`, p.c1 ? 'ĐẠT' : 'TRƯỢT'],
          [
            '2. median ROI hàng xóm',
            P(p.medianNb),
            `≥ ${config.GATE_PLATEAU_MEDIAN_FRAC} × ${P(p.center)} = ${P(config.GATE_PLATEAU_MEDIAN_FRAC * p.center)}`,
            p.c2 ? 'ĐẠT' : 'TRƯỢT',
          ],
          [
            '3. PMIN ± 0.05 đều > 0',
            p.pminNb.map((r) => (r == null ? 'ngoài lưới' : P(r))).join(' / '),
            'cả hai > 0',
            p.c3 ? 'ĐẠT' : 'TRƯỢT',
          ],
        ],
      ),
    );
  } else {
    L.push('_không có ứng viên._');
  }
  L.push('');

  // ---- T6 ------------------------------------------------------------------
  L.push('## T6 — Kiểm định grid-max shuffle (§6.4)');
  L.push('');
  L.push(
    table(
      ['họ', 'ô đủ n', 'maxROI quan sát', 'ô đó là', 'p50 null', 'p90', 'p95', 'p99', 'phân vị thực nghiệm', 'ĐẠT/TRƯỢT'],
      c.shuffleRows.map((r) => [
        r.family,
        r.eligible,
        P(r.obs),
        r.obsLabel,
        P(r.p50),
        P(r.p90),
        P(r.p95),
        P(r.p99),
        Number.isFinite(r.empirical) ? `${r.empirical.toFixed(1)}%` : 'n/a',
        r.pass ? '**ĐẠT**' : '**TRƯỢT**',
      ]),
    ),
  );
  L.push('');
  if (!c.shuffleRows.some((r) => r.pass)) {
    L.push(SHUFFLE_FAIL_TEXT);
    L.push('');
  }
  const expected = Math.round(c.eligible * 0.25);
  L.push(
    `Số tổ hợp (n ≥ ${config.MIN_BETS}) vượt cổng OOS §6.1: **${c.passOos} / ${c.eligible}** ` +
      `= ${P(c.eligible ? c.passOos / c.eligible : 0)}. Kỳ vọng ngẫu nhiên khi ROI kỳ vọng bằng 0 ≈ 25% ` +
      `(≈${expected} ô). ${
        c.eligible === 0
          ? ''
          : c.passOos <= expected * 1.25
            ? '⇒ **xấp xỉ mức ngẫu nhiên — tự nó là bằng chứng không có edge.**'
            : '⇒ cao hơn mức ngẫu nhiên, nhưng chưa đủ để kết luận (xem cổng shuffle ở trên).'
      }`,
  );
  L.push('');

  // ---- T7 ------------------------------------------------------------------
  L.push('## T7 — Kiểm định chéo (prior check §6.5)');
  L.push('');
  if (champ) {
    L.push(`Ứng viên: \`${champ.label}\` — **không tinh chỉnh lại tham số**, chỉ đổi league.`);
    L.push('');
    L.push(
      table(
        ['league', 'match_type', 'n', 'roi', 'winRate', 'evLB', 'mdd (u)', 'pnl (u)', 'l/ngày', 'roiEarly', 'roiLate'],
        [
          [config.LEAGUE, ds.matchType, ...mrow(champ.m)],
          ...champ.cross.map((x) => [x.league, x.matchType, ...mrow(x)]),
        ],
      ),
    );
    L.push('');
    const good = champ.cross.filter((x) => x.n >= config.MIN_BETS && x.roi > 0).length;
    L.push(
      `Dương ở **${good}/${champ.cross.length}** giải ngoài (với n ≥ ${config.MIN_BETS}) ⇒ độ tin cậy ` +
        `**${good === 2 ? 'CAO' : good === 1 ? 'TRUNG BÌNH' : 'THẤP'}**.` +
        (good === 0
          ? ' Luật chết ở cả hai giải đối chứng — trong đó 2140 là mẫu lớn nhất (868 trận). Đây là dấu hiệu XẤU.'
          : ''),
    );
  } else {
    L.push('_không có ứng viên._');
  }
  L.push('');

  // ---- T8 ------------------------------------------------------------------
  L.push('## T8 — PnL theo ngày của ứng viên');
  L.push('');
  if (c.byDay.length) {
    L.push(
      table(
        ['ngày', 'lệnh', 'pnl (u)', 'pnl luỹ kế (u)'],
        c.byDay.map((r) => [r.day, r.n, U(r.pnl), U(r.cum)]),
      ),
    );
  } else {
    L.push('_không có lệnh._');
  }
  L.push('');

  // ---- T9 ------------------------------------------------------------------
  L.push('## T9 — VERDICT');
  L.push('');
  L.push(`# ${c.verdict}`);
  L.push('');
  if (champ) {
    L.push(`Ô tốt nhất theo số cổng đạt: \`${champ.label}\``);
    L.push('');
    const m = champ.m;
    const g = champ.gate.list;
    L.push(
      table(
        ['#', 'cổng', 'đo được', 'ngưỡng', 'kết quả'],
        [
          ['7.1', 'cỡ mẫu', `n = ${m.n}`, `≥ ${config.MIN_BETS}`, mark(g[0])],
          ['7.2', 'out-of-sample', `early ${P(m.roiEarly)} (n=${m.nEarly}) / late ${P(m.roiLate)} (n=${m.nLate})`, 'cả hai > 0', mark(g[1])],
          ['7.3', 'cao nguyên', champ.plat ? `${champ.plat.positive}/8 dương, median ${P(champ.plat.medianNb)}` : 'n/a', '§6.2 đủ 3 điều kiện', mark(g[2])],
          ['7.4', 'grid-max shuffle', `roi ${P(m.roi)} vs p95 null ${P(champ.gate.p95)}`, '> p95', mark(g[3])],
          ['7.5', 'evLB', E(m.evLB), '> 0', mark(g[4])],
          ['7.6', 'drawdown', `mdd ${U(m.mdd)} vs pnl ${U(m.pnl)}`, 'mdd < pnl', mark(g[5])],
          ['7.7', 'thắng baseline E2', `roi ${P(m.roi)} vs E2 ${P(champ.e2roi)}`, `≥ E2 + ${P(config.GATE_BASELINE_MARGIN)}`, mark(g[6])],
          ['7.8', 'prior chéo', champ.cross.map((x) => `${x.league}: ${P(x.roi)} (n=${x.n})`).join(' · '), '≥1 giải dương với n ≥ 40', mark(g[7])],
        ],
      ),
    );
    L.push('');
    L.push('### §6.8 — cần thêm bao nhiêu ngày');
    L.push('');
    L.push(
      `Công thức SPEC (CI 95% của CHÍNH ô đó hẹp hơn |ROI|): sd/lệnh = **${U(m.sd)}**, ` +
        `lệnh/ngày = **${U(m.betsPerDay)}**, n hiện tại = **${m.n}** ⇒ n cần = ` +
        `**${Number.isFinite(champ.need.nNeeded) ? champ.need.nNeeded.toLocaleString('en-US') : '∞'}**, ` +
        `cần thêm ≈ **${Number.isFinite(champ.need.daysNeeded) ? champ.need.daysNeeded : '∞'} ngày**.`,
    );
    L.push('');
    if (Number.isFinite(champ.need.daysNeeded) && champ.need.daysNeeded === 0) {
      L.push(
        '⚠️ Con số 0 ngày này **không có nghĩa là đã đủ dữ liệu**. Nó chỉ nói CI của một ô ' +
          'được chọn TRƯỚC đã đủ hẹp. Ràng buộc thực sự đang chặn là cổng 7.4 (grid-max shuffle): ' +
          'ô này được chọn SAU khi nhìn cả lưới, nên phải so với phân bố cực trị của lưới, không phải CI của riêng nó.',
      );
      L.push('');
    }
    if (Number.isFinite(champ.gate.p95) && m.roi > 0) {
      // Biên độ null của grid-max co xấp xỉ theo 1/√n (cực trị của trung bình mẫu).
      // ⇒ n cần để p95(null) tụt xuống dưới ROI quan sát ≈ n × (p95/roi)².
      const nNull = Math.ceil(m.n * Math.pow(champ.gate.p95 / m.roi, 2));
      const dNull = m.betsPerDay > 0 ? Math.ceil(Math.max(0, nNull - m.n) / m.betsPerDay) : Infinity;
      L.push(
        `Ước lượng theo ràng buộc THỰC SỰ đang chặn (cổng 7.4): giả định biên độ null co theo ` +
          `1/√n, cần n ≈ **${nNull.toLocaleString('en-US')}** lệnh để p95 null (${P(champ.gate.p95)}) ` +
          `tụt xuống dưới ROI quan sát (${P(m.roi)}) ⇒ **cần thêm ≈ ${Number.isFinite(dNull) ? dNull : '∞'} ngày** ` +
          `ở nhịp ${U(m.betsPerDay)} lệnh/ngày. Đây là con số đáng dùng khi lập kế hoạch thu dữ liệu.`,
      );
      L.push('');
    }
  }

  if (c.verdict === 'INSUFFICIENT_DATA') {
    L.push('### Kết luận thẳng');
    L.push('');
    L.push(
      `Dữ liệu ${ds.days.length} ngày / ${ds.joinCoverage.events} trận của league ${config.LEAGUE} ` +
        '**chưa đủ** để phân biệt edge với nhiễu ở giải này.',
    );
    L.push('');
    if (c.paper) {
      L.push('### Bộ tham số tạm để chạy paper thu số');
      L.push('');
      L.push(`\`${c.paper.label}\``);
      L.push('');
      L.push(
        table(
          ['n', 'roi', 'winRate', 'evLB', 'mdd (u)', 'pnl (u)', 'l/ngày', 'roiEarly', 'roiLate', 'median ROI hàng xóm'],
          [[...mrow(c.paper.m), P(c.paper.medianNb)]],
        ),
      );
      L.push('');
      L.push(
        table(
          ['prior chéo', 'n', 'roi', 'winRate', 'evLB'],
          c.paper.cross.map((x) => [`${x.league} (${x.matchType})`, x.n, P(x.roi), P(x.winRate), E(x.evLB)]),
        ),
      );
      L.push('');
      L.push(
        '**Chọn theo độ bền hàng xóm, KHÔNG phải ROI đỉnh; mục đích là thu dữ liệu, không phải kiếm tiền.**',
      );
      const badPrior = c.paper.cross.filter((x) => x.n >= config.MIN_BETS && x.roi <= 0);
      if (badPrior.length || c.paper.m.evLB <= 0) {
        L.push('');
        L.push(
          '⚠️ Ô này vẫn mang các dấu hiệu xấu sau, phải đọc kèm: ' +
            [
              c.paper.m.evLB <= 0 ? `evLB = ${E(c.paper.m.evLB)} ≤ 0` : null,
              badPrior.length
                ? `prior chéo ÂM ở ${badPrior.map((x) => `${x.league} (${P(x.roi)})`).join(', ')}`
                : null,
            ]
              .filter(Boolean)
              .join('; ') +
            '. Nó được đề xuất **chỉ để thu số ở chế độ paper**, không phải vì tin là có lãi.',
        );
      }
    } else {
      L.push('_Không có ô nào đạt đồng thời 7.1 + 7.2 để đề xuất làm bộ tham số paper._');
    }
    L.push('');
    L.push('### Chốt');
    L.push('');
    L.push('**Không có edge nào được xác nhận; không đưa vào bot tiền thật.**');
    L.push('');
  }

  // ---- §6.9 ----------------------------------------------------------------
  L.push('## §6.9 — Các nguồn lạc quan phải khai báo');
  L.push('');
  L.push('1. Giá vào lệnh là giá tại tick; bot thật đặt sau vài giây, giá thường xấu hơn.');
  L.push(
    '2. Không mô phỏng nhà cái từ chối / khoá kèo lúc đặt. V.Bot 14 thật chờ book mở tới phút 42; ' +
      'harness coi như đặt được ngay khi nấc `suspended=false`.',
  );
  L.push('3. Không mô phỏng giới hạn stake.');
  L.push('4. Bàn thắng xảy ra giữa lúc quyết định và lúc đặt được coi như không xảy ra.');
  L.push(
    `5. \`TOL\` phút cho phép lấy tick sớm hơn tới ${config.MINUTE_TOL} phút so với mốc danh nghĩa ` +
      '(T4b đo mức ảnh hưởng).',
  );
  L.push('');
  L.push(
    `_Sinh bởi \`npm run rung:run\` — league ${config.LEAGUE}, seed ${config.SEED}, ` +
      `TOL ${config.MINUTE_TOL}, ${config.SHUFFLES} shuffle. Chạy lại cùng seed cho output giống hệt._`,
  );

  return L.join('\n');
}

// ---------------------------------------------------------------------------
function mrow(m) {
  return [m.n, P(m.roi), P(m.winRate), E(m.evLB), U(m.mdd), U(m.pnl), U(m.betsPerDay), P(m.roiEarly), P(m.roiLate)];
}
const mark = (b) => (b === true ? '✓ ĐẠT' : b === false ? '✗ TRƯỢT' : '? chưa chạy');
const rate = (a, b) => (Number(b) ? Number(a) / Number(b) : 1);
const flag = (v, ref) => (Math.abs(v - ref) / Math.abs(ref) > 0.05 ? '⚠️ >5%' : 'ok');

function avgFinal(ds, half) {
  const us = ds.units.filter((u) => u.half === half && u.finalTotal != null);
  return us.length ? us.reduce((s, u) => s + u.finalTotal, 0) / us.length : NaN;
}

function countOpenOpportunities(ds, lo = 32, hi = 36) {
  let h1 = 0;
  let h2 = 0;
  for (const u of ds.units) {
    let any = false;
    for (let m = lo; m <= hi; m++) if (u.srcMinute[m] >= 0 && u.open[m]) any = true;
    if (any) (u.half === 'H1' ? h1++ : h2++);
  }
  return { H1: h1, H2: h2, total: h1 + h2 };
}

function funnelRow(label, f) {
  if (!f) return [label, ...Array(9).fill('—')];
  const pctOf = (x) => (f.units ? `${x} (${((100 * x) / f.units).toFixed(0)}%)` : String(x));
  const s1 = f.units - f.no_tick_flag;
  const s2 = s1 - f.flag_locked;
  const s3 = s2 - f.price_gate;
  const s4 = s3 - f.no_tick_entry - f.cancelled_goal;
  const s5 = s4 - f.entry_locked;
  const s6 = s5 - f.no_rung;
  const s7 = s6 - f.no_result;
  return [label, f.units, pctOf(s1), pctOf(s2), pctOf(s3), pctOf(s4), pctOf(s5), pctOf(s6), pctOf(s7), `**${f.bets}**`];
}

export { comboLabel };
