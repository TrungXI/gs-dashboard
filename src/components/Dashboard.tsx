'use client';

import { useMemo, useState, useEffect, startTransition, useRef } from 'react';
import type { Match } from '../types/match';
import SearchDropdown from './SearchDropdown';
import DataTable from './DataTable';
import GSLive from './GSLive';
import Analysis from './Analysis';
import MatchAnalysis from './MatchAnalysis';
import { apiToRow, sortMatchesDesc } from '../lib/matchUtils';

type View = 'data' | 'gs-live' | 'report' | 'match-analysis';
type FType = 'all' | '20p' | '16p';

const LS_MATCHES = 'gs_matches';
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

  const [view, setView] = useState<View>('data');
  const [fType, setFType] = useState<FType>('all');
  const [fDate, setFDate] = useState('all');
  const [fTeam, setFTeam] = useState('all');
  const [r1, setR1] = useState('');
  const [r2, setR2] = useState('');
  const [h1Filter, setH1Filter] = useState('all');
  const uiRestored = useRef(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  // Persist UI state
  const lsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!uiRestored.current) return;
    if (lsTimer.current) clearTimeout(lsTimer.current);
    lsTimer.current = setTimeout(() => {
      localStorage.setItem(LS_UI, JSON.stringify({ view, fType, fDate, fTeam, r1, r2, h1Filter }));
    }, 300);
    return () => { if (lsTimer.current) clearTimeout(lsTimer.current); };
  }, [view, fType, fDate, fTeam, r1, r2, h1Filter]);

  useEffect(() => {
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
    const DATA_VERSION = '4';
    if (localStorage.getItem('gs_data_version') !== DATA_VERSION) {
      localStorage.removeItem(LS_MATCHES);
      localStorage.removeItem('gs_updated_at');
      localStorage.setItem('gs_data_version', DATA_VERSION);
    }
    try {
      const saved = localStorage.getItem(LS_MATCHES);
      if (saved) {
        const parsed = JSON.parse(saved) as Match[];
        if (parsed.length > 0) setMatches(sortMatchesDesc(parsed));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    async function loadFromSupabase() {
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
          }
        }
      } catch { /* Supabase unavailable */ }
    }
    loadFromSupabase();
  }, []);

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
  const reportTeamOptions = [{ value: '', label: '-- Chọn đội --' }, ...teamOptions];

  const h1Options = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of matches) {
      const key = `${m.h1Home}–${m.h1Away}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => {
        const [aH, aA] = a[0].split('–').map(Number);
        const [bH, bA] = b[0].split('–').map(Number);
        const aTot = aH + aA, bTot = bH + bA;
        if (aTot !== bTot) return aTot - bTot;
        return b[1] - a[1];
      })
      .map(([score, count]) => ({ value: score, label: `${score}  (${count} trận)` }));
  }, [matches]);

  const analysisMatches = useMemo(() => {
    if (h1Filter === 'all') return matches;
    const [h1H, h1A] = h1Filter.split('–');
    return matches.filter((m) => String(m.h1Home) === h1H && String(m.h1Away) === h1A);
  }, [matches, h1Filter]);

  const typeChips: [FType, string][] = [
    ['all', 'Tất cả'],
    ['20p', `20p (${count20})`],
    ['16p', `16p (${count16})`],
  ];

  const navItems: [View, string, string][] = [
    ['data', '📋', 'GS Dữ liệu'],
    ['gs-live', '🔴', 'GS Live'],
    ['report', '📊', 'GS Phân tích'],
    ['match-analysis', '📈', 'Phân Tích'],
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#0d0d0d]">
      {/* Sidebar */}
      <aside
        className={`gs-sidebar hidden md:flex flex-shrink-0 flex-col overflow-hidden transition-all duration-200 ${sidebarCollapsed ? 'w-[48px]' : 'w-[260px]'} bg-[#111] text-white`}
        onMouseEnter={() => setSidebarCollapsed(false)}
        onMouseLeave={() => setSidebarCollapsed(true)}
      >
        {sidebarCollapsed ? (
          <div className="flex flex-col h-full items-center py-2 gap-0.5">
            {navItems.map(([v, icon, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                title={label}
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all ${
                  view === v
                    ? 'bg-white/[.15] text-white'
                    : 'text-white/50 hover:bg-white/[.08] hover:text-white'
                }`}
              >
                {icon}
              </button>
            ))}
            <div className="flex-1" />
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
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
            </div>

            {/* Nav */}
            <nav className="flex flex-col">
              {navItems.map(([v, icon, label]) => (
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

            <div className="flex-1" />
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="gs-main flex-1 overflow-y-auto p-3 pb-[72px] md:p-6 md:pb-6 bg-[#0d0d0d]">
        {view === 'data' ? (
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
        ) : view === 'report' ? (
          <>
            <div className="mb-5 flex items-baseline gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-white">📊 Phân tích đối đầu &amp; Form</h1>
              <span className="text-[13px] text-[#666]">
                {dates.length > 0 ? `${dates[dates.length - 1]}–${dates[0]}` : 'Dữ liệu'}
              </span>
            </div>

            <div className="mb-5 flex flex-wrap items-end gap-4 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] px-4 py-3.5">
              <div className="min-w-[180px] flex-1">
                <div className="mb-1 text-[11px] text-white/45">Đội 1</div>
                <SearchDropdown
                  options={reportTeamOptions}
                  value={r1}
                  onChange={setR1}
                  placeholder="-- Chọn đội 1 --"
                />
              </div>
              <div className="min-w-[180px] flex-1">
                <div className="mb-1 text-[11px] text-white/45">Đội 2</div>
                <SearchDropdown
                  options={reportTeamOptions}
                  value={r2}
                  onChange={setR2}
                  placeholder="-- Chọn đội 2 --"
                />
              </div>
              <div className="min-w-[160px]">
                <div className="mb-1 text-[11px] text-white/45">Lọc tỉ số H1</div>
                <select
                  value={h1Filter}
                  onChange={(e) => setH1Filter(e.target.value)}
                  className="w-full rounded-lg bg-white/[.07] px-3 py-2 text-xs text-white outline-none"
                >
                  <option value="all" className="bg-[#111] text-white">Tất cả</option>
                  {h1Options.map((o) => (
                    <option key={o.value} value={o.value} className="bg-[#111] text-white">{o.label}</option>
                  ))}
                </select>
              </div>
              {h1Filter !== 'all' && (
                <div className="flex items-center gap-2 self-end pb-0.5">
                  <span className="rounded-md bg-[#fbbf24]/15 px-2 py-0.5 text-[12px] font-semibold text-[#fbbf24]">
                    H1 = {h1Filter} · {analysisMatches.length} trận
                  </span>
                  <button onClick={() => setH1Filter('all')} className="text-[10px] text-[#17a2b8] hover:text-white">Xóa</button>
                </div>
              )}
            </div>

            {r1 && r2 && r1 !== r2 ? (
              <Analysis matches={analysisMatches} t1={r1} t2={r2} />
            ) : (
              <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
                <div className="mb-3 text-4xl">📊</div>
                <div className="text-[14px] text-[#888]">Chọn 2 đội bên trên để xem thống kê</div>
              </div>
            )}
          </>
        ) : view === 'match-analysis' ? (
          <MatchAnalysis />
        ) : (
          <GSLive />
        )}
      </main>

      {/* Bottom nav — mobile only */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-14 md:hidden border-t border-[#2a2a2a] bg-[#111]">
        {navItems.map(([v, icon, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[16px] transition-colors ${
              view === v ? 'text-[#17a2b8]' : 'text-white/50'
            }`}
          >
            <span className="leading-none">{icon}</span>
            <span className="text-[9px] font-semibold leading-none">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
