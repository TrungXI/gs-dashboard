import { NextRequest } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL; // e.g. http://103.82.23.48:8001
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
  ouLine: string | null;
  homeW: number; homeD: number; homeL: number; homeAvgGoals: number;
  awayW: number; awayD: number; awayL: number; awayAvgGoals: number;
  h2hHomeW: number; h2hDraws: number; h2hAwayW: number; h2hTotal: number;
  redHome?: number; redAway?: number;
}

interface MlPrediction {
  home_pct: number;
  draw_pct: number;
  away_pct: number;
  model_version: number;
  confidence: string;
  n_samples: number;
}

// ── ML service call ───────────────────────────────────────────────────────────

async function callMlService(b: PredictBody): Promise<MlPrediction | null> {
  if (!ML_SERVICE_URL) return null;
  try {
    const homeFormPts = b.homeW * 3 + b.homeD;
    const awayFormPts = b.awayW * 3 + b.awayD;
    const h2hRate = b.h2hTotal > 0 ? (b.h2hHomeW + b.h2hDraws * 0.5) / b.h2hTotal : 0.5;
    const res = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        h1_home: b.h1Home,
        h1_away: b.h1Away,
        match_type: '20p',
        home_form_pts: homeFormPts,
        away_form_pts: awayFormPts,
        h2h_home_win_rate: h2hRate,
        hc_line: b.hcHome ? parseFloat(b.hcHome) : 0.0,
        is_h2: b.isH2,
        minute: b.minuteElapsed ?? 45,
        red_home: b.redHome ?? 0,
        red_away: b.redAway ?? 0,
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    return (await res.json()) as MlPrediction;
  } catch {
    return null;
  }
}

// ── Fire-and-forget prediction log ───────────────────────────────────────────

function logPrediction(b: PredictBody, ml: MlPrediction | null): void {
  const pool = getPool();
  if (!pool) return;
  const homeFormPts = b.homeW * 3 + b.homeD;
  const awayFormPts = b.awayW * 3 + b.awayD;
  const h2hRate = b.h2hTotal > 0 ? (b.h2hHomeW + b.h2hDraws * 0.5) / b.h2hTotal : 0.5;
  pool.query(
    `INSERT INTO gs_ml_predictions
       (event_id, home_team, away_team, h1_home, h1_away, is_h2, minute_elapsed,
        home_form_pts, away_form_pts, h2h_home_win_rate,
        hc_line, hc_home_odds, ou_line,
        red_home, red_away,
        predicted_home_pct, predicted_away_pct, model_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      b.eventId ?? null,
      b.homeTeam, b.awayTeam, b.h1Home, b.h1Away, b.isH2, b.minuteElapsed ?? null,
      homeFormPts, awayFormPts, h2hRate,
      b.hcLine ? parseFloat(b.hcLine) : null,
      b.hcHome ? parseFloat(b.hcHome) : null,
      b.ouLine ? parseFloat(b.ouLine) : null,
      b.redHome ?? 0, b.redAway ?? 0,
      ml?.home_pct ?? null, ml?.away_pct ?? null, ml?.model_version ?? null,
    ]
  ).catch(() => { /* non-critical */ });
}

// ── Statistical engine ────────────────────────────────────────────────────────

function buildStatisticalAnalysis(b: PredictBody, ml: MlPrediction | null): string {
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

  // ML header
  if (ml) {
    const confEmoji = ml.confidence === 'high' ? '🟢' : ml.confidence === 'medium' ? '🟡' : '🔴';
    lines.push(`[ML v${ml.model_version} · ${ml.n_samples} mẫu · ${confEmoji} ${ml.confidence}]`);
    lines.push(`${homeTeam}: ${ml.home_pct}% thắng · Hòa: ${ml.draw_pct}% · ${awayTeam}: ${ml.away_pct}% thắng`);
    lines.push('');
  }

  lines.push(`Đang: ${homeTeam} ${h1Home}-${h1Away} ${awayTeam} · ${halfLabel} · còn ~${timeLeft}'`);
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
    lines.push(`   OU ${ouLine}: ${goalsNeeded > 0 ? `cần thêm ~${goalsNeeded} bàn để qua tài` : 'đã đủ tài'}`);
  }
  if (hcLine)
    lines.push(`   HC ${hcLine}: ${oddsSignal === 'home' ? homeTeam : oddsSignal === 'away' ? awayTeam : 'hai đội cân bằng'} được kèo`);

  lines.push('');
  const homeTotal = homeW + homeD + homeL;
  const awayTotal = awayW + awayD + awayL;
  lines.push(`📋 Phong độ (${Math.min(homeTotal, awayTotal)} trận gần nhất)`);
  lines.push(`   ${homeTeam}: ${homeW}W ${homeD}D ${homeL}L · TB ${homeAvgGoals.toFixed(1)} bàn/trận`);
  lines.push(`   ${awayTeam}: ${awayW}W ${awayD}D ${awayL}L · TB ${awayAvgGoals.toFixed(1)} bàn/trận`);
  if (h2hTotal > 0)
    lines.push(`   H2H: ${homeTeam} ${h2hHomeW}W · ${h2hDraws}D · ${h2hAwayW}W ${awayTeam}`);

  return lines.join('\n');
}

function statsStream(text: string, ml: MlPrediction | null): Response {
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
  if (ml) headers['X-ML-Samples'] = String(ml.n_samples);
  return new Response(stream, { headers });
}

async function claudeStream(b: PredictBody, ml: MlPrediction | null): Promise<Response> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const statsText = buildStatisticalAnalysis(b, ml);
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

  // Call ML service (parallel, non-blocking on failure)
  const ml = await callMlService(body);

  // Log prediction fire-and-forget
  logPrediction(body, ml);

  if (process.env.ANTHROPIC_API_KEY) {
    return claudeStream(body, ml);
  }
  return statsStream(buildStatisticalAnalysis(body, ml), ml);
}
