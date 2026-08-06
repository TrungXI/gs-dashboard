'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingState, Spinner } from './Spinner';
import type {
  BotReport as BotReportData,
  BotReportResponse,
  BucketRow,
  WindowRank,
} from '../app/api/gs-bot-report/route';

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtNet(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
}
function fmtDay(d: string): string {
  // YYYY-MM-DD → DD/MM
  const [, m, day] = d.split('-');
  return `${day}/${m}`;
}
function wrPct(wr: number | null): string {
  return wr == null ? '—' : `${Math.round(wr * 100)}%`;
}

// net → cell background. Green deepens with positive net, red with negative, gray
// when ~flat. Scaled so ±6u ≈ full saturation (typical per-bucket-day magnitude).
function netStyle(net: number): React.CSSProperties {
  const k = Math.max(0, Math.min(1, Math.abs(net) / 6));
  if (net > 0.05) return { background: `rgba(34, 197, 94, ${0.1 + 0.55 * k})`, color: '#e6ffe9' };
  if (net < -0.05) return { background: `rgba(239, 68, 68, ${0.1 + 0.55 * k})`, color: '#ffecec' };
  return { background: 'rgba(255,255,255,0.04)', color: '#888' };
}

// Consistency badge per bucket row (edge THẬT vs nhiễu).
function consistencyBadge(row: BucketRow): { text: string; color: string } {
  switch (row.consistency) {
    case 'stable-pos':
      return { text: `🟢 dương ${row.posDays}/${row.daysWithData} ngày`, color: '#4ade80' };
    case 'stable-neg':
      return { text: `🔴 âm ${row.negDays}/${row.daysWithData} ngày`, color: '#f87171' };
    case 'noisy':
      return { text: `⚠️ ${row.posDays}↑${row.negDays}↓`, color: '#fbbf24' };
    case 'flat':
      return { text: '· hoà', color: '#888' };
    default:
      return { text: '· trống', color: '#555' };
  }
}

// ── Heatmap matrix (buckets × days) for one bot ───────────────────────────────

function BotMatrix({ bot, days }: { bot: BotReportData; days: string[] }) {
  const accent = bot.side === 'tai' ? '#4ade80' : '#f87171';
  return (
    <div className="mb-6 rounded-lg border border-[#2a2a2a] bg-[#141414]">
      <div className="flex items-center justify-between gap-2 border-b border-[#222] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold" style={{ color: accent }}>
            {bot.label}
          </span>
          <span className="text-[10px] text-[#666]">{bot.calcVersion}</span>
        </div>
        <span
          className="rounded-md px-2 py-1 text-[12px] font-bold tabular-nums"
          style={netStyle(bot.totalNet)}
        >
          Tổng {fmtNet(bot.totalNet)}u
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#141414] px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#777]">
                Khung
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className="px-1.5 py-1.5 text-center text-[10px] font-semibold tabular-nums text-[#999]"
                >
                  {fmtDay(d)}
                </th>
              ))}
              <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#777]">
                Nhất quán
              </th>
            </tr>
          </thead>
          <tbody>
            {bot.rows.map((row) => {
              const badge = consistencyBadge(row);
              return (
                <tr key={row.bucket}>
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-[#141414] px-2 py-1 text-left text-[11px] font-semibold text-[#ccc]">
                    {row.label}
                  </th>
                  {row.cells.map((cell, di) =>
                    cell ? (
                      <td
                        key={days[di]}
                        title={`${row.label} · ${fmtDay(days[di])} — ${cell.w}T/${cell.l}B · WR ${wrPct(
                          cell.wr,
                        )} · net ${fmtNet(cell.net)}u`}
                        className="h-11 min-w-[52px] border border-[#0d0d0d] px-1 text-center align-middle tabular-nums transition-all hover:brightness-125"
                        style={netStyle(cell.net)}
                      >
                        <div className="text-[12px] font-bold leading-tight">{fmtNet(cell.net)}</div>
                        <div className="text-[9px] opacity-80 leading-tight">{wrPct(cell.wr)}</div>
                      </td>
                    ) : (
                      <td
                        key={days[di]}
                        className="h-11 min-w-[52px] border border-[#0d0d0d] bg-white/[.02] text-center text-[#444]"
                      >
                        ·
                      </td>
                    ),
                  )}
                  <td className="whitespace-nowrap px-2 py-1 text-[11px] font-semibold" style={{ color: badge.color }}>
                    {badge.text}
                  </td>
                </tr>
              );
            })}
            {/* TỔNG net/ngày */}
            <tr className="border-t border-[#2a2a2a]">
              <th className="sticky left-0 z-10 bg-[#141414] px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-[#999]">
                Tổng/ngày
              </th>
              {bot.dayNet.map((n, di) => (
                <td
                  key={days[di]}
                  className="px-1.5 py-1.5 text-center text-[11px] font-bold tabular-nums"
                  style={{ color: n == null ? '#555' : n > 0 ? '#4ade80' : n < 0 ? '#f87171' : '#888' }}
                >
                  {n == null ? '·' : fmtNet(n)}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Golden-window card (recent-weighted best/worst + decay flag) ──────────────

function windowChip(rank: WindowRank | null, kind: 'best' | 'worst') {
  if (!rank) return <span className="text-[12px] text-[#555]">— chưa đủ dữ liệu —</span>;
  const color = kind === 'best' ? '#4ade80' : '#f87171';
  const icon = kind === 'best' ? '🟢' : '🔴';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[13px] font-bold text-[#eee]">
        {icon} {rank.label}
      </span>
      <span className="text-[13px] font-bold tabular-nums" style={{ color }}>
        {fmtNet(rank.recentNet)}u
      </span>
      <span className="text-[10px] text-[#777]">WR {wrPct(rank.recentWr)}</span>
      {rank.decaying && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{ background: '#fbbf2422', color: '#fbbf24' }}
          title={`Gần đây (${fmtNet(rank.recentNet)}u) tệ hơn lịch sử (${fmtNet(rank.histNet)}u) → edge đang chết`}
        >
          ⚠️ suy
        </span>
      )}
    </span>
  );
}

function GoldenWindow({ bots, recentDays }: { bots: BotReportData[]; recentDays: string[] }) {
  const recentLabel = recentDays.length > 0 ? recentDays.map(fmtDay).join(', ') : '—';
  return (
    <div className="mb-6 rounded-lg border border-[#2a2a2a] bg-[#141414]">
      <div className="border-b border-[#222] px-3 py-2.5">
        <div className="text-[13px] font-bold text-[#eee]">🕐 Bản đồ cửa vàng theo giờ</div>
        <div className="mt-0.5 text-[11px] text-[#888]">
          Xếp hạng khung giờ theo hiệu quả <span className="font-semibold text-[#eee]">GẦN ĐÂY</span> (
          {recentDays.length} ngày cuối: {recentLabel}) — <span className="text-[#666]">KHÔNG</span> dùng cumulative
          (cumulative che decay). <span className="text-[#fbbf24]">⚠️ suy</span> = gần đây tệ hơn lịch sử → edge đang chết.
        </div>
      </div>
      <div className="flex flex-col divide-y divide-[#1c1c1c]">
        {bots.map((bot) => {
          const accent = bot.side === 'tai' ? '#4ade80' : '#f87171';
          return (
            <div key={bot.calcVersion} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 sm:w-40 sm:shrink-0">
                <span className="text-[12px] font-bold" style={{ color: accent }}>
                  {bot.label}
                </span>
                {bot.decayFlag && <span title="Có khung đang suy">⚠️</span>}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-[#777]">Tốt nhất</span>
                  {windowChip(bot.best, 'best')}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-[#777]">Tệ nhất</span>
                  {windowChip(bot.worst, 'worst')}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function BotReport() {
  const [data, setData] = useState<BotReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/gs-bot-report', { cache: 'no-store' });
      const json = (await res.json()) as BotReportResponse;
      if (!json.ok) {
        setError(json.error || 'Lỗi tải dữ liệu');
        setData(null);
        return;
      }
      setData(json);
    } catch (e) {
      setError(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const days = data?.days ?? [];
  const bots = data?.bots ?? [];

  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-[18px] font-extrabold">🤖 Bot Report</h1>
        {loading && data && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#17a2b8]">
            <Spinner size={12} /> Đang tải…
          </span>
        )}
        {data && !loading && (
          <button
            onClick={load}
            className="ml-auto rounded-md bg-white/[.07] px-2.5 py-1 text-[11px] font-semibold text-white/60 hover:bg-white/15 hover:text-white"
          >
            ↻ Làm mới
          </button>
        )}
      </div>
      <p className="mb-4 text-[12px] text-[#888]">
        Ma trận <span className="font-semibold text-[#ddd]">khung giờ × ngày</span> cho 2 con bot. Ô{' '}
        <span className="text-[#4ade80]">xanh</span> = net dương, <span className="text-[#f87171]">đỏ</span> = âm,
        đậm dần theo độ lớn; xám/&quot;·&quot; = không có kèo. Cột &quot;nhất quán&quot; cho biết khung nào là edge
        THẬT (dương đều) hay nhiễu.
      </p>

      {error !== null ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
          <div className="text-3xl">⚠️</div>
          <div className="text-[13px] text-[#f87171]">{error}</div>
          <button
            onClick={load}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20 hover:text-white"
          >
            Thử lại
          </button>
        </div>
      ) : loading && data === null ? (
        <LoadingState label="Đang tải báo cáo bot…" className="py-24" />
      ) : days.length === 0 || bots.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
          <div className="mb-3 text-4xl">📭</div>
          <div className="text-[14px] text-[#888]">Chưa có dữ liệu kèo cho 2 con bot này</div>
        </div>
      ) : (
        <div className={`transition-opacity duration-200 ${loading ? 'pointer-events-none opacity-40' : ''}`}>
          <GoldenWindow bots={bots} recentDays={data?.recentDays ?? []} />
          {bots.map((bot) => (
            <BotMatrix key={bot.calcVersion} bot={bot} days={days} />
          ))}
        </div>
      )}
    </>
  );
}
