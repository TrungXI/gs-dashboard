'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BetOutcome,
  BetStatsRow,
  BetStatsSummary,
  BetStatsSummaryLine,
  FilterOptions,
} from '../lib/gsMatchesDb';
import SearchDropdown from './SearchDropdown';
import { LoadingState, Spinner } from './Spinner';
import { TypeBadge } from './badges';

const PAGE_SIZE = 50;

const EMPTY_OPTIONS: FilterOptions = { dates: [], teams: [], count20: 0, count16: 0, total: 0 };

// Bangkok ISO weekday (1=Mon .. 7=Sun) → short Vietnamese label.
const WEEKDAY_LABEL: Record<number, string> = {
  1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN',
};

const WEEKDAY_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: '1', label: 'T2' },
  { value: '2', label: 'T3' },
  { value: '3', label: 'T4' },
  { value: '4', label: 'T5' },
  { value: '5', label: 'T6' },
  { value: '6', label: 'T7' },
  { value: '7', label: 'CN' },
];

interface BetStatsResponse {
  ok: boolean;
  rows?: BetStatsRow[];
  total?: number;
  summary?: BetStatsSummary;
  options?: FilterOptions;
  error?: string;
}

// ── formatting ────────────────────────────────────────────────────────────

function fmtLine(v: number | null): string {
  if (v === null) return '—';
  return v % 1 === 0 ? String(v) : String(v);
}

function fmtOdds(v: number | null): string {
  if (v === null) return '';
  return v.toFixed(2);
}

function fmtPnl(v: number | null): string {
  if (v === null) return '';
  const s = Math.round(v * 100) / 100;
  return `${s >= 0 ? '+' : ''}${s}`;
}

const OUTCOME_CLS: Record<'W' | 'L' | 'D', string> = {
  W: 'bg-[#14532d]/60 text-[#4ade80]',
  L: 'bg-[#450a0a]/60 text-[#f87171]',
  D: 'bg-[#451a03]/50 text-[#fbbf24]',
};

// A colored bet cell: the pick text, the outcome tint, and the +/- units.
function BetCell({
  label,
  result,
  pnl,
}: {
  label: string;
  result: BetOutcome;
  pnl: number | null;
}) {
  if (result === null) {
    return <span className="text-[#555]">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${OUTCOME_CLS[result]}`}
    >
      <span>{label}</span>
      <span className="font-bold tabular-nums">{fmtPnl(pnl)}</span>
    </span>
  );
}

function ScorePart({ my, opp }: { my: number; opp: number }) {
  const cls = my > opp ? 'text-[#4ade80]' : my < opp ? 'text-[#f87171]' : 'text-[#fbbf24]';
  return <span className={`font-bold ${cls}`}>{my}</span>;
}

// ── row helpers ───────────────────────────────────────────────────────────

function hcLabel(r: BetStatsRow): string {
  if (r.hcLine === null || r.hcFav === null) return '—';
  const fav = r.hcFav === 'home' ? r.homeTeam : r.awayTeam;
  return `${fav} -${fmtLine(r.hcLine)}`;
}

// ── summary footer ────────────────────────────────────────────────────────

function pct(v: number | null): string {
  if (v === null) return '—';
  return `${Math.round(v * 100)}%`;
}

function SummaryStat({ label, line }: { label: string; line: BetStatsSummaryLine }) {
  const pnlCls = line.pnl > 0 ? 'text-[#4ade80]' : line.pnl < 0 ? 'text-[#f87171]' : 'text-[#aaa]';
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#666]">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[18px] font-extrabold tabular-nums text-white leading-none">
          {pct(line.winRate)}
        </span>
        <span className="text-[11px] text-[#888]">
          {line.wins}/{line.wins + line.losses}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="text-[#888]">{line.n} kèo</span>
        <span className={`font-bold tabular-nums ${pnlCls}`}>{fmtPnl(line.pnl)}u</span>
      </div>
    </div>
  );
}

// ── view ──────────────────────────────────────────────────────────────────

export default function BetStatsTable({
  preset,
}: {
  // Optional deep-link from the H2H matrix: pre-seed the league + team pair.
  preset?: { type?: 'all' | '20p' | '16p'; team?: string; team2?: string } | null;
} = {}) {
  const [rows, setRows] = useState<BetStatsRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<BetStatsSummary | null>(null);
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fType, setFType] = useState<'all' | '20p' | '16p'>(preset?.type ?? 'all');
  const [fWeekday, setFWeekday] = useState('all');
  const [fTeam, setFTeam] = useState(preset?.team ?? 'all');
  const [fTeam2, setFTeam2] = useState(preset?.team2 ?? 'all');

  const reqRef = useRef(0);

  const load = useCallback(
    async (
      type: string,
      weekday: string,
      team: string,
      team2: string,
      offset: number,
      withOptions: boolean,
    ) => {
      const reqId = ++reqRef.current;
      const append = offset > 0;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      try {
        const p = new URLSearchParams({
          type,
          weekday,
          team,
          team2,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        if (withOptions) p.set('options', '1');
        const res = await fetch(`/api/gs-bet-stats?${p.toString()}`, { cache: 'no-store' });
        const json = (await res.json()) as BetStatsResponse;
        if (reqId !== reqRef.current) return;
        if (!json.ok) {
          if (!append) setRows([]);
          setError(json.error || 'Lỗi tải dữ liệu');
          return;
        }
        setTotal(json.total ?? 0);
        if (json.summary) setSummary(json.summary);
        if (json.options) setOptions(json.options);
        const next = json.rows ?? [];
        setRows((prev) => (append ? [...prev, ...next] : next));
      } catch (e) {
        if (reqId === reqRef.current && !append) setRows([]);
        if (reqId === reqRef.current) setError(String(e));
      } finally {
        if (reqId === reqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  // Fetch page 0 on mount + whenever a filter changes. Options ride along on
  // every page-0 load (cheap, and mirrors the gs-matches pattern) so a
  // StrictMode double-mount can't drop the team list.
  useEffect(() => {
    load(fType, fWeekday, fTeam, fTeam2, 0, true);
  }, [fType, fWeekday, fTeam, fTeam2, load]);

  // Keep the H2H pair valid: clear team2 if it collides with / outlives team.
  useEffect(() => {
    if (fTeam2 !== 'all' && (fTeam === 'all' || fTeam === fTeam2)) setFTeam2('all');
  }, [fTeam, fTeam2]);

  const teamOptions = useMemo(
    () => [
      { value: 'all', label: '-- Tất cả đội --' },
      ...options.teams.map((t) => ({ value: t, label: t })),
    ],
    [options.teams],
  );
  const team2Options = useMemo(
    () => [
      { value: 'all', label: '-- Đội đối đầu --' },
      ...options.teams.filter((t) => t !== fTeam).map((t) => ({ value: t, label: t })),
    ],
    [options.teams, fTeam],
  );

  const typeChips: ['all' | '20p' | '16p', string][] = [
    ['all', 'Tất cả'],
    ['20p', `20p (V)`],
    ['16p', `16p (S)`],
  ];

  const hasMore = rows.length < total;
  const loadMore = () => load(fType, fWeekday, fTeam, fTeam2, rows.length, false);

  // Column layout — shared between header and rows (desktop grid).
  const GRID =
    'grid grid-cols-[96px_54px_minmax(220px,1.6fr)_74px_74px_minmax(150px,1fr)_minmax(190px,1.3fr)_minmax(190px,1.3fr)_minmax(160px,1fr)_minmax(160px,1fr)] items-center gap-2';

  return (
    <>
      <h1 className="mb-4 text-[18px] font-extrabold">📊 Thống kê kèo</h1>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5 max-md:sticky max-md:top-0 max-md:z-30 max-md:-mx-3 max-md:px-3 max-md:py-2 max-md:bg-[#0d0d0d]/95 max-md:backdrop-blur max-md:border-b max-md:border-[#2a2a2a]">
        <div className="flex gap-1.5">
          {typeChips.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setFType(v)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                fType === v
                  ? 'bg-[#17a2b8] text-white'
                  : 'bg-white/10 text-white/65 hover:bg-white/20 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {WEEKDAY_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFWeekday(value)}
              className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                fWeekday === value
                  ? 'bg-[#17a2b8] text-white'
                  : 'bg-white/[.07] text-white/60 hover:bg-white/20 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="w-48">
          <SearchDropdown
            options={teamOptions}
            value={fTeam}
            onChange={setFTeam}
            placeholder="-- Tất cả đội --"
          />
        </div>
        <span className="text-xs font-semibold text-white/40">vs</span>
        <div className="w-48">
          <SearchDropdown
            options={team2Options}
            value={fTeam2}
            onChange={setFTeam2}
            placeholder="-- Đội đối đầu --"
          />
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-white/50">
          {loading && <Spinner size={13} />}
          <span>
            <span className="mr-1 text-base font-bold text-white">{total}</span>trận
          </span>
        </span>
      </div>

      {/* Summary footer (per bet type) — over the whole filtered set */}
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <SummaryStat label="Kèo chấp" line={summary.hc} />
          <SummaryStat label="Tài H1" line={summary.overH1} />
          <SummaryStat label="Xỉu H1" line={summary.underH1} />
          <SummaryStat label="Tài FT" line={summary.over} />
          <SummaryStat label="Xỉu FT" line={summary.under} />
          <SummaryStat label="Tài đầu H2" line={summary.h2Over} />
          <SummaryStat label="Xỉu đầu H2" line={summary.h2Under} />
        </div>
      )}

      {error !== null ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
          <div className="text-3xl">⚠️</div>
          <div className="text-[13px] text-[#f87171]">{error}</div>
          <button
            onClick={() => load(fType, fWeekday, fTeam, fTeam2, 0, false)}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20 hover:text-white"
          >
            Thử lại
          </button>
        </div>
      ) : loading && rows.length === 0 ? (
        <LoadingState label="Đang tải kèo…" className="py-24" />
      ) : rows.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
          <div className="mb-3 text-4xl">📭</div>
          <div className="text-[14px] text-[#888]">Không có trận phù hợp bộ lọc</div>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-[#2a2a2a]">
            <div className="min-w-[1320px]">
              {/* Header */}
              <div
                className={`${GRID} border-b border-[#222] bg-[#111] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[#666]`}
              >
                <div>Ngày</div>
                <div className="text-center">Giải</div>
                <div>Trận</div>
                <div className="text-center">H1</div>
                <div className="text-center">FT</div>
                <div>Kèo chấp</div>
                <div>Tài/Xỉu H1</div>
                <div>Tài/Xỉu FT</div>
                <div>Tài đầu H2</div>
                <div>Xỉu đầu H2</div>
              </div>

              {/* Rows */}
              {rows.map((r) => (
                <div
                  key={r.eventId}
                  className={`${GRID} border-b border-[#1a1a1a]/70 px-3 py-2.5 text-[12px] last:border-0 hover:bg-white/[.02]`}
                >
                  {/* Ngày + thứ */}
                  <div className="whitespace-nowrap text-[#999]">
                    <span className="mr-1 rounded bg-white/[.06] px-1 py-px text-[9px] font-bold text-[#8ee3f0]">
                      {WEEKDAY_LABEL[r.weekday] ?? '?'}
                    </span>
                    <span className="tabular-nums text-[11px]">{r.date}</span>
                  </div>

                  {/* Giải */}
                  <div className="text-center">
                    <TypeBadge type={r.matchType} />
                  </div>

                  {/* Trận */}
                  <div className="leading-snug text-[#ddd]">
                    <span className={r.ttHome > r.ttAway ? 'font-bold text-[#4ade80]' : ''}>
                      {r.homeTeam}
                    </span>
                    <span className="text-[#555]"> – </span>
                    <span className={r.ttAway > r.ttHome ? 'font-bold text-[#4ade80]' : ''}>
                      {r.awayTeam}
                    </span>
                  </div>

                  {/* H1 */}
                  <div className="whitespace-nowrap text-center tabular-nums text-[#bbb]">
                    <ScorePart my={r.h1Home} opp={r.h1Away} />
                    <span className="text-[#555]">–</span>
                    <ScorePart my={r.h1Away} opp={r.h1Home} />
                  </div>

                  {/* FT */}
                  <div className="whitespace-nowrap text-center tabular-nums">
                    <ScorePart my={r.ttHome} opp={r.ttAway} />
                    <span className="text-[#555]">–</span>
                    <ScorePart my={r.ttAway} opp={r.ttHome} />
                  </div>

                  {/* Kèo chấp */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] leading-tight text-[#999]">{hcLabel(r)}</span>
                    <BetCell label="Chấp" result={r.hcResult} pnl={r.hcPnl} />
                  </div>

                  {/* Tài/Xỉu H1 */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#999]">
                      {r.ouH1Line === null ? '—' : `line ${fmtLine(r.ouH1Line)}`}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      <BetCell label="Tài" result={r.overH1Result} pnl={r.overH1Pnl} />
                      <BetCell label="Xỉu" result={r.underH1Result} pnl={r.underH1Pnl} />
                    </div>
                  </div>

                  {/* Tài/Xỉu FT */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#999]">
                      {r.ouLine === null ? '—' : `line ${fmtLine(r.ouLine)}`}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      <BetCell label="Tài" result={r.overResult} pnl={r.overPnl} />
                      <BetCell label="Xỉu" result={r.underResult} pnl={r.underPnl} />
                    </div>
                  </div>

                  {/* Tài đầu H2 */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#999]">
                      {r.h2Line === null
                        ? '—'
                        : `Tài ${fmtLine(r.h2Line)} (${fmtOdds(r.h2OverOdds)})`}
                    </span>
                    <BetCell label="Tài H2" result={r.h2OverResult} pnl={r.h2OverPnl} />
                  </div>

                  {/* Xỉu đầu H2 */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#999]">
                      {r.h2Line === null
                        ? '—'
                        : `Xỉu ${fmtLine(r.h2Line)} (${fmtOdds(r.h2UnderOdds)})`}
                    </span>
                    <BetCell label="Xỉu H2" result={r.h2UnderResult} pnl={r.h2UnderPnl} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-2.5">
            {rows.map((r) => (
              <div key={r.eventId} className="rounded-lg border border-[#2a2a2a] bg-[#141414] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 text-[13px] leading-snug">
                    <span className={r.ttHome > r.ttAway ? 'font-bold text-[#4ade80]' : 'text-[#ddd]'}>
                      {r.homeTeam}
                    </span>
                    <span className="text-[#555]"> – </span>
                    <span className={r.ttAway > r.ttHome ? 'font-bold text-[#4ade80]' : 'text-[#ddd]'}>
                      {r.awayTeam}
                    </span>
                  </div>
                  <TypeBadge type={r.matchType} />
                </div>

                <div className="mt-1.5 flex items-center gap-2 text-[12px] tabular-nums text-[#bbb]">
                  <span className="rounded bg-white/[.06] px-1 py-px text-[9px] font-bold text-[#8ee3f0]">
                    {WEEKDAY_LABEL[r.weekday] ?? '?'}
                  </span>
                  <span className="text-[11px] text-[#999]">{r.date}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[#666]">H1</span>
                  <span>
                    {r.h1Home}–{r.h1Away}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[#666]">FT</span>
                  <span className="font-semibold text-[#ddd]">
                    {r.ttHome}–{r.ttAway}
                  </span>
                </div>

                <div className="mt-2.5 flex flex-col gap-2 border-t border-[#222] pt-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-24 text-[10px] font-bold uppercase text-[#555]">Chấp</span>
                    <span className="flex-1 text-[11px] text-[#999]">{hcLabel(r)}</span>
                    <BetCell label="Chấp" result={r.hcResult} pnl={r.hcPnl} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-24 text-[10px] font-bold uppercase text-[#555]">T/X H1</span>
                    <span className="flex-1 text-[11px] text-[#999]">
                      {r.ouH1Line === null ? '—' : `line ${fmtLine(r.ouH1Line)}`}
                    </span>
                    <div className="flex gap-1">
                      <BetCell label="Tài" result={r.overH1Result} pnl={r.overH1Pnl} />
                      <BetCell label="Xỉu" result={r.underH1Result} pnl={r.underH1Pnl} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-24 text-[10px] font-bold uppercase text-[#555]">T/X FT</span>
                    <span className="flex-1 text-[11px] text-[#999]">
                      {r.ouLine === null ? '—' : `line ${fmtLine(r.ouLine)}`}
                    </span>
                    <div className="flex gap-1">
                      <BetCell label="Tài" result={r.overResult} pnl={r.overPnl} />
                      <BetCell label="Xỉu" result={r.underResult} pnl={r.underPnl} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-24 text-[10px] font-bold uppercase text-[#555]">Tài H2</span>
                    <span className="flex-1 text-[11px] text-[#999]">
                      {r.h2Line === null ? '—' : `${fmtLine(r.h2Line)} (${fmtOdds(r.h2OverOdds)})`}
                    </span>
                    <BetCell label="Tài" result={r.h2OverResult} pnl={r.h2OverPnl} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-24 text-[10px] font-bold uppercase text-[#555]">Xỉu H2</span>
                    <span className="flex-1 text-[11px] text-[#999]">
                      {r.h2Line === null ? '—' : `${fmtLine(r.h2Line)} (${fmtOdds(r.h2UnderOdds)})`}
                    </span>
                    <BetCell label="Xỉu" result={r.h2UnderResult} pnl={r.h2UnderPnl} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#141414] px-4 py-2 text-[12px] font-semibold text-white/80 transition-colors hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingMore && <Spinner size={14} />}
                {loadingMore ? 'Đang tải…' : `Xem thêm (${rows.length}/${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
