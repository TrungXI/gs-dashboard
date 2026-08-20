'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { LoadingState, Spinner } from './Spinner';
import type { ClbvAnalystRow } from '../app/api/clbv-analyst/route';

interface ListResponse {
  ok: boolean;
  error?: string;
  rows?: ClbvAnalystRow[];
  windowDays?: number;
  updatedAt?: string | null;
}
interface SyncResponse {
  ok: boolean;
  error?: string;
  teams?: number;
  windowDays?: number;
  updatedAt?: string;
}

// ISO timestamp → "DD/MM/YYYY HH:MM" giờ VN (UTC+7), theo quy ước hiển thị chung của app.
function fmtTime(iso: string): string {
  const ms = new Date(iso).getTime() + 7 * 60 * 60 * 1000;
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function pct(v: number | null): string {
  return v == null ? '—' : `${v}%`;
}
function goals(v: number | null): string {
  return v == null ? '—' : v.toFixed(2);
}
function n(v: number | null): string {
  return v == null ? '—' : String(v);
}

// Màu theo tỉ lệ: ≥60% xanh (thiên hướng rõ), ≤40% đỏ (thiên hướng ngược), giữa trung tính.
function rateColor(v: number | null): string {
  if (v == null) return '#666';
  if (v >= 60) return '#4ade80';
  if (v <= 40) return '#f87171';
  return '#d4d4d4';
}

// Nhóm cột: [tiêu đề nhóm, key rate, key avgGoals, key n, nhãn %]
type MetricKey = keyof Pick<ClbvAnalystRow,
  'fullTaiRate' | 'fullTaiAvgGoals' | 'fullN' |
  'h1TaiRate' | 'h1TaiAvgGoals' | 'h1N' |
  'h2TaiRate' | 'h2TaiAvgGoals' | 'h2N' |
  'h2XiuRate' | 'h2XiuAvgGoals' |
  'rungH1Rate' | 'rungH1AvgGoals' | 'rungH1N' |
  'rungH2Rate' | 'rungH2AvgGoals' | 'rungH2N'
>;

const GROUPS: { label: string; rateLabel: string; rate: MetricKey; avg: MetricKey; n: MetricKey }[] = [
  { label: 'Cả trận', rateLabel: 'Tài%', rate: 'fullTaiRate', avg: 'fullTaiAvgGoals', n: 'fullN' },
  { label: 'Hiệp 1', rateLabel: 'Tài%', rate: 'h1TaiRate', avg: 'h1TaiAvgGoals', n: 'h1N' },
  { label: 'Hiệp 2 · Tài', rateLabel: 'Tài%', rate: 'h2TaiRate', avg: 'h2TaiAvgGoals', n: 'h2N' },
  { label: 'Hiệp 2 · Xỉu', rateLabel: 'Xỉu%', rate: 'h2XiuRate', avg: 'h2XiuAvgGoals', n: 'h2N' },
  { label: 'Rung H1', rateLabel: '%', rate: 'rungH1Rate', avg: 'rungH1AvgGoals', n: 'rungH1N' },
  { label: 'Rung H2', rateLabel: '%', rate: 'rungH2Rate', avg: 'rungH2AvgGoals', n: 'rungH2N' },
];

export default function ClbvAnalyst() {
  const [rows, setRows] = useState<ClbvAnalystRow[]>([]);
  const [windowDays, setWindowDays] = useState<number>(7);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const j: ListResponse = await fetch('/api/clbv-analyst', { cache: 'no-store' }).then((r) => r.json());
      if (!j.ok) { setErr(j.error || 'Lỗi tải dữ liệu'); return; }
      setRows(j.rows ?? []);
      setWindowDays(j.windowDays ?? 7);
      setUpdatedAt(j.updatedAt ?? null);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    (async () => { setLoading(true); await load(); setLoading(false); })();
  }, [load]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setMsg(null);
    setErr(null);
    try {
      const j: SyncResponse = await fetch('/api/clbv-analyst/sync', { method: 'POST' }).then((r) => r.json());
      if (!j.ok) {
        setErr(j.error || 'Đồng bộ thất bại');
      } else {
        setMsg(`✅ Đã đồng bộ ${j.teams ?? 0} đội`);
        await load();
      }
    } catch (e) {
      setErr(String(e));
    }
    setSyncing(false);
  }, [load]);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-col overflow-hidden">
      <div className="mb-3 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold text-white">🏟️ CLBV Analyst — Thiên hướng Tài/Xỉu &amp; Rung</h1>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-md border border-[#38bdf8]/60 bg-[#38bdf8]/15 px-3 py-1.5 text-[12px] font-semibold text-[#7dd3fc] transition hover:bg-[#38bdf8]/25 disabled:opacity-50"
          >
            {syncing && <Spinner size={13} />}
            {syncing ? 'Đang đồng bộ…' : '🔄 Đồng bộ (Sync)'}
          </button>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-[#9ca3af]">
          Chỉ tính riêng giải <b>Câu Lạc Bộ</b> (20 phút, tên đội thật — Marseille, Arsenal, Barcelona…),
          KHÔNG gộp với giải 16p/20p (S/V) thông thường. Mỗi đội tính trên các trận (sân nhà + sân khách)
          trong <b>{windowDays} ngày gần nhất</b>.
        </p>
        <p className="mt-1 text-[11px] text-[#666]">
          {updatedAt ? `Cập nhật lúc ${fmtTime(updatedAt)} (${windowDays} ngày gần nhất)` : 'Chưa có dữ liệu — bấm Đồng bộ để tính lần đầu'}
        </p>
        {msg && <div className="mt-2 rounded-md border border-[#2a2a2a] bg-[#141414] px-3 py-1.5 text-[12px] text-[#d4d4d4]">{msg}</div>}
        {err && <div className="mt-2 rounded-md border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-1.5 text-[12px] text-[#fca5a5]">{err}</div>}
      </div>

      {loading ? (
        <LoadingState label="Đang tải…" />
      ) : rows.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#141414] text-[#666]">
          <div className="text-3xl">📭</div>
          <div className="text-[13px]">Chưa có dữ liệu — bấm &quot;Đồng bộ (Sync)&quot; để tính lần đầu</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[#2a2a2a]">
          <table className="w-full whitespace-nowrap text-[12px]">
            <thead className="sticky top-0 z-10 bg-[#1a1a1a] text-[10px] uppercase text-[#888]">
              <tr>
                <th rowSpan={2} className="sticky left-0 z-20 bg-[#1a1a1a] px-2 py-2 text-left align-bottom">Tên đội</th>
                {GROUPS.map((g) => (
                  <th key={g.label} colSpan={3} className="border-l border-[#2a2a2a] px-2 py-1.5 text-center">{g.label}</th>
                ))}
              </tr>
              <tr>
                {GROUPS.map((g) => (
                  <Fragment key={g.label}>
                    <th className="border-l border-[#2a2a2a] px-2 py-1.5 text-right">{g.rateLabel}</th>
                    <th className="px-2 py-1.5 text-right">TB bàn</th>
                    <th className="px-2 py-1.5 text-right">n</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teamId} className="border-t border-[#222] hover:bg-white/[.03]">
                  <td className="sticky left-0 z-10 bg-[#0d0d0d] px-2 py-1.5 font-semibold text-white">{r.teamName}</td>
                  {GROUPS.map((g) => (
                    <Fragment key={g.label}>
                      <td className="border-l border-[#222] px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: rateColor(r[g.rate] as number | null) }}>
                        {pct(r[g.rate] as number | null)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#e5c893]">
                        {goals(r[g.avg] as number | null)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#9ca3af]">
                        {n(r[g.n] as number | null)}
                      </td>
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
