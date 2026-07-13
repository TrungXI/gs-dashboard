import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

interface PredictBody {
  homeTeam: string;
  awayTeam: string;
  h1Home: number;
  h1Away: number;
  isH2: boolean;
  minuteElapsed: number;
  hcLine: string | null;
  hcHome: string | null;
  ouLine: string | null;
  homeW: number; homeD: number; homeL: number; homeAvgGoals: number;
  awayW: number; awayD: number; awayL: number; awayAvgGoals: number;
  h2hHomeW: number; h2hDraws: number; h2hAwayW: number; h2hTotal: number;
}

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
  lines.push(`Đang: ${homeTeam} ${scoreLine} ${awayTeam} · ${halfLabel} · còn ~${timeLeft}'`);
  lines.push('');
  lines.push(`⚽ Ghi bàn tiếp theo`);
  lines.push(`   ${homeTeam}: ${homeNextPctInt}%  ·  ${awayTeam}: ${awayNextPctInt}%`);
  const nextReason: string[] = [];
  if (homeFormPts !== awayFormPts)
    nextReason.push(`${nextFav} form ${formLabel(nextFav === homeTeam ? homeFormPts : awayFormPts)}`);
  if (h2hTotal > 0 && h2hHomeW !== h2hAwayW)
    nextReason.push(`H2H ${homeTeam} ${h2hHomeW}-${h2hAwayW} ${awayTeam}`);
  if (scoreDiff !== 0)
    nextReason.push(scoreDiff > 0 ? `${awayTeam} đang cần gỡ` : `${homeTeam} đang cần gỡ`);
  if (nextReason.length) lines.push(`   → ${nextReason.join(', ')}`);

  lines.push('');
  lines.push(`🔄 Khả năng gỡ hòa: ${drawPct}%`);
  if (scoreDiff === 0) {
    lines.push(`   Đang hòa ${scoreLine} — ${timeLeft < 20 ? 'ít thời gian, nhiều khả năng giữ hòa' : 'còn đủ thời gian bật tung'}`);
  } else {
    const trailingTeam = scoreDiff > 0 ? awayTeam : homeTeam;
    const trailingForm = scoreDiff > 0 ? awayFormPts : homeFormPts;
    if (drawPct < 20)
      lines.push(`   ${trailingTeam} form ${formLabel(trailingForm)}, ${timeLeft < 15 ? 'quá ít thời gian' : 'cách biệt khó thu hẹp'}`);
    else
      lines.push(`   ${trailingTeam} có thể gỡ — form ${formLabel(trailingForm)}, còn ${timeLeft}'`);
  }

  lines.push('');
  lines.push(`🎯 Dự đoán kết quả`);
  if (predictedWinner) {
    lines.push(`   ${predictedWinner} thắng`);
  } else {
    lines.push(`   Hai đội cân bằng — hòa hoặc cách biệt 1 bàn`);
  }
  if (ouLine) {
    const ouVal = parseFloat(ouLine);
    const currentTotal = h1Home + h1Away;
    const goalsNeeded = Math.ceil(ouVal - currentTotal);
    lines.push(`   OU ${ouLine}: cần thêm ~${Math.max(0, goalsNeeded)} bàn để qua tài`);
  }
  if (hcLine)
    lines.push(`   HC ${hcLine}: ${oddsSignal === 'home' ? homeTeam : oddsSignal === 'away' ? awayTeam : 'hai đội'} được kèo`);

  lines.push('');
  lines.push(`📋 Phong độ (5 trận)`);
  lines.push(`   ${homeTeam}: ${homeW}W ${homeD}D ${homeL}L · TB ${homeAvgGoals.toFixed(1)} bàn/trận`);
  lines.push(`   ${awayTeam}: ${awayW}W ${awayD}D ${awayL}L · TB ${awayAvgGoals.toFixed(1)} bàn/trận`);
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
        if (i >= text.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(text.slice(i, i + 4)));
        i += 4;
        setTimeout(tick, 10);
      }
      tick();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function claudeStream(b: PredictBody): Promise<Response> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const statsText = buildStatisticalAnalysis(b);
  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: 'Bạn là chuyên gia phân tích bóng đá ảo tốc độ (16-20 phút). Phân tích ngắn gọn, cụ thể, bằng tiếng Việt. Đưa ra dự đoán rõ ràng dựa trên số liệu.',
    messages: [{
      role: 'user',
      content: `Số liệu thống kê trận đấu đang diễn ra:\n\n${statsText}\n\nDựa vào số liệu trên, phân tích và dự đoán: đội nào ghi bàn tiếp theo, khả năng gỡ hòa, và kết quả cuối trận. Giữ ngắn gọn (5-7 dòng).`,
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
  if (process.env.ANTHROPIC_API_KEY) {
    return claudeStream(body);
  }
  return statsStream(buildStatisticalAnalysis(body));
}
