'use client';

import { useMemo, useState, useEffect, useCallback, useRef, startTransition } from 'react';
import type { Match } from '../types/match';
import type { VoltaMatch } from '../types/voltaMatch';
import SearchDropdown from './SearchDropdown';
import DataTable from './DataTable';
import UpdateDrawer from './UpdateDrawer';
import VoltaTable from './VoltaTable';
import VoltaUpdateDrawer from './VoltaUpdateDrawer';
import VoltaAnalysis from './VoltaAnalysis';
import GSLive from './GSLive';
import { ALL_VOLTA_MATCHES, apiToVoltaRow } from '../lib/processVoltaData';
import { apiToRow, sortMatchesDesc, vnTodayIso } from '../lib/matchUtils';

type View = 'data' | 'gs-live' | 'volta' | 'volta-analysis';
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
  const uiRestored = useRef(false);

  const theme = 'dark';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [autoRefreshGS, setAutoRefreshGS] = useState(true);
  const [gsCountdown, setGsCountdown] = useState<number | null>(null); // seconds to next auto-fetch
  const autoRefreshGSRef = useRef(false);
  const quickFetchGSRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const gsAutoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gsCountdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, [theme]);

  // Persist UI state — debounced to avoid writing on every keystroke
  const lsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!uiRestored.current) return;
    if (lsTimer.current) clearTimeout(lsTimer.current);
    lsTimer.current = setTimeout(() => {
      localStorage.setItem(LS_UI, JSON.stringify({ view, fType, fDate, fTeam }));
    }, 300);
    return () => { if (lsTimer.current) clearTimeout(lsTimer.current); };
  }, [view, fType, fDate, fTeam]);

  // Load cached data from localStorage on mount
  useEffect(() => {
    // Restore UI position first
    const ui = loadUiState();
    if (ui) {
      if (ui.view) setView(ui.view);
      if (ui.fType) setFType(ui.fType);
      if (ui.fDate) setFDate(ui.fDate);
      if (ui.fTeam) setFTeam(ui.fTeam);
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

  const scheduleGsAutoRefresh = useCallback(() => {
    if (gsAutoTimer.current) clearTimeout(gsAutoTimer.current);
    if (gsCountdownTimer.current) clearInterval(gsCountdownTimer.current);
    if (!autoRefreshGSRef.current) { setGsCountdown(null); return; }

    const SECS = 5 * 60;
    setGsCountdown(SECS);
    let remaining = SECS;
    gsCountdownTimer.current = setInterval(() => {
      remaining -= 1;
      setGsCountdown(remaining > 0 ? remaining : 0);
    }, 1000);

    gsAutoTimer.current = setTimeout(async () => {
      if (gsCountdownTimer.current) clearInterval(gsCountdownTimer.current);
      await quickFetchGSRef.current();
      // reschedule if still active
      if (autoRefreshGSRef.current) scheduleGsAutoRefresh();
    }, SECS * 1000);
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

  // Keep refs in sync
  useEffect(() => { quickFetchGSRef.current = quickFetchGS; }, [quickFetchGS]);
  useEffect(() => { autoRefreshGSRef.current = autoRefreshGS; }, [autoRefreshGS]);

  // Toggle auto-refresh: start or stop the schedule
  useEffect(() => {
    if (autoRefreshGS) {
      scheduleGsAutoRefresh();
    } else {
      if (gsAutoTimer.current) clearTimeout(gsAutoTimer.current);
      if (gsCountdownTimer.current) clearInterval(gsCountdownTimer.current);
      setGsCountdown(null);
    }
    return () => {
      if (gsAutoTimer.current) clearTimeout(gsAutoTimer.current);
      if (gsCountdownTimer.current) clearInterval(gsCountdownTimer.current);
    };
  }, [autoRefreshGS, scheduleGsAutoRefresh]);

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

  const teamOptions = teams.map((t) => ({ value: t, label: t }));
  const dataTeamOptions = [{ value: 'all', label: '-- Tất cả đội --' }, ...teamOptions];

  const typeChips: [FType, string][] = [
    ['all', 'Tất cả'],
    ['20p', `20p (${count20})`],
    ['16p', `16p (${count16})`],
  ];

  return (
    <>
      <div className={`flex h-screen overflow-hidden ${theme === 'dark' ? 'bg-[#0d0d0d]' : 'bg-gray-100'}`}>
        {/* Sidebar */}
        <aside
          className={`gs-sidebar flex flex-shrink-0 flex-col overflow-hidden transition-all duration-200 ${sidebarCollapsed ? 'w-[48px]' : 'w-[260px]'} ${theme === 'dark' ? 'bg-[#111] text-white' : 'bg-white text-gray-900 border-r border-gray-200'}`}
          onMouseEnter={() => setSidebarCollapsed(false)}
          onMouseLeave={() => setSidebarCollapsed(true)}
        >
          {sidebarCollapsed ? (
            /* Icon-only collapsed mode */
            <div className="flex flex-col h-full items-center py-2 gap-0.5">
              {(
                [
                  ['data', '📋', 'GS Dữ liệu'],
                  ['gs-live', '🔴', 'GS Live'],
                  ['volta', '⚡', 'Volta'],
                  ['volta-analysis', '🔍', 'Volta Phân tích'],
                ] as [View, string, string][]
              ).map(([v, icon, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  title={label}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all ${
                    view === v
                      ? theme === 'dark' ? 'bg-white/[.15] text-white' : 'bg-[#17a2b8]/15 text-[#17a2b8]'
                      : theme === 'dark' ? 'text-white/50 hover:bg-white/[.08] hover:text-white' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                >
                  {icon}
                </button>
              ))}
              <div className="flex-1" />
            </div>
          ) : (
            /* Expanded full sidebar */
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Logo */}
              <div className={`flex items-center gap-3 border-b px-4 pb-3.5 pt-[18px] ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                <div className="text-2xl">⚽</div>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold">GS Matches</div>
                  <div className="mt-0.5 text-[11px] text-white/40 truncate">
                    {dates.length > 0
                      ? `${dates[dates.length - 1]}–${dates[0]} · ${matches.length} trận`
                      : `${matches.length} trận`}
                  </div>
                </div>
                <button
                  onClick={quickFetchGS}
                  disabled={quickFetching}
                  className={`flex-shrink-0 rounded-md px-2 py-1.5 text-[11px] transition-colors disabled:opacity-40 hover:text-[#4ade80] hover:bg-[#4ade80]/20 ${theme === 'dark' ? 'bg-white/[.08] text-white/60' : 'bg-black/[.06] text-gray-500'}`}
                  title="Cập nhật nhanh hôm nay"
                >
                  {quickFetching ? '…' : '⚡'}
                </button>
                <button
                  onClick={() => setDrawerOpen(true)}
                  className={`flex-shrink-0 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-[#17a2b8]/20 hover:text-[#17a2b8] ${theme === 'dark' ? 'bg-white/[.08] text-white/60' : 'bg-black/[.06] text-gray-500'}`}
                  title="Chọn ngày cập nhật"
                >
                  ↻
                </button>
              </div>

              {/* Updated at + auto-refresh status */}
              <div className={`border-b px-4 py-1.5 flex items-center gap-2 ${theme === 'dark' ? 'border-white/5' : 'border-gray-100'}`}>
                {updatedAt && (
                  <span className="text-[10px] text-[#4ade80]/70 flex-1 truncate">
                    ✓ {updatedAt}
                    {autoRefreshGS && gsCountdown != null && (
                      <span className="text-[#fbbf24]/70 ml-1">
                        · {Math.floor(gsCountdown / 60)}:{String(gsCountdown % 60).padStart(2, '0')}
                      </span>
                    )}
                  </span>
                )}
                <button
                  onClick={() => setAutoRefreshGS(v => !v)}
                  title={autoRefreshGS ? 'Tắt tự động cập nhật (mỗi 5p)' : 'Bật tự động cập nhật mỗi 5 phút'}
                  className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                    autoRefreshGS
                      ? 'bg-[#4ade80]/20 text-[#4ade80]'
                      : theme === 'dark' ? 'bg-white/[.06] text-white/40 hover:text-white/60' : 'bg-black/[.05] text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {autoRefreshGS ? '⏱ ON' : '⏱ OFF'}
                </button>
              </div>

              {/* Nav */}
              <nav className="flex flex-col">
                {(
                  [
                    ['data', '📋', 'GS Dữ liệu'],
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
                        ? theme === 'dark'
                          ? 'border-[#17a2b8] bg-white/[.12] text-white'
                          : 'border-[#17a2b8] bg-[#17a2b8]/10 text-[#17a2b8]'
                        : theme === 'dark'
                          ? 'border-transparent text-white/60 hover:bg-white/[.08] hover:text-white'
                          : 'border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    <span>{icon}</span> {label}
                  </div>
                ))}
              </nav>

              {/* Filters */}
              <div className="flex-1 overflow-y-auto pb-4">
                {(view === 'volta' || view === 'volta-analysis') && (
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
                )}
              </div>

            </div>
          )}
        </aside>

        {/* Main */}
        <main className={`gs-main flex-1 overflow-y-auto p-6 ${theme === 'dark' ? 'bg-[#0d0d0d]' : 'bg-gray-100'}`}>
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
              <div className="mb-4 flex flex-wrap items-center gap-2.5">
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
                <select
                  value={fDate}
                  onChange={(e) => { const v = e.target.value; startTransition(() => setFDate(v)); }}
                  className="rounded-lg bg-white/[.07] px-3 py-2 text-xs text-white outline-none"
                >
                  <option value="all" className="bg-[#111] text-white">📅 Tất cả ngày</option>
                  {dates.map((d) => (
                    <option key={d} value={d} className="bg-[#111] text-white">
                      {d} ({dateCounts[d]} trận)
                    </option>
                  ))}
                </select>
                <div className="w-52">
                  <SearchDropdown
                    options={dataTeamOptions}
                    value={fTeam}
                    onChange={setFTeam}
                    placeholder="-- Tất cả đội --"
                  />
                </div>
                <span className="text-xs text-white/50 ml-auto">
                  <span className="mr-1 text-base font-bold text-white">{filtered.length}</span>/{matches.length} trận
                </span>
              </div>
              <div className="mb-5 flex items-baseline gap-3">
                <h1 className="text-xl font-bold text-white">Kết quả trận đấu</h1>
              </div>
              <DataTable matches={filtered} highlightTeam={fTeam !== 'all' ? fTeam : undefined} />
            </>
          ) : (
            <GSLive />
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
