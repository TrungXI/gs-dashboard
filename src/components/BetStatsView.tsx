'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AsianResult, GsReportResponse, GsReportRow } from '../app/api/gs-report/route';
import { LoadingState } from './Spinner';

// ── Result badge config ───────────────────────────────────────────────────────

const RESULT_META: Record<AsianResult, { label: string; cls: string }> = {
  win: { label: 'ĂN', cls: 'bg-[#22c55e]/15 border-[#22c55e]/40 text-[#4ade80]' },
  'half-win': { label: 'ĂN NỬA', cls: 'bg-[#84cc16]/15 border-[#84cc16]/40 text-[#bef264]' },
  push: { label: 'HÒA', cls: 'bg-white/[.06] border-white/15 text-[#aaa]' },
  'half-loss': { label: 'THUA NỬA', cls: 'bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#fbbf24]' },
  loss: { label: 'THUA', cls: 'bg-[#ef4444]/15 border-[#ef4444]/40 text-[#f87171]' },
  skip: { label: 'BỎ', cls: 'bg-white/[.03] border-white/10 text-[#666]' },
  pending: { label: '⏳ chờ', cls: 'bg-[#a78bfa]/10 border-[#a78bfa]/30 text-[#a78bfa]' },
};

function ResultBadge({ result }: { result: AsianResult }) {
  const m = RESULT_META[result];
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold border ${m.cls}`}>
      {m.label}
    </span>
  );
}

// ── Verdict reason parsing (mirrors GSLive KeoPanel) ──────────────────────────

function parseVerdictReasons(verdict: string | null): { hc: string | null; ou: string | null } {
  if (!verdict) return { hc: null, ou: null };
  const grab = (tag: string): string | null => {
    const re = new RegExp(`\\[${tag}\\][^:\\n]*::\\s*([^\\n]+)`);
    const m = verdict.match(re);
    return m ? m[1].trim() : null;
  };
  return { hc: grab('HC'), ou: grab('OU') };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseScore(s: string | null): [number, number] | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

/** FT winner: 'home' | 'away' | 'draw' | null. */
function ftWinner(ft: string | null): 'home' | 'away' | 'draw' | null {
  const s = parseScore(ft);
  if (!s) return null;
  if (s[0] > s[1]) return 'home';
  if (s[1] > s[0]) return 'away';
  return 'draw';
}

function pct(v: number | null): string {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

// ── Filters ───────────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'settled' | 'win' | 'loss' | 'skip';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'settled', label: 'Đã chấm' },
  { key: 'win', label: 'Ăn' },
  { key: 'loss', label: 'Thua' },
  { key: 'skip', label: 'BỎ' },
];

const WIN_SET: AsianResult[] = ['win', 'half-win'];
const LOSS_SET: AsianResult[] = ['loss', 'half-loss'];
const GRADED_SET: AsianResult[] = ['win', 'half-win', 'push', 'half-loss', 'loss'];

function rowMatchesFilter(row: GsReportRow, f: FilterKey): boolean {
  const results = [row.side_result, row.ou_result];
  switch (f) {
    case 'all':
      return true;
    case 'settled':
      return results.some((r) => GRADED_SET.includes(r));
    case 'win':
      return results.some((r) => WIN_SET.includes(r));
    case 'loss':
      return results.some((r) => LOSS_SET.includes(r));
    case 'skip':
      return results.some((r) => r === 'skip');
    default:
      return true;
  }
}

// ── Trend arrow ───────────────────────────────────────────────────────────────

function TrendArrow({ direction }: { direction: 'up' | 'down' | 'flat' | null }) {
  if (direction === 'up') return <span className="text-[#4ade80]">↑</span>;
  if (direction === 'down') return <span className="text-[#f87171]">↓</span>;
  if (direction === 'flat') return <span className="text-[#888]">→</span>;
  return <span className="text-[#555]">—</span>;
}

// ── Summary card ──────────────────────────────────────────────────────────────

function Card({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#666]">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold tabular-nums text-white leading-none">{value}</div>
      {sub != null && <div className="mt-1 text-[11px] text-[#888]">{sub}</div>}
    </div>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

export default function BetStatsView() {
  const [data, setData] = useState<GsReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/gs-report', { cache: 'no-store' });
        const json: GsReportResponse = await res.json();
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error || 'Không tải được dữ liệu');
        } else {
          setData(json);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = data?.rows ?? [];
  const filtered = useMemo(() => rows.filter((r) => rowMatchesFilter(r, filter)), [rows, filter]);

  // ── Loading ──
  if (data === null && error === null) {
    return (
      <>
        <h1 className="mb-4 text-[18px] font-extrabold">📊 Thống kê kèo</h1>
        <LoadingState label="Đang tải…" className="py-24" />
      </>
    );
  }

  // ── Error / empty ──
  if (error !== null || rows.length === 0) {
    return (
      <>
        <h1 className="mb-4 text-[18px] font-extrabold">📊 Thống kê kèo</h1>
        <div className="flex items-center justify-center py-24 text-[13px] text-[#666]">
          {error !== null ? `Lỗi tải dữ liệu: ${error}` : 'Chưa có kèo nào được ghi nhận'}
        </div>
      </>
    );
  }

  const summary = data!.summary!;
  const trend = data!.trend!;

  return (
    <>
      <h1 className="mb-4 text-[18px] font-extrabold">📊 Thống kê kèo</h1>

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Tổng kèo" value={summary.total} sub={`${summary.pending} chờ`} />
        <Card
          label="Ăn kèo chấp"
          value={pct(summary.side.winRate)}
          sub={`${summary.side.settled} kèo đã chấm`}
        />
        <Card
          label="Ăn Tài/Xỉu"
          value={pct(summary.ou.winRate)}
          sub={`${summary.ou.settled} kèo đã chấm`}
        />
        <Card
          label="Ăn nửa / Thua nửa"
          value={
            <span>
              <span className="text-[#bef264]">{summary.halfWin}</span>
              <span className="text-[#555]"> / </span>
              <span className="text-[#fbbf24]">{summary.halfLoss}</span>
            </span>
          }
        />
        <Card label="Số BỎ" value={summary.skipped} />
        <Card
          label="Xu hướng (20 gần)"
          value={
            <span className="inline-flex items-center gap-1.5">
              <TrendArrow direction={trend.direction} />
              <span>{pct(trend.last)}</span>
            </span>
          }
          sub={`trước: ${pct(trend.prev)}`}
        />
      </div>

      {/* Filter chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
              filter === key
                ? 'bg-[#17a2b8] text-white'
                : 'bg-white/[.06] text-white/60 hover:bg-white/[.12] hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-[#666]">{filtered.length} trận</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-[#2a2a2a]">
        <div className="min-w-[900px]">
          {/* Header */}
          <div className="grid grid-cols-[92px_minmax(180px,1.4fr)_88px_88px_minmax(150px,1fr)_150px_minmax(240px,1.6fr)] items-center gap-2 border-b border-[#222] bg-[#111] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[#666]">
            <div>Thời điểm</div>
            <div>Trận</div>
            <div className="text-center">Tỉ số ra kèo</div>
            <div className="text-center">Tỉ số cuối</div>
            <div>Kèo</div>
            <div>Kết quả</div>
            <div>Lý do &amp; đúc kết</div>
          </div>

          {/* Rows */}
          {filtered.map((row) => {
            const winner = ftWinner(row.ft_score);
            const { hc, ou } = parseVerdictReasons(row.verdict);
            const hasParsed = hc || ou;
            return (
              <div
                key={row.event_id}
                className="grid grid-cols-[92px_minmax(180px,1.4fr)_88px_88px_minmax(150px,1fr)_150px_minmax(240px,1.6fr)] items-start gap-2 border-b border-[#1a1a1a]/70 px-3 py-2.5 text-[12px] last:border-0 hover:bg-white/[.02]"
              >
                {/* Thời điểm */}
                <div className="tabular-nums text-[#999]">{fmtTime(row.created_at)}</div>

                {/* Trận */}
                <div className="leading-snug">
                  <span className={winner === 'home' ? 'font-bold text-[#4ade80]' : 'text-[#ddd]'}>
                    {row.home_team ?? '?'}
                  </span>
                  <span className="text-[#555]"> vs </span>
                  <span className={winner === 'away' ? 'font-bold text-[#4ade80]' : 'text-[#ddd]'}>
                    {row.away_team ?? '?'}
                  </span>
                </div>

                {/* Tỉ số ra kèo */}
                <div className="text-center tabular-nums text-[#bbb]">{row.ht_score ?? '—'}</div>

                {/* Tỉ số cuối */}
                <div className="text-center tabular-nums font-semibold text-[#ddd]">{row.ft_score ?? '—'}</div>

                {/* Kèo */}
                <div className="flex flex-col gap-1">
                  {row.side_pick && (
                    <span className="w-fit rounded bg-[#f59e0b]/15 border border-[#f59e0b]/40 px-1.5 py-0.5 text-[11px] font-bold text-[#fbbf24]">
                      {row.side_pick}
                    </span>
                  )}
                  {row.ou_pick && (
                    <span className="w-fit rounded bg-[#17a2b8]/15 border border-[#17a2b8]/40 px-1.5 py-0.5 text-[11px] font-bold text-[#5fd0e0]">
                      {row.ou_pick}
                    </span>
                  )}
                  {!row.side_pick && !row.ou_pick && <span className="text-[#555]">—</span>}
                </div>

                {/* Kết quả */}
                <div className="flex flex-col gap-1">
                  {row.side_pick && (
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[#555]">HC</span>
                      <ResultBadge result={row.side_result} />
                    </div>
                  )}
                  {row.ou_pick && (
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[#555]">T/X</span>
                      <ResultBadge result={row.ou_result} />
                    </div>
                  )}
                  {!row.side_pick && !row.ou_pick && <ResultBadge result="skip" />}
                </div>

                {/* Lý do & đúc kết */}
                <div className="flex flex-col gap-1 leading-snug text-[11px]">
                  {(row.side_pick || hc) && (
                    <div>
                      <span className="font-semibold text-[#666]">Chấp: </span>
                      {hc ? <span className="text-[#ccc]">{hc}</span> : <span className="text-[#555]">—</span>}
                    </div>
                  )}
                  {(row.ou_pick || ou) && (
                    <div>
                      <span className="font-semibold text-[#666]">Tài/Xỉu: </span>
                      {ou ? <span className="text-[#ccc]">{ou}</span> : <span className="text-[#555]">—</span>}
                    </div>
                  )}
                  {!hasParsed && row.verdict && (
                    <div className="text-[#bbb]">{row.verdict}</div>
                  )}
                  {row.review_note && (
                    <div className="mt-0.5 border-l-2 border-[#a78bfa]/40 pl-1.5 text-[#a78bfa]">
                      <span className="font-semibold text-[#8b6fd4]">Đúc kết: </span>
                      {row.review_note}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
