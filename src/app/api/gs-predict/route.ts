import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

interface FormEntry {
  opp: string;
  result: 'W' | 'D' | 'L';
  myScore: string;
  oppScore: string;
  isHome: boolean;
}

interface H2HEntry {
  date: string;
  homeScore: string;
  awayScore: string;
  winner: 'home' | 'away' | 'draw';
}

interface PredictBody {
  homeTeam: string;
  awayTeam: string;
  matchType: string;
  h1Home: number;
  h1Away: number;
  isH2: boolean;
  minute: number | null;
  hcLine: string | null;
  hcHome: string | null;
  hcAway: string | null;
  ouLine: string | null;
  homeForm: FormEntry[];
  awayForm: FormEntry[];
  h2h: H2HEntry[];
}

const SYSTEM_PROMPT = `Bạn là chuyên gia phân tích bóng đá ảo GS (virtual football).
Phân tích NGẮN GỌN, súc tích, tập trung vào 3 điểm chính:
1. **Bên nào ghi bàn tiếp theo** và lý do chính
2. **Có gỡ hòa không** (nếu đang có chênh lệch)
3. **Dự đoán kết quả** cuối trận
Dùng bullet points. Tối đa 200 từ. Không dùng markdown headers.`;

function formLine(form: FormEntry[]): string {
  if (!form.length) return 'không có dữ liệu';
  return form
    .map((f) => `${f.result} ${f.myScore}-${f.oppScore} ${f.isHome ? 'sân nhà' : 'sân khách'} vs ${f.opp}`)
    .join('; ');
}

function h2hLine(h2h: H2HEntry[]): string {
  if (!h2h.length) return 'không có dữ liệu';
  return h2h.map((h) => `${h.date}: ${h.homeScore}-${h.awayScore}`).join('; ');
}

function buildUserMessage(b: PredictBody): string {
  const displayMinute = b.minute == null ? '?' : b.isH2 ? 45 + b.minute : b.minute;
  const half = b.isH2 ? 'hiệp 2' : 'hiệp 1';
  const hc =
    b.hcLine != null
      ? `Kèo châu Á: ${b.hcLine} (nhà ${b.hcHome ?? '—'} / khách ${b.hcAway ?? '—'})`
      : 'Kèo châu Á: không có';
  const ou = b.ouLine != null ? `Tài xỉu: ${b.ouLine}` : 'Tài xỉu: không có';

  return [
    `Trận đấu ảo ${b.matchType}: ${b.homeTeam} (nhà) vs ${b.awayTeam} (khách).`,
    `Tỷ số hiện tại: ${b.h1Home}-${b.h1Away}, đang ${half}, phút ${displayMinute} (thang 90').`,
    hc,
    ou,
    `Phong độ 5 trận ${b.homeTeam}: ${formLine(b.homeForm)}`,
    `Phong độ 5 trận ${b.awayTeam}: ${formLine(b.awayForm)}`,
    `Đối đầu gần đây: ${h2hLine(b.h2h)}`,
    'Phân tích diễn biến tiếp theo và dự đoán kết quả cuối trận.',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as PredictBody;
  const userMsg = buildUserMessage(body);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 350,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMsg }],
          stream: true,
        });
        for await (const chunk of response) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (e) {
        controller.enqueue(new TextEncoder().encode(`Lỗi khi phân tích: ${String(e)}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
