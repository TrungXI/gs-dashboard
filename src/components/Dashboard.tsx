'use client';

import { useMemo, useState, useEffect, useCallback, useRef, startTransition } from 'react';
import type { Match } from '../types/match';
import type { VoltaMatch } from '../types/voltaMatch';
import SearchDropdown from './SearchDropdown';
import DataTable from './DataTable';
import Analysis from './Analysis';
import UpdateDrawer from './UpdateDrawer';
import VoltaTable from './VoltaTable';
import VoltaUpdateDrawer from './VoltaUpdateDrawer';
import VoltaAnalysis from './VoltaAnalysis';
import GSPatternReport from './GSPatternReport';
import GSLive from './GSLive';
import { ALL_VOLTA_MATCHES, apiToVoltaRow } from '../lib/processVoltaData';
import { apiToRow, sortMatchesDesc, vnTodayIso } from '../lib/matchUtils';

type View = 'data' | 'report' | 'gs-pattern' | 'gs-live' | 'volta' | 'volta-analysis';
type FType = 'all' | '20p' | '16p';

const LS_MATCHES = 'gs_matches';
const LS_VOLTA = 'volta_matches';
const LS_VOLTA_AT = 'volta_updated_at';
const LS_UI = 'gs_ui_state';

function loadUiState() {
  try {
    const s = localStorage.getItem(LS_UI);
    if (!s) return null;
    return JSON.parse(s) as {
      view?: View; fType?: FType; fDate?: string; fTeam?: string;
      r1?: string; r2?: string; h1Filter?: string;
    };
  } catch { return null; }
}

export default function Dashboard({ initialMatches }: { initialMatches: Match[] }) {
  const [matches, setMatches] = useState<Match[]>(initialMatches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [voltaMatches, setVoltaMatches] = useState<VoltaMatch[]>(ALL_VOLTA_MATCHES);
  const [voltaDrawerOpen, setVoltaDrawerOpen] = useState(false);
  const [voltaUpdatedAt, setVoltaUpdatedAt] = useState<string | null>(null);
  const [quickFetching, setQuickFetching] = useState(false);
  const [voltaQuickFetching, setVoltaQuickFetching] = useState(false);

  // Restore UI state from localStorage immediately (SSR-safe: default first, apply on mount)
  const [view, setView] = useState<View>('data');
  const [fType, setFType] = useState<FType>('all');
  const [fDate, setFDate] = useState('all');
  const [fTeam, setFTeam] = useState('all');
  const [r1, setR1] = useState('');
  const [r2, setR2] = useState('');
  const [h1Filter, setH1Filter] = useState('all');
  const uiRestored = useRef(false);

  // Persist UI state — debounced to avoid writing on every keystroke
  const lsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!uiRestored.current) return;
    if (lsTimer.current) clearTimeout(lsTimer.current);
    lsTimer.current = setTimeout(() => {
      localStorage.setItem(LS_UI, JSON.stringify({ view, fType, fDate, fTeam, r1, r2, h1Filter }));
    }, 300);
    return () => { if (lsTimer.current) clearTimeout(lsTimer.current); };
  }, [view, fType, fDate, fTeam, r1, r2, h1Filter]);

  // Load cached data from localStorage on mount
  useEffect(() => {
    // Restore UI position first
    const ui = loadUiState();
    if (ui) {
      if (ui.view) setView(ui.view);
      if (ui.fType) setFType(ui.fType);
      if (ui.fDate) setFDate(ui.fDate);
      if (ui.fTeam) setFTeam(ui.fTeam);
      if (ui.r1 != null) setR1(ui.r1);
      if (ui.r2 != null) setR2(ui.r2);
      if (ui.h1Filter) setH1Filter(ui.h1Filter);
    }
    uiRestored.current = true;
    // Version 3: renamed team suffixes (V)→(20), (S)→(16)
    const DATA_VERSION = '3';
    if (localStorage.getItem('gs_data_version') !== DATA_VERSION) {
      localStorage.removeItem(LS_MATCHES);
      localStorage.removeItem('gs_updated_at');
      localStorage.setItem('gs_data_version', DATA_VERSION);
    }
    try {
      const saved = localStorage.getItem(LS_MATCHES);
      if (saved) {
        const parsed = JSON.parse(saved) as Match[];
        if (parsed.length > 0) {
          setMatches(sortMatchesDesc(parsed));
          setUpdatedAt(localStorage.getItem('gs_updated_at'));
        }
      }
    } catch { /* ignore */ }
    try {
      const savedVolta = localStorage.getItem(LS_VOLTA);
      if (savedVolta) {
        const parsed = JSON.parse(savedVolta) as VoltaMatch[];
        if (parsed.length > 0) {
          setVoltaMatches(parsed);
          setVoltaUpdatedAt(localStorage.getItem(LS_VOLTA_AT));
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Load the shared, cross-session data from Supabase on mount. Supabase is the
  // authoritative store (persists across users/browsers), so when it has data we
  // process the raw items through the existing pipeline and use them as-is.
  useEffect(() => {
    async function loadFromSupabase() {
      // GS
      try {
        const res = await fetch('/api/gs-cache');
        const json = (await res.json()) as {
          ok: boolean;
          data?: Record<string, unknown[]>;
          updatedAt?: string;
        };
        if (json.ok && json.data && Object.keys(json.data).length > 0) {
          const rows = sortMatchesDesc(
            Object.values(json.data)
              .flat()
              .map((m) => apiToRow(m as Record<string, unknown>)),
          );
          if (rows.length > 0) {
            setMatches(rows);
            localStorage.setItem(LS_MATCHES, JSON.stringify(rows));
            if (json.updatedAt) {
              const at = new Date(json.updatedAt).toLocaleString('vi-VN');
              localStorage.setItem('gs_updated_at', at);
              setUpdatedAt(at);
            }
          }
        }
      } catch { /* Supabase unavailable — keep bundled/localStorage data */ }

      // Volta
      try {
        const res = await fetch('/api/volta-cache');
        const json = (await res.json()) as {
          ok: boolean;
          data?: Record<string, unknown>[];
          updatedAt?: string;
        };
        if (json.ok && json.data && json.data.length > 0) {
          const rows = json.data.map(apiToVoltaRow);
          if (rows.length > 0) {
            setVoltaMatches(rows);
            localStorage.setItem(LS_VOLTA, JSON.stringify(rows));
            if (json.updatedAt) {
              const at = new Date(json.updatedAt).toLocaleString('vi-VN');
              localStorage.setItem(LS_VOLTA_AT, at);
              setVoltaUpdatedAt(at);
            }
          }
        }
      } catch { /* Supabase unavailable — keep bundled/localStorage data */ }
    }

    loadFromSupabase();
  }, []);

  const handleUpdate = useCallback((newMatches: Match[]) => {
    const now = new Date().toLocaleString('vi-VN');
    localStorage.setItem('gs_updated_at', now);
    setUpdatedAt(now);
    setMatches(newMatches);
  }, []);

  const handleVoltaUpdate = useCallback((newMatches: VoltaMatch[]) => {
    setVoltaMatches(newMatches);
    setVoltaUpdatedAt(localStorage.getItem(LS_VOLTA_AT));
  }, []);

  const quickFetchGS = useCallback(async () => {
    if (quickFetching) return;
    setQuickFetching(true);
    try {
      const token = localStorage.getItem('gs_token') ?? '69-6aed7dc417eb4882d88c6899ae3c0ae1';
      // Use Vietnam local date (UTC+7), not the host/browser date — otherwise after
      // 17:00 UTC we'd fetch "tomorrow" before midnight Vietnam time.
      const dateStr = vnTodayIso();
      const res = await fetch('/api/fetch-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, dates: [dateStr] }),
      });
      const json = await res.json() as { ok: boolean; data?: Record<string, unknown[]> };
      if (json.ok && json.data) {
        const newRaw = Object.values(json.data).flat();
        const newRows = newRaw.map(r => apiToRow(r as Record<string, unknown>));
        if (newRows.length > 0) {
          setMatches(prev => {
            const existing = prev.filter(m => !newRows.some(n => n.time === m.time && n.homeTeam === m.homeTeam));
            return sortMatchesDesc([...existing, ...newRows]);
          });
          const now = new Date().toLocaleString('vi-VN');
          localStorage.setItem('gs_updated_at', now);
          setUpdatedAt(now);
        }
      }
    } catch { /* silent */ } finally {
      setQuickFetching(false);
    }
  }, [quickFetching]);

  const quickFetchVolta = useCallback(async () => {
    if (voltaQuickFetching) return;
    setVoltaQuickFetching(true);
    try {
      const token = localStorage.getItem('gs_token') ?? '69-6aed7dc417eb4882d88c6899ae3c0ae1';
      const res = await fetch('/api/fetch-volta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json() as { ok: boolean; data?: Record<string, unknown>[] };
      if (json.ok && json.data) {
        const newRows = json.data.map(r => apiToVoltaRow(r));
        const now = new Date().toLocaleString('vi-VN');
        localStorage.setItem(LS_VOLTA_AT, now);
        setVoltaMatches(newRows);
        setVoltaUpdatedAt(now);
      }
    } catch { /* silent */ } finally {
      setVoltaQuickFetching(false);
    }
  }, [voltaQuickFetching]);

  const teams = useMemo(
    () => [...new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam]))].sort(),
    [matches],
  );

  const dateCounts = useMemo(() => {
    return matches.reduce<Record<string, number>>((acc, m) => {
      acc[m.date] = (acc[m.date] || 0) + 1;
      return acc;
    }, {});
  }, [matches]);

  const dates = useMemo(() => {
    const parse = (s: string) => {
      const [d, mo, y] = s.split('/');
      return new Date(+y, +mo - 1, +d).getTime();
    };
    return Object.keys(dateCounts).sort((a, b) => parse(b) - parse(a));
  }, [dateCounts]);

  const count20 = useMemo(() => matches.filter((m) => m.matchType === '20p').length, [matches]);
  const count16 = useMemo(() => matches.filter((m) => m.matchType === '16p').length, [matches]);

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      if (fType !== 'all' && m.matchType !== fType) return false;
      if (fDate !== 'all' && m.date !== fDate) return false;
      if (fTeam !== 'all' && m.homeTeam !== fTeam && m.awayTeam !== fTeam) return false;
      return true;
    });
  }, [matches, fType, fDate, fTeam]);

  // H1 score options derived from actual data, sorted by frequency
  const h1Options = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of matches) {
      const key = `${m.h1Home}–${m.h1Away}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => {
        // sort by total goals desc, then frequency desc
        const [aH, aA] = a[0].split('–').map(Number);
        const [bH, bA] = b[0].split('–').map(Number);
        const aTot = aH + aA, bTot = bH + bA;
        if (aTot !== bTot) return aTot - bTot;
        return b[1] - a[1];
      })
      .map(([score, count]) => ({ value: score, label: `${score}  (${count} trận)` }));
  }, [matches]);

  // Matches filtered by H1 score for the analysis/report view
  const analysisMatches = useMemo(() => {
    if (h1Filter === 'all') return matches;
    const [h1H, h1A] = h1Filter.split('–');
    return matches.filter((m) => m.h1Home === h1H && m.h1Away === h1A);
  }, [matches, h1Filter]);

  const teamOptions = teams.map((t) => ({ value: t, label: t }));
  const dataTeamOptions = [{ value: 'all', label: '-- Tất cả đội --' }, ...teamOptions];
  const reportTeamOptions = [{ value: '', label: '-- Chọn đội --' }, ...teamOptions];

  const typeChips: [FType, string][] = [
    ['all', 'Tất cả'],
    ['20p', `20p (${count20})`],
    ['16p', `16p (${count16})`],
  ];

  return (
    <>
      <div className="flex h-screen overflow-hidden bg-[#0d0d0d]">
        {/* Sidebar */}
        <aside className="flex w-[260px] flex-shrink-0 flex-col bg-[#111] text-white">
          {/* Logo */}
          <div className="flex items-center gap-3 border-b border-white/10 px-4 pb-3.5 pt-[18px]">
            <div className="text-2xl">⚽</div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold">GS Matches</div>
              <div className="mt-0.5 text-[11px] text-white/40 truncate">
                {dates.length > 0
                  ? `${dates[dates.length - 1]}–${dates[0]} · ${matches.length} trận`
                  : `${matches.length} trận`}
              </div>
            </div>
            {/* Quick fetch today */}
            <button
              onClick={quickFetchGS}
              disabled={quickFetching}
              className="flex-shrink-0 rounded-md bg-white/[.08] px-2 py-1.5 text-[11px] text-white/60 hover:bg-[#4ade80]/20 hover:text-[#4ade80] transition-colors disabled:opacity-40"
              title="Cập nhật nhanh hôm nay"
            >
              {quickFetching ? '…' : '⚡'}
            </button>
            {/* Update drawer */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex-shrink-0 rounded-md bg-white/[.08] px-2 py-1.5 text-[11px] text-white/60 hover:bg-[#17a2b8]/20 hover:text-[#17a2b8] transition-colors"
              title="Chọn ngày cập nhật"
            >
              ↻
            </button>
          </div>

          {/* Updated at indicator */}
          {updatedAt && (
            <div className="border-b border-white/5 px-4 py-1.5 text-[10px] text-[#4ade80]/70">
              ✓ Cập nhật {updatedAt}
            </div>
          )}

          {/* Nav */}
          <nav className="flex flex-col">
            {(
              [
                ['data', '📋', 'GS Dữ liệu'],
                ['report', '📊', 'GS Phân tích'],
                ['gs-pattern', '🔍', 'GS Pattern'],
                ['gs-live', '🔴', 'GS Live'],
                ['volta', '⚡', 'Volta'],
                ['volta-analysis', '🔍', 'Volta Phân tích'],
              ] as [View, string, string][]
            ).map(([v, icon, label]) => (
              <div
                key={v}
                onClick={() => setView(v)}
                className={`flex cursor-pointer items-center gap-2 border-l-[3px] px-5 py-2.5 text-[13px] font-semibold transition-all ${
                  view === v
                    ? 'border-[#17a2b8] bg-white/[.12] text-white'
                    : 'border-transparent text-white/60 hover:bg-white/[.08] hover:text-white'
                }`}
              >
                <span>{icon}</span> {label}
              </div>
            ))}
          </nav>

          {/* Filters */}
          <div className="flex-1 overflow-y-auto pb-4">
            {view === 'volta' || view === 'volta-analysis' ? (
              <div className="px-4 pt-3.5">
                <div className="rounded-lg bg-white/[.04] px-3.5 py-3 text-[12px] text-white/50">
                  <div className="text-[#4ade80] font-bold mb-1">⚡ {voltaMatches.length} trận</div>
                  {voltaUpdatedAt && (
                    <div className="text-[10px] text-[#4ade80]/60">✓ Cập nhật {voltaUpdatedAt}</div>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={quickFetchVolta}
                    disabled={voltaQuickFetching}
                    className="flex-1 rounded-lg bg-[#4ade80]/10 px-3 py-2 text-[12px] font-semibold text-[#4ade80] hover:bg-[#4ade80]/20 transition-colors disabled:opacity-40"
                  >
                    {voltaQuickFetching ? '…' : '⚡ Nhanh'}
                  </button>
                  <button
                    onClick={() => setVoltaDrawerOpen(true)}
                    className="flex-1 rounded-lg bg-[#17a2b8]/20 px-3 py-2 text-[12px] font-semibold text-[#17a2b8] hover:bg-[#17a2b8]/30 transition-colors"
                  >
                    ↻ Chọn
                  </button>
                </div>
              </div>
            ) : view === 'data' ? (
              <>
                <div className="px-4 pt-3.5">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/35">
                    Loại trận
                  </div>
                  <div className="flex gap-1.5">
                    {typeChips.map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => startTransition(() => setFType(v))}
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
                </div>

                <div className="px-4 pt-3.5">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/35">
                    Ngày
                  </div>
                  <select
                    value={fDate}
                    onChange={(e) => { const v = e.target.value; startTransition(() => setFDate(v)); }}
                    className="w-full rounded-lg bg-white/[.07] px-3 py-2 text-xs text-white outline-none"
                  >
                    <option value="all" className="bg-[#111] text-white">
                      📅 Tất cả ngày
                    </option>
                    {dates.map((d) => (
                      <option key={d} value={d} className="bg-[#111] text-white">
                        {d} ({dateCounts[d]} trận)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="px-4 pt-3.5">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/35">
                    Đội bóng
                  </div>
                  <SearchDropdown
                    options={dataTeamOptions}
                    value={fTeam}
                    onChange={setFTeam}
                    placeholder="-- Tất cả đội --"
                  />
                </div>

                <div className="mx-4 mt-4 text-xs text-white/50">
                  <span className="mr-1 text-lg font-bold text-white">{filtered.length}</span> /{' '}
                  {matches.length} trận
                </div>
              </>
            ) : view === 'report' ? (
              <div className="px-4 pt-3.5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/35">
                  Chọn đội phân tích
                </div>
                <div className="mb-0.5 text-[11px] text-white/45">Đội 1</div>
                <SearchDropdown
                  options={reportTeamOptions}
                  value={r1}
                  onChange={setR1}
                  placeholder="-- Chọn đội 1 --"
                />
                <div className="mb-0.5 mt-2.5 text-[11px] text-white/45">Đội 2</div>
                <SearchDropdown
                  options={reportTeamOptions}
                  value={r2}
                  onChange={setR2}
                  placeholder="-- Chọn đội 2 --"
                />
                <div className="mt-4 border-t border-white/10 pt-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/35">
                    Lọc tỉ số H1
                  </div>
                  <select
                    value={h1Filter}
                    onChange={(e) => setH1Filter(e.target.value)}
                    className="w-full rounded-lg bg-white/[.07] px-3 py-2 text-xs text-white outline-none"
                  >
                    <option value="all" className="bg-[#111] text-white">
                      Tất cả tỉ số H1
                    </option>
                    {h1Options.map((o) => (
                      <option key={o.value} value={o.value} className="bg-[#111] text-white">
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {h1Filter !== 'all' && (
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-[#fbbf24]">
                        H1 {h1Filter} → {analysisMatches.length} trận
                      </span>
                      <button
                        onClick={() => setH1Filter('all')}
                        className="text-[10px] text-[#17a2b8] hover:text-white"
                      >
                        Xóa
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto bg-[#0d0d0d] p-6">
          {view === 'volta' ? (
            <>
              <div className="mb-5 flex items-baseline gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-white">⚡ Volta Matches</h1>
                <span className="text-[13px] text-[#666]">{voltaMatches.length} trận mới nhất</span>
              </div>
              <VoltaTable matches={voltaMatches} />
            </>
          ) : view === 'volta-analysis' ? (
            <>
              <div className="mb-5 flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-white">🔍 Volta — Phân tích mẫu hình</h1>
                <span className="text-[13px] text-[#666]">{voltaMatches.length} trận</span>
                <button
                  onClick={() => setVoltaDrawerOpen(true)}
                  className="ml-auto rounded-lg bg-[#17a2b8]/20 px-3 py-1.5 text-[12px] font-semibold text-[#17a2b8] hover:bg-[#17a2b8]/30 transition-colors"
                >
                  ↻ Cập nhật
                </button>
              </div>
              <VoltaAnalysis matches={voltaMatches} />
            </>
          ) : view === 'data' ? (
            <>
              <div className="mb-5 flex items-baseline gap-3">
                <h1 className="text-xl font-bold text-white">Kết quả trận đấu</h1>
                <span className="text-[13px] text-[#666]">{filtered.length} trận</span>
              </div>
              <DataTable matches={filtered} />
            </>
          ) : view === 'gs-pattern' ? (
            <>
              <div className="mb-5 flex items-baseline gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-white">🔍 GS — Phân tích mẫu tỉ số</h1>
                <span className="text-[13px] text-[#666]">{matches.length} trận</span>
              </div>
              <GSPatternReport matches={matches} />
            </>
          ) : view === 'gs-live' ? (
            <GSLive />
          ) : (
            <>
              <div className="mb-5 flex items-baseline gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-white">Phân tích đối đầu &amp; Form</h1>
                <span className="text-[13px] text-[#666]">
                  {dates.length > 0 ? `${dates[dates.length - 1]}–${dates[0]}` : 'Dữ liệu'}
                </span>
                {h1Filter !== 'all' && (
                  <span className="rounded-md bg-[#fbbf24]/15 px-2 py-0.5 text-[12px] font-semibold text-[#fbbf24]">
                    H1 = {h1Filter}
                  </span>
                )}
              </div>
              {r1 && r2 && r1 !== r2 ? (
                <Analysis matches={analysisMatches} t1={r1} t2={r2} />
              ) : (
                <div className="flex h-[300px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
                  <div className="mb-4 text-5xl">📊</div>
                  <div className="text-[15px] text-[#888]">
                    Chọn 2 đội ở menu bên trái để xem thống kê
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* GS Update Drawer */}
      {drawerOpen && (
        <UpdateDrawer
          dateCounts={dateCounts}
          onUpdate={handleUpdate}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {/* Volta Update Drawer */}
      {voltaDrawerOpen && (
        <VoltaUpdateDrawer
          currentMatches={voltaMatches}
          onUpdate={handleVoltaUpdate}
          onClose={() => setVoltaDrawerOpen(false)}
        />
      )}
    </>
  );
}
