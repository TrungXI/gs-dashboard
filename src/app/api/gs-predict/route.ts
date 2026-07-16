import { NextRequest } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool for prediction logging — only created when DB URL is set
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

interface PredictBody {
  homeTeam: string;
  awayTeam: string;
  eventId?: number;
  h1Home: number;
  h1Away: number;
  isH2: boolean;
  minuteElapsed: number;
  hcLine: string | null;
  hcHome: string | null;
  hcAway?: string | null;
  ouLine: string | null;
  ouOver?: string | null;
  ouUnder?: string | null;
  hcH1Line?: string | null;
  hcH1Home?: string | null;
  hcH1Away?: string | null;
  ouH1Line?: string | null;
  ouH1Over?: string | null;
  ouH1Under?: string | null;
  homeW: number; homeD: number; homeL: number; homeAvgGoals: number;
  awayW: number; awayD: number; awayL: number; awayAvgGoals: number;
  h2hHomeW: number; h2hDraws: number; h2hAwayW: number; h2hTotal: number;
  redHome?: number; redAway?: number;
  yellowHome?: number; yellowAway?: number;
  cornersHome?: number; cornersAway?: number;
  homeAvgConceded?: number; awayAvgConceded?: number;
  homeHoldW?: number; homeHoldTotal?: number;
  awayHoldW?: number; awayHoldTotal?: number;
  matchType?: string;
  previousPredictions?: Array<{
    score_home: number;
    score_away: number;
    half: string | null;
    minute: number | null;
    prediction_text: string;
  }>;
}

// ── Team resolution ───────────────────────────────────────────────────────────

/** Resolve team name (already canonical English "Japan (V)") → gs_teams.id */
async function resolveTeamId(pool: Pool, name: string): Promise<number | null> {
  const m = name.trim().match(/^(.+?)\s+\(([VS])\)$/);
  if (!m) return null;
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM gs_teams WHERE name = $1 AND type = $2',
    [m[1].trim(), m[2]],
  );
  return rows[0]?.id ?? null;
}

/** Fetch historical odds snapshots from match_odds_log for a pair of teams.
 *  Returns a formatted text block for the Claude prompt, or null if unavailable. */
async function fetchOddsHistory(homeTeam: string, awayTeam: string): Promise<string | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const [homeId, awayId] = await Promise.all([
      resolveTeamId(pool, homeTeam),
      resolveTeamId(pool, awayTeam),
    ]);
    if (!homeId || !awayId) return null;

    const { rows } = await pool.query<{
      snapshot_type: string; score_home: number; score_away: number; is_h2: boolean;
      hc_line: string | null; hc_home_odds: string | null; hc_away_odds: string | null;
      ou_line: string | null; ou_over: string | null; ou_under: string | null;
      event_id: number | null; home_team: string; away_team: string; recorded_at: string;
    }>(
      `SELECT snapshot_type, score_home, score_away, is_h2,
              hc_line, hc_home_odds, hc_away_odds,
              ou_line, ou_over, ou_under,
              event_id, home_team, away_team, recorded_at
       FROM match_odds_log
       WHERE (home_team_id = $1 AND away_team_id = $2)
          OR (home_team_id = $2 AND away_team_id = $1)
       ORDER BY recorded_at DESC
       LIMIT 60`,
      [homeId, awayId],
    );
    if (!rows.length) return null;

    // Group by event_id, keep last 5 distinct events
    const eventMap = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.event_id ? String(row.event_id) : row.recorded_at.slice(0, 10);
      if (!eventMap.has(key)) {
        if (eventMap.size >= 5) break;
        eventMap.set(key, []);
      }
      eventMap.get(key)!.push(row);
    }

    const lines: string[] = ['📈 KÈO LỊCH SỬ CẶP ĐỘI (match_odds_log):'];
    let matchNum = 1;
    for (const [, snapshots] of eventMap) {
      // Reverse to show chronological order within each match
      const ordered = [...snapshots].reverse();
      const first = ordered[0];
      const matchLabel = `${first.home_team} vs ${first.away_team}`;
      lines.push(`\nTrận ${matchNum} — ${matchLabel}:`);
      for (const s of ordered) {
        const score = `${s.score_home}-${s.score_away}`;
        const half = s.is_h2 ? 'H2' : 'H1';
        const hc = s.hc_line != null
          ? `HC ${s.hc_line} Home ${s.hc_home_odds ?? '-'}/Away ${s.hc_away_odds ?? '-'}`
          : 'HC -';
        const ou = s.ou_line != null
          ? `OU ${s.ou_line} Tài ${s.ou_over ?? '-'}/Xỉu ${s.ou_under ?? '-'}`
          : 'OU -';
        lines.push(`  • [${s.snapshot_type}] ${half} ${score} | ${hc} | ${ou}`);
      }
      matchNum++;
    }

    return lines.join('\n');
  } catch {
    return null;
  }
}

// ── Statistical engine ────────────────────────────────────────────────────────

function buildStatisticalAnalysis(b: PredictBody): string {
  const {
    homeTeam, awayTeam, h1Home, h1Away, isH2, minuteElapsed,
    hcLine, hcHome, ouLine,
    homeW, homeD, homeL, homeAvgGoals,
    awayW, awayD, awayL, awayAvgGoals,
    h2hHomeW, h2hDraws, h2hAwayW, h2hTotal,
  } = b;

  const homeFormPts = homeW * 3 + homeD;
  const awayFormPts = awayW * 3 + awayD;
  const displayMinute = isH2 ? 45 + minuteElapsed : minuteElapsed;
  const timeLeft = Math.max(0, 90 - displayMinute);
  const hcVal = hcHome ? parseFloat(hcHome) : null;
  const oddsSignal: 'home' | 'away' | 'neutral' =
    hcVal !== null && hcVal < -0.2 ? 'home' : hcVal !== null && hcVal > 0.2 ? 'away' : 'neutral';
  const scoreDiff = h1Home - h1Away;

  const totalFormPts = homeFormPts + awayFormPts;
  let homeNextPct = totalFormPts > 0 ? homeFormPts / totalFormPts : 0.5;
  if (h2hTotal > 0) {
    const h2hRatio = (h2hHomeW + h2hDraws * 0.5) / h2hTotal;
    homeNextPct = homeNextPct * 0.7 + h2hRatio * 0.3;
  }
  if (scoreDiff > 0) homeNextPct -= 0.08;
  if (scoreDiff < 0) homeNextPct += 0.08;
  if (oddsSignal === 'home') homeNextPct += 0.05;
  if (oddsSignal === 'away') homeNextPct -= 0.05;
  homeNextPct = Math.min(Math.max(homeNextPct, 0.2), 0.8);
  const homeNextPctInt = Math.round(homeNextPct * 100);
  const awayNextPctInt = 100 - homeNextPctInt;

  let drawPct: number;
  if (scoreDiff === 0) {
    const formBalance = Math.abs(homeFormPts - awayFormPts) <= 3;
    drawPct = timeLeft > 30 ? 45 : timeLeft > 15 ? 55 : 65;
    if (formBalance) drawPct += 10;
  } else {
    const gap = Math.abs(scoreDiff);
    if (gap >= 2) {
      drawPct = Math.max(5, 15 - timeLeft * 0.2);
    } else {
      const trailingForm = scoreDiff > 0 ? awayFormPts : homeFormPts;
      drawPct = Math.round(25 * (trailingForm / 15) * (timeLeft / 45));
      drawPct = Math.min(Math.max(drawPct, 8), 55);
    }
  }

  const homeScore = homeFormPts + h2hHomeW * 1.5 + (oddsSignal === 'home' ? 3 : oddsSignal === 'away' ? -3 : 0);
  const awayScore = awayFormPts + h2hAwayW * 1.5 + (oddsSignal === 'away' ? 3 : oddsSignal === 'home' ? -3 : 0);
  const predictedWinner = homeScore > awayScore * 1.1 ? homeTeam : awayScore > homeScore * 1.1 ? awayTeam : null;

  const formLabel = (pts: number) =>
    pts >= 12 ? 'xuất sắc' : pts >= 9 ? 'tốt' : pts >= 6 ? 'khá' : pts >= 3 ? 'trung bình' : 'yếu';

  const nextFav = homeNextPctInt >= awayNextPctInt ? homeTeam : awayTeam;
  const scoreLine = `${h1Home}-${h1Away}`;
  const halfLabel = isH2 ? `H2 phút ${displayMinute}'` : `H1 phút ${displayMinute}'`;

  const lines: string[] = [];

  const matchTypeLabel = b.matchType ? ` · loại ${b.matchType}` : '';
  lines.push(`Đang: ${homeTeam} ${h1Home}-${h1Away} ${awayTeam} · ${halfLabel} · còn ~${timeLeft}'${matchTypeLabel}`);
  const liveMeta: string[] = [];
  if ((b.redHome ?? 0) > 0) liveMeta.push(`⚠️ ${homeTeam} thẻ đỏ −${b.redHome}`);
  if ((b.redAway ?? 0) > 0) liveMeta.push(`⚠️ ${awayTeam} thẻ đỏ −${b.redAway}`);
  if ((b.yellowHome ?? 0) > 0 || (b.yellowAway ?? 0) > 0)
    liveMeta.push(`🟨 Vàng: ${homeTeam} ${b.yellowHome ?? 0} · ${awayTeam} ${b.yellowAway ?? 0}`);
  if ((b.cornersHome ?? 0) > 0 || (b.cornersAway ?? 0) > 0)
    liveMeta.push(`Góc: ${homeTeam} ${b.cornersHome ?? 0} · ${awayTeam} ${b.cornersAway ?? 0}`);
  if (liveMeta.length) lines.push(liveMeta.join('  '));
  lines.push('');

  lines.push(`⚽ Ghi bàn tiếp theo`);
  lines.push(`   ${homeTeam}: ${homeNextPctInt}%  ·  ${awayTeam}: ${awayNextPctInt}%`);
  const nextReason: string[] = [];
  if (homeFormPts !== awayFormPts)
    nextReason.push(`${nextFav} form ${formLabel(nextFav === homeTeam ? homeFormPts : awayFormPts)}`);
  if (h2hTotal > 0 && h2hHomeW !== h2hAwayW)
    nextReason.push(`H2H ${h2hHomeW}-${h2hDraws}-${h2hAwayW} cho ${homeTeam}`);
  if (scoreDiff !== 0)
    nextReason.push(scoreDiff > 0 ? `${awayTeam} đang cần gỡ` : `${homeTeam} đang cần gỡ`);
  if (nextReason.length) lines.push(`   → ${nextReason.join(', ')}`);

  lines.push('');
  lines.push(`🔄 Khả năng gỡ hòa: ${drawPct}%`);
  if (scoreDiff === 0) {
    lines.push(`   Đang hòa ${h1Home}-${h1Away} — ${timeLeft < 20 ? 'ít thời gian, nhiều khả năng giữ hòa' : 'còn đủ thời gian bật tung'}`);
  } else {
    const trailingTeam = scoreDiff > 0 ? awayTeam : homeTeam;
    const trailingForm = scoreDiff > 0 ? awayFormPts : homeFormPts;
    if (drawPct < 20)
      lines.push(`   ${trailingTeam} form ${formLabel(trailingForm)}, ${timeLeft < 15 ? 'quá ít thời gian' : 'cách biệt khó thu hẹp'}`);
    else
      lines.push(`   ${trailingTeam} có thể gỡ — form ${formLabel(trailingForm)}, còn ${timeLeft}'`);
  }

  lines.push('');
  // Odds block
  lines.push(`📊 Kèo hiện tại`);
  if (hcLine) {
    const hcHomeStr = b.hcHome ? ` Home ${b.hcHome}` : '';
    const hcAwayStr = b.hcAway ? ` Away ${b.hcAway}` : '';
    const hcDir = oddsSignal === 'home' ? ` → ${homeTeam} được kèo` : oddsSignal === 'away' ? ` → ${awayTeam} được kèo` : '';
    lines.push(`   HC ${hcLine}:${hcHomeStr} /${hcAwayStr}${hcDir}`);
  }
  if (ouLine) {
    const ouVal = parseFloat(ouLine);
    const currentTotal = h1Home + h1Away;
    const goalsNeeded = Math.ceil(ouVal - currentTotal);
    const ouOverStr = b.ouOver ? ` Tài ${b.ouOver}` : '';
    const ouUnderStr = b.ouUnder ? ` / Xỉu ${b.ouUnder}` : '';
    lines.push(`   OU ${ouLine}:${ouOverStr}${ouUnderStr} · ${goalsNeeded > 0 ? `cần thêm ~${goalsNeeded} bàn qua tài` : 'đã qua tài'}`);
  }
  if (b.hcH1Line) {
    const h1hStr = b.hcH1Home ? ` Home ${b.hcH1Home}` : '';
    const h1aStr = b.hcH1Away ? ` Away ${b.hcH1Away}` : '';
    lines.push(`   HC H1 ${b.hcH1Line}:${h1hStr} /${h1aStr}`);
  }
  if (b.ouH1Line) {
    const h1oStr = b.ouH1Over ? ` Tài ${b.ouH1Over}` : '';
    const h1uStr = b.ouH1Under ? ` / Xỉu ${b.ouH1Under}` : '';
    lines.push(`   OU H1 ${b.ouH1Line}:${h1oStr}${h1uStr}`);
  }

  lines.push('');
  lines.push(`🎯 Dự đoán kết quả`);
  if (predictedWinner) {
    lines.push(`   ${predictedWinner} thắng`);
  } else {
    lines.push(`   Hai đội cân bằng — hòa hoặc cách biệt 1 bàn`);
  }

  lines.push('');
  const homeTotal = homeW + homeD + homeL;
  const awayTotal = awayW + awayD + awayL;
  lines.push(`📋 Phong độ (${Math.min(homeTotal, awayTotal)} trận gần nhất)`);
  const homeConcStr = b.homeAvgConceded != null ? ` · thua TB ${b.homeAvgConceded.toFixed(1)}` : '';
  const awayConcStr = b.awayAvgConceded != null ? ` · thua TB ${b.awayAvgConceded.toFixed(1)}` : '';
  lines.push(`   ${homeTeam}: ${homeW}W ${homeD}D ${homeL}L · ghi TB ${homeAvgGoals.toFixed(1)}${homeConcStr}`);
  lines.push(`   ${awayTeam}: ${awayW}W ${awayD}D ${awayL}L · ghi TB ${awayAvgGoals.toFixed(1)}${awayConcStr}`);
  if ((b.homeHoldTotal ?? 0) > 0)
    lines.push(`   Giữ khi dẫn H1: ${homeTeam} ${b.homeHoldW}/${b.homeHoldTotal} · ${awayTeam} ${b.awayHoldW}/${b.awayHoldTotal ?? 0}`);
  if (h2hTotal > 0)
    lines.push(`   H2H: ${homeTeam} ${h2hHomeW}W · ${h2hDraws}D · ${h2hAwayW}W ${awayTeam}`);

  return lines.join('\n');
}

function statsStream(text: string): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    start(controller) {
      function tick() {
        if (i >= text.length) { controller.close(); return; }
        controller.enqueue(encoder.encode(text.slice(i, i + 4)));
        i += 4;
        setTimeout(tick, 10);
      }
      tick();
    },
  });
  const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8' };
  return new Response(stream, { headers });
}

// ── Prompt versions — đổi CLAUDE_PROMPT_VERSION để switch, cả 2 đều được giữ lại ──
const CLAUDE_PROMPT_VERSION: 1 | 2 | 3 = 3;

const CLAUDE_PROMPTS = {
  1: {
    system: 'Bạn là chuyên gia phân tích bóng đá ảo tốc độ (loại 16p và 20p — không phải bóng đá 90 phút). Trận 16p chỉ có 16 phút thực tế, bàn thắng đến rất nhanh. Trận 20p có 20 phút. Phân tích ngắn gọn, cụ thể, bằng tiếng Việt. Chú ý thẻ đỏ làm đội thiếu người. Luôn phân biệt rõ 3 điểm: (1) đội nào ghi BÀN TIẾP THEO, (2) đội đang THUA có khả năng GỠ không — dựa vào odds hiện tại, thời gian còn lại, và comeback rate lịch sử, (3) ai THẮNG TRẬN cuối. Ba câu trả lời này có thể là ba kịch bản khác nhau.',
    user: (statsText: string) =>
      `Số liệu thống kê trận đang diễn ra:\n\n${statsText}\n\nPhân tích 3 điểm sau:\n1. 🎯 BÀN TIẾP THEO: đội nào ghi bàn tiếp theo (dựa vào xác suất ML, odds, phong độ)\n2. ⚡ ĐỘI THUA CÓ GỠ ĐƯỢC KHÔNG: dựa vào (a) odds hiện tại có đang nghiêng về đội thua không, (b) còn bao nhiêu phút — đủ thời gian không, (c) lịch sử comeback rate của đội thua trong các trận tương tự — kết luận rõ CÓ hay KHÔNG và xác suất ước tính\n3. 🏆 KẾT QUẢ CUỐI: ai thắng trận (có thể khác với câu 1 và 2)\nMỗi điểm 1-2 câu ngắn gọn.`,
  },
  2: {
    system: 'Bạn là chuyên gia thống kê bóng đá ảo tốc độ (16p và 20p). Nhiệm vụ của bạn là phân tích xác suất cân bằng — không thiên vị đội nào, chỉ nói theo số liệu. Trả lời bằng tiếng Việt, ngắn gọn, súc tích.',
    user: (statsText: string) =>
      `Số liệu trận đang diễn ra:\n\n${statsText}\n\nDựa hoàn toàn vào số liệu thống kê trên, đánh giá xác suất cân bằng cho 3 tình huống:\n\n1. 🎯 BÀN TIẾP THEO\n   - Xác suất % mỗi đội ghi bàn tiếp theo\n   - Lý do ngắn gọn (phong độ, odds, áp lực tỉ số)\n\n2. ⚡ ĐỘI ĐANG THUA CÓ GỠ KHÔNG\n   - Odds có đang phản ánh khả năng gỡ không?\n   - Thời gian còn lại có đủ không?\n   - Lịch sử comeback rate nói gì?\n   - Kết luận: xác suất gỡ ~X%\n\n3. 🏆 KẾT QUẢ CUỐI\n   - Xác suất % cho từng kịch bản: Đội A thắng / Hòa / Đội B thắng\n   - Kịch bản nào có trọng số lớn nhất và tại sao\n\nLưu ý: nếu số liệu 2 đội gần bằng nhau thì nói thẳng là "cân bằng, khó đoán". Không đưa ra kết luận chắc chắn khi dữ liệu không đủ.`,
  },
  3: {
    system: `Bạn là chuyên gia phân tích bóng đá ảo tốc độ (loại 16p và 20p — không phải bóng đá 90 phút).

Đặc điểm:
- Trận 16p chỉ có 16 phút thực tế, bàn thắng đến rất nhanh.
- Trận 20p có 20 phút thực tế.
- **Bóng đá ảo tốc độ cực kỳ biến động — bàn thắng có thể xảy ra trong vòng 30 giây bất kỳ lúc nào, kể cả khi tỉ số đang ổn định.** Không bao giờ loại trừ khả năng ghi bàn chỉ vì "ít thời gian còn lại" — 1-2 phút trong bóng đá ảo có thể thay đổi hoàn toàn kết quả.
- Phân tích ngắn gọn, cụ thể, bằng tiếng Việt.
- Luôn tính đến ảnh hưởng của thẻ vàng, thẻ đỏ và thời gian còn lại.
- Không dự đoán theo cảm tính; ưu tiên odds hiện tại, biến động odds, thống kê trận đấu, phong độ, lịch sử đối đầu và dữ liệu lịch sử tương tự.
- Dựa vào lịch sử đối đầu (H2H) theo từng hiệp để dự đoán diễn biến của hiệp hiện tại.
- Khi phân tích hiệp 2, cần kết hợp dữ liệu đối đầu hiệp 1 và hiệp 2 để nhận diện xu hướng ghi bàn sau giờ nghỉ.
- Luôn áp dụng các nguyên tắc xác suất thống kê và cân bằng xác suất.

Nguyên tắc phân tích:

1. Luôn phân biệt rõ 3 dự đoán độc lập:
   (1) Đội ghi BÀN TIẾP THEO
   (2) Đội đang THUA có khả năng GHI BÀN trong HIỆP HIỆN TẠI hay không
   (3) KẾT QUẢ CUỐI của HIỆP HIỆN TẠI và KẾT QUẢ CUỐI TRẬN

2. Ba kết luận trên có thể khác nhau.
   Ví dụ:
   - Đội A ghi bàn tiếp theo.
   - Đội B vẫn có khả năng ghi bàn trong hiệp.
   - Đội A thắng chung cuộc.

3. Khi đánh giá xác suất phải xét đồng thời:
   - Odds hiện tại.
   - Biến động odds.
   - Tỉ số hiện tại.
   - Thời gian còn lại.
   - Phong độ 5-20 trận gần nhất.
   - H2H toàn trận.
   - H2H theo từng hiệp.
   - Tỷ lệ giữ lợi thế khi dẫn bàn.
   - Comeback rate khi bị dẫn.
   - Thẻ vàng, thẻ đỏ.
   - Số cú sút, phạt góc và các thống kê tấn công nếu có.
   - Xu hướng bàn thắng theo từng giai đoạn trận.

4. Nguyên tắc cân bằng thống kê (Regression to Mean):
   - Không mặc định một đội sẽ tiếp tục thắng hoặc thua mãi chỉ vì chuỗi gần đây.
   - Không mặc định một đội sẽ tiếp tục thắng kèo hoặc thua kèo mãi chỉ vì chuỗi gần đây.
   - Nếu một đội đang có chuỗi thắng, thắng kèo hoặc nổ tài quá dài trong 5-10 trận gần nhất, cần tăng trọng số khả năng chuỗi bị phá vỡ.
   - Nếu một đội đang có chuỗi thua, thua kèo hoặc xỉu quá dài trong 5-10 trận gần nhất, cần tăng trọng số khả năng đảo chiều.
   - Đây chỉ là yếu tố điều chỉnh xác suất, không được dùng như lý do duy nhất để kết luận.
   - Luôn đối chiếu với odds hiện tại và diễn biến thực tế của trận đấu.

5. Đánh giá khả năng đội đang thua ghi bàn:
   - Không chỉ nhìn tỉ số hiện tại.
   - Phải xem xét:
     a) Odds hiện tại có đang nghiêng về đội thua hay không.
     b) Thời gian còn lại có đủ để tạo cơ hội ghi bàn hay không.
     c) Comeback rate lịch sử của đội đang thua.
     d) H2H trong các tình huống tương tự.
     e) Sức ép tấn công hiện tại nếu thống kê trận đấu cho thấy.

6. Sử dụng H2H để đánh giá khả năng có bàn thắng:
   - Nếu trong các lần đối đầu gần đây đội đang thua thường ghi bàn trong cùng hiệp đấu, tăng xác suất có bàn.
   - Nếu đội đang thua thường ghi bàn sau khi bị dẫn trong các lần đối đầu trước đó, tăng xác suất ghi bàn.
   - Nếu đội dẫn thường giữ sạch lưới hoặc bảo toàn lợi thế tốt, giảm xác suất ghi bàn của đội thua.
   - Nếu H2H hiệp hiện tại và H2H toàn trận mâu thuẫn nhau, ưu tiên dữ liệu của hiệp đang diễn ra.

7. Tránh kết luận tuyệt đối:
   - Luôn diễn đạt bằng xác suất hoặc mức độ tin cậy.
   - Nếu dữ liệu trái chiều, chỉ kết luận lợi thế nhẹ.
   - Không sử dụng các từ chắc chắn như "100%", "chắc chắn thắng", "không thể xảy ra".

8. Tích hợp lịch sử dự đoán trong cùng trận (khi được cung cấp):
   - Đọc kỹ các dự đoán trước của bạn trong trận này.
   - So sánh với tỉ số và diễn biến thực tế hiện tại để xác định dự đoán trước đúng hay sai.
   - Nếu đúng → giữ hướng phân tích, tinh chỉnh thêm với dữ liệu mới nhất.
   - Nếu sai → nhận ra điểm sai (odds đổi? ghi bàn bất ngờ? comeback?), điều chỉnh trọng số cho lần này.
   - Dùng lịch sử như "bộ nhớ ngắn hạn" của trận — không lặp lại nguyên xi, chỉ học từ nó để cải thiện.
   - Luôn ưu tiên dữ liệu thực tế hiện tại hơn dự đoán cũ.`,
    user: (statsText: string) =>
      `Số liệu trận đang diễn ra:\n\n${statsText}\n\nDựa vào số liệu trên, trả lời đúng định dạng sau:\n\n🎯 BÀN TIẾP THEO\n- [Tên đội cụ thể] · xác suất ước tính\n- Lý do ngắn gọn (odds, phong độ, áp lực tỉ số)\n\n⚡ KHẢ NĂNG GHI BÀN TIẾP THEO\n- Nếu đang HÒA: ghi rõ "[Tên đội A] CÓ/KHÔNG · X%" và "[Tên đội B] CÓ/KHÔNG · Y%" — không dùng "đội đang thua" khi tỉ số bằng nhau\n- Nếu đang có đội DẪN: ghi rõ tên đội đang thua và xác suất gỡ · odds, thời gian còn lại, comeback rate, H2H\n\n🏆 KẾT QUẢ CUỐI HIỆP / CUỐI TRẬN\n- [Tên đội thắng / Hòa] · xác suất ước tính\n- Lý do ngắn gọn\n\nMỗi mục chỉ 1-2 câu, tập trung vào kết luận và xác suất cao nhất. Luôn dùng tên đội cụ thể, không dùng "đội nhà / đội khách".`,
  },
} as const;

async function claudeStream(b: PredictBody, oddsHistory: string | null = null): Promise<Response> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const statsText = buildStatisticalAnalysis(b);
  const prompt = CLAUDE_PROMPTS[CLAUDE_PROMPT_VERSION];

  const prevPreds = b.previousPredictions;

  // Always start with the original v3 prompt (unchanged)
  let userContent = prompt.user(statsText);

  if (prevPreds && prevPreds.length > 0) {
    // Last 3 predictions, full text — no truncation
    const recentPreds = prevPreds.slice(-3);
    const historyBlock = recentPreds.map(p => {
      const scoreLabel = `${p.score_home}-${p.score_away}`;
      const timeLabel = p.half && p.minute != null ? `${p.half} phút ${p.minute}'` : '';
      return `[Tỉ số ${scoreLabel}${timeLabel ? ` · ${timeLabel}` : ''}]\n${p.prediction_text.trim()}`;
    }).join('\n\n---\n\n');

    const historySection =
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📚 LỊCH SỬ DỰ ĐOÁN CỦA BẠN TRONG TRẬN NÀY:\n` +
      `(Đọc kỹ — tổng hợp lại để tự đánh giá đúng/sai trước khi đưa ra phân tích mới)\n\n` +
      `${historyBlock}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    // Insert history block between statsText and the format instructions (keep v3 format intact)
    const splitMarker = 'Dựa vào số liệu trên, trả lời đúng định dạng sau:';
    const splitIdx = userContent.indexOf(splitMarker);
    if (splitIdx !== -1) {
      userContent =
        userContent.slice(0, splitIdx) +
        historySection + '\n' +
        userContent.slice(splitIdx);
    } else {
      userContent += '\n\n' + historySection;
    }

    // Append ✏️ ĐIỀU CHỈNH section after the original format (extra section only when history exists)
    userContent +=
      `\n\n✏️ ĐIỀU CHỈNH TỪ DỰ ĐOÁN TRƯỚC (tối đa 2 dòng bullet, mỗi dòng 1 câu ngắn)\n` +
      `- Dự đoán trước đúng/sai điểm nào? (1 câu)\n` +
      `- Điều chỉnh chính cho lần này? (1 câu)`;
  }

  // Inject odds history block if available
  if (oddsHistory) {
    const splitMarker = 'Dựa vào số liệu trên, trả lời đúng định dạng sau:';
    const splitIdx = userContent.indexOf(splitMarker);
    const oddsBlock = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${oddsHistory}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    if (splitIdx !== -1) {
      userContent =
        userContent.slice(0, splitIdx) +
        oddsBlock + '\n' +
        userContent.slice(splitIdx);
    } else {
      userContent += '\n\n' + oddsBlock;
    }
  }

  const maxTokens = prevPreds && prevPreds.length > 0 ? 750 : 650;
  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: prompt.system,
    messages: [{
      role: 'user',
      content: userContent,
    }],
  });
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as PredictBody;
  const oddsHistory = await fetchOddsHistory(body.homeTeam, body.awayTeam);

  if (process.env.ANTHROPIC_API_KEY) {
    return claudeStream(body, oddsHistory);
  }
  return statsStream(buildStatisticalAnalysis(body));
}
