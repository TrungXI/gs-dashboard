'use client';

import { useCallback, useEffect, useState } from 'react';
import { Spinner } from './Spinner';

// ── Response shape (mirror /api/gs-tx-report — SPEC §3.2) ───────────────────
interface TxReportRow {
  id: number; calcVersion: string;
  entryAt: string;          // ISO
  eventId: number; homeTeam: string; awayTeam: string;
  market: 'h1' | 'ft'; side: 'tai' | 'xiu';
  line: number; lineRaw: string | null; price: number; pModel: number; edge: number | null;
  kind: 'primary' | 'nhoi'; prevLine: number | null;
  scoredAtEntry: number; finalTotal: number | null;
  result: 'win' | 'lose' | 'push' | null; pnl: number | null;
}
interface TxAggLine { bets: number; win: number; lose: number; push: number; winRate: number | null; pnl: number; }
interface TxVersionAgg {
  calcVersion: string;
  primaryOnly: TxAggLine;   // kind='primary' only
  withNhoi: TxAggLine;      // primary + nhoi combined
  nhoiOnly: TxAggLine;      // kind='nhoi' only
}
interface TxReportResponse {
  ok: boolean;
  versions: string[];              // all distinct calc_version, latest-first
  selectedVersion: string | 'all';
  rows: TxReportRow[];             // detail, entry_at DESC, capped by limit
  summaryByVersion: TxVersionAgg[]; // GROUP BY calc_version — always ALL versions
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// entryAt ISO → giờ VN (UTC+7) "HH:mm" (pattern +7h → getUTC*, như matchUtils.ts).
function vnTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

const winRatePct = (wr: number | null): string => (wr == null ? '—' : `${Math.round(wr * 100)}%`);
const pnlStr = (v: number): string => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
const pnlColor = (v: number): string => (v > 0 ? '#4ade80' : v < 0 ? '#fb7185' : '#8a8a8a');

// ── Kèo label (colored Tài/Xỉu) ──────────────────────────────────────────────
function KeoLabel({ market, side }: { market: 'h1' | 'ft'; side: 'tai' | 'xiu' }) {
  const tai = side === 'tai';
  return (
    <span className="font-semibold">
      <span className="text-[#777]">{market === 'h1' ? 'H1' : 'FT'} </span>
      <span style={{ color: tai ? '#4ade80' : '#fb7185' }}>{tai ? 'Tài' : 'Xỉu'}</span>
    </span>
  );
}

// ── KQ cell (✅/❌/➖/⏳ + pnl) ────────────────────────────────────────────────
function KqCell({ result, pnl }: { result: TxReportRow['result']; pnl: number | null }) {
  if (result === 'win') return <span style={{ color: '#4ade80' }}>✅ +{(pnl ?? 0).toFixed(2)}</span>;
  if (result === 'lose') return <span style={{ color: '#fb7185' }}>❌ −1</span>;
  if (result === 'push') return <span style={{ color: '#8a8a8a' }}>➖ 0</span>;
  return <span style={{ color: '#9ca3af' }}>⏳</span>;
}

function NhoiBadge({ kind, prevLine }: { kind: 'primary' | 'nhoi'; prevLine: number | null }) {
  if (kind !== 'nhoi') return <span className="text-[#555]">—</span>;
  return (
    <span className="rounded bg-[#38bdf8]/15 border border-[#38bdf8]/40 px-1.5 py-0.5 text-[10px] font-semibold text-[#38bdf8]">
      🔁 nhồi (&gt;{prevLine ?? '—'})
    </span>
  );
}

export default function TxReport() {
  const [selected, setSelected] = useState<string>('all'); // '' = latest (server default)
  const [data, setData] = useState<TxReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (version: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = version ? `?version=${encodeURIComponent(version)}` : '';
      const res = await fetch(`/api/gs-tx-report${q}`, { cache: 'no-store' });
      const json = (await res.json()) as TxReportResponse & { error?: string };
      if (!json.ok) throw new Error(json.error || 'Lỗi tải báo cáo');
      setData(json);
      // Sync selector with the version the server actually resolved (latest → concrete).
      setSelected(json.selectedVersion);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load = latest (empty version). Selector changes refetch.
  useEffect(() => { load(''); }, [load]);

  const onSelect = (v: string) => {
    setSelected(v);
    load(v);
  };

  const versions = data?.versions ?? [];
  const summary = data?.summaryByVersion ?? [];
  const rows = data?.rows ?? [];
  const selAgg = summary.find((s) => s.calcVersion === selected);

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* Header + version selector */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">💰 Báo cáo Tài/Xỉu (paper)</h1>
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded-lg bg-white/[.07] px-3 py-2 text-xs text-white outline-none"
        >
          <option value="all" className="bg-[#111] text-white">Tất cả</option>
          {versions.map((v) => (
            <option key={v} value={v} className="bg-[#111] text-white">{v}</option>
          ))}
        </select>
        {loading && <Spinner size={14} />}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[13px] text-[#f87171]">
          {error}
        </div>
      )}

      {!error && !loading && rows.length === 0 && summary.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="mb-3 text-4xl">⏳</div>
          <div className="text-[14px] text-[#888]">Chưa có kèo nào</div>
        </div>
      ) : (
        <>
          {/* ── So sánh version (luôn tất cả version) ── */}
          <div className="mb-6">
            <div className="mb-2 text-[12px] md:text-[13px] font-semibold text-[#fbbf24]">So sánh version</div>
            <div className="overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#141414]">
              <table className="w-full text-left text-[12px] md:text-[13px] tabular-nums">
                <thead>
                  <tr className="border-b border-[#2a2a2a] text-[#888]">
                    <th className="px-3 py-2 font-semibold">Version</th>
                    <th className="px-3 py-2 font-semibold">Kèo</th>
                    <th className="px-3 py-2 font-semibold">W/L/P</th>
                    <th className="px-3 py-2 font-semibold">WinRate</th>
                    <th className="px-3 py-2 font-semibold">PnL</th>
                    <th className="px-3 py-2 font-semibold">+Nhồi</th>
                    <th className="px-3 py-2 font-semibold">WinRate (nhồi)</th>
                    <th className="px-3 py-2 font-semibold">PnL (nhồi)</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr
                      key={s.calcVersion}
                      className={`border-b border-[#222] ${s.calcVersion === selected ? 'bg-[#38bdf8]/10' : ''}`}
                    >
                      <td className="px-3 py-2 font-semibold text-white">{s.calcVersion}</td>
                      <td className="px-3 py-2 text-[#bbb]">{s.primaryOnly.bets}</td>
                      <td className="px-3 py-2 text-[#bbb]">{s.primaryOnly.win}/{s.primaryOnly.lose}/{s.primaryOnly.push}</td>
                      <td className="px-3 py-2 text-[#bbb]">{winRatePct(s.primaryOnly.winRate)}</td>
                      <td className="px-3 py-2 font-semibold" style={{ color: pnlColor(s.primaryOnly.pnl) }}>{pnlStr(s.primaryOnly.pnl)}</td>
                      <td className="px-3 py-2 text-[#bbb]">{s.nhoiOnly.bets}</td>
                      <td className="px-3 py-2 text-[#bbb]">{winRatePct(s.withNhoi.winRate)}</td>
                      <td className="px-3 py-2 font-semibold" style={{ color: pnlColor(s.withNhoi.pnl) }}>{pnlStr(s.withNhoi.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Tổng (version đang chọn): primary vs +nhồi ── */}
          {selAgg && (
            <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                ['Primary', selAgg.primaryOnly],
                ['Có nhồi', selAgg.withNhoi],
              ] as [string, TxAggLine][]).map(([label, a]) => (
                <div key={label} className="rounded-lg border border-[#2a2a2a] bg-[#141414] p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#777]">{label}</div>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px] tabular-nums">
                    <span className="text-[#888]">Kèo <span className="font-bold text-white">{a.bets}</span></span>
                    <span className="text-[#888]">W/L/P <span className="font-bold text-white">{a.win}/{a.lose}/{a.push}</span></span>
                    <span className="text-[#888]">WinRate <span className="font-bold text-white">{winRatePct(a.winRate)}</span></span>
                    <span className="text-[#888]">PnL <span className="font-bold" style={{ color: pnlColor(a.pnl) }}>{pnlStr(a.pnl)}</span></span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Chi tiết kèo ── */}
          <div className="mb-2 text-[12px] md:text-[13px] font-semibold text-[#fbbf24]">
            Chi tiết {selected === 'all' ? '(tất cả version)' : selected}
          </div>

          {rows.length === 0 ? (
            <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-6 text-center text-[13px] text-[#888]">
              Chưa có kèo nào
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#141414] md:block">
                <table className="w-full text-left text-[13px] tabular-nums">
                  <thead>
                    <tr className="border-b border-[#2a2a2a] text-[#888]">
                      <th className="px-3 py-2 font-semibold">Giờ VN</th>
                      <th className="px-3 py-2 font-semibold">Trận</th>
                      <th className="px-3 py-2 font-semibold">Kèo</th>
                      <th className="px-3 py-2 font-semibold">Line</th>
                      <th className="px-3 py-2 font-semibold">Giá</th>
                      <th className="px-3 py-2 font-semibold">P</th>
                      <th className="px-3 py-2 font-semibold">Tổng cuối</th>
                      <th className="px-3 py-2 font-semibold">KQ</th>
                      <th className="px-3 py-2 font-semibold">Nhồi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={`border-b border-[#222] ${r.kind === 'nhoi' ? 'bg-[#38bdf8]/[.04]' : ''}`}>
                        <td className="px-3 py-2 text-[#bbb]">{vnTime(r.entryAt)}</td>
                        <td className="px-3 py-2">
                          <span style={{ color: '#4ade80' }}>{r.homeTeam}</span>
                          <span className="text-[#555]"> vs </span>
                          <span style={{ color: '#fb7185' }}>{r.awayTeam}</span>
                        </td>
                        <td className="px-3 py-2"><KeoLabel market={r.market} side={r.side} /></td>
                        <td className="px-3 py-2 text-[#bbb]">{r.lineRaw ?? r.line}</td>
                        <td className="px-3 py-2 text-[#bbb]">{r.price.toFixed(2)}</td>
                        <td className="px-3 py-2 text-[#bbb]">{Math.round(r.pModel * 100)}%</td>
                        <td className="px-3 py-2 text-[#bbb]">{r.finalTotal ?? '—'}</td>
                        <td className="px-3 py-2 font-semibold"><KqCell result={r.result} pnl={r.pnl} /></td>
                        <td className="px-3 py-2"><NhoiBadge kind={r.kind} prevLine={r.prevLine} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile/tablet card list */}
              <div className="flex flex-col gap-2 md:hidden">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className={`rounded-lg border p-3 ${r.kind === 'nhoi' ? 'border-[#38bdf8]/40 bg-[#38bdf8]/[.06] ml-3' : 'border-[#2a2a2a] bg-[#141414]'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 text-[13px] font-semibold truncate">
                        <span style={{ color: '#4ade80' }}>{r.homeTeam}</span>
                        <span className="text-[#555]"> vs </span>
                        <span style={{ color: '#fb7185' }}>{r.awayTeam}</span>
                      </div>
                      <span className="shrink-0 text-[11px] text-[#888] tabular-nums">{vnTime(r.entryAt)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px] tabular-nums">
                      <KeoLabel market={r.market} side={r.side} />
                      <span className="text-[#888]">line <span className="text-[#bbb]">{r.lineRaw ?? r.line}</span></span>
                      <span className="text-[#888]">giá <span className="text-[#bbb]">{r.price.toFixed(2)}</span></span>
                      <span className="text-[#888]">P <span className="text-[#bbb]">{Math.round(r.pModel * 100)}%</span></span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums">
                      <span className="text-[#888]">Tổng cuối <span className="text-[#bbb]">{r.finalTotal ?? '—'}</span></span>
                      <span className="font-semibold"><KqCell result={r.result} pnl={r.pnl} /></span>
                      {r.kind === 'nhoi' && <NhoiBadge kind={r.kind} prevLine={r.prevLine} />}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
