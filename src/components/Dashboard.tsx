'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import type { Match } from '../types/match';
import type { VoltaMatch } from '../types/voltaMatch';
import SearchDropdown from './SearchDropdown';
import DataTable from './DataTable';
import Analysis from './Analysis';
import UpdateDrawer from './UpdateDrawer';
import VoltaTable from './VoltaTable';
import VoltaUpdateDrawer from './VoltaUpdateDrawer';
import { ALL_VOLTA_MATCHES } from '../lib/processVoltaData';

type View = 'data' | 'report' | 'volta';
type FType = 'all' | '20p' | '16p';

const LS_MATCHES = 'gs_matches';
const LS_VOLTA = 'volta_matches';
const LS_VOLTA_AT = 'volta_updated_at';

export default function Dashboard({ initialMatches }: { initialMatches: Match[] }) {
  const [matches, setMatches] = useState<Match[]>(initialMatches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [voltaMatches, setVoltaMatches] = useState<VoltaMatch[]>(ALL_VOLTA_MATCHES);
  const [voltaDrawerOpen, setVoltaDrawerOpen] = useState(false);
  const [voltaUpdatedAt, setVoltaUpdatedAt] = useState<string | null>(null);

  const [view, setView] = useState<View>('data');
  const [fType, setFType] = useState<FType>('all');
  const [fDate, setFDate] = useState('all');
  const [fTeam, setFTeam] = useState('all');
  const [r1, setR1] = useState('');
  const [r2, setR2] = useState('');
  const [h1Filter, setH1Filter] = useState('all');

  // Load cached data from localStorage on mount
  useEffect(() => {
    // Version 2: switched time format from 12h AM/PM to 24h; clear old cached data
    const DATA_VERSION = '2';
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
          setMatches(parsed);
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
            {/* Update button */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex-shrink-0 rounded-md bg-white/[.08] px-2 py-1.5 text-[11px] text-white/60 hover:bg-[#17a2b8]/20 hover:text-[#17a2b8] transition-colors"
              title="Cập nhật dữ liệu"
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
                ['volta', '⚡', 'Volta'],
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
            {view === 'volta' ? (
              <div className="px-4 pt-3.5">
                <div className="rounded-lg bg-white/[.04] px-3.5 py-3 text-[12px] text-white/50">
                  <div className="text-[#4ade80] font-bold mb-1">⚡ {voltaMatches.length} trận</div>
                  {voltaUpdatedAt && (
                    <div className="text-[10px] text-[#4ade80]/60">✓ Cập nhật {voltaUpdatedAt}</div>
                  )}
                </div>
                <button
                  onClick={() => setVoltaDrawerOpen(true)}
                  className="mt-3 w-full rounded-lg bg-[#17a2b8]/20 px-3 py-2 text-[12px] font-semibold text-[#17a2b8] hover:bg-[#17a2b8]/30 transition-colors"
                >
                  ↻ Cập nhật Volta
                </button>
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
                </div>

                <div className="px-4 pt-3.5">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/35">
                    Ngày
                  </div>
                  <select
                    value={fDate}
                    onChange={(e) => setFDate(e.target.value)}
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
            ) : (
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
            )}
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
          ) : view === 'data' ? (
            <>
              <div className="mb-5 flex items-baseline gap-3">
                <h1 className="text-xl font-bold text-white">Kết quả trận đấu</h1>
                <span className="text-[13px] text-[#666]">{filtered.length} trận</span>
              </div>
              <DataTable matches={filtered} />
            </>
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
          currentMatches={matches}
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
