'use client';

import { useMemo, useState } from 'react';
import type { Match } from '../types/match';
import SearchDropdown from './SearchDropdown';
import DataTable from './DataTable';
import Analysis from './Analysis';

type View = 'data' | 'report';
type FType = 'all' | '20p' | '16p';

export default function Dashboard({ matches }: { matches: Match[] }) {
  const [view, setView] = useState<View>('data');
  const [fType, setFType] = useState<FType>('all');
  const [fDate, setFDate] = useState('all');
  const [fTeam, setFTeam] = useState('all');
  const [r1, setR1] = useState('');
  const [r2, setR2] = useState('');
  const [analyzed, setAnalyzed] = useState(false);

  const teams = useMemo(
    () =>
      [...new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam]))].sort(),
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

  const count20 = useMemo(
    () => matches.filter((m) => m.matchType === '20p').length,
    [matches],
  );
  const count16 = useMemo(
    () => matches.filter((m) => m.matchType === '16p').length,
    [matches],
  );

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      if (fType !== 'all' && m.matchType !== fType) return false;
      if (fDate !== 'all' && m.date !== fDate) return false;
      if (fTeam !== 'all' && m.homeTeam !== fTeam && m.awayTeam !== fTeam)
        return false;
      return true;
    });
  }, [matches, fType, fDate, fTeam]);

  const teamOptions = teams.map((t) => ({ value: t, label: t }));
  const dataTeamOptions = [
    { value: 'all', label: '-- Tất cả đội --' },
    ...teamOptions,
  ];
  const reportTeamOptions = [
    { value: '', label: '-- Chọn đội --' },
    ...teamOptions,
  ];

  const typeChips: [FType, string][] = [
    ['all', 'Tất cả'],
    ['20p', `20p (${count20})`],
    ['16p', `16p (${count16})`],
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#f0f2f5]">
      {/* Sidebar */}
      <aside className="flex w-[260px] flex-shrink-0 flex-col bg-[#1a1a2e] text-white">
        {/* Logo */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 pb-3.5 pt-[18px]">
          <div className="text-2xl">⚽</div>
          <div>
            <div className="text-base font-bold">GS Matches</div>
            <div className="mt-0.5 text-[11px] text-white/45">
              05–11/07/2026 · {matches.length} trận
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col">
          {(
            [
              ['data', '📋', 'Dữ liệu'],
              ['report', '📊', 'Phân tích'],
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

        {/* Filters / picker */}
        <div className="flex-1 overflow-y-auto pb-4">
          {view === 'data' ? (
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
                  <option value="all" className="bg-[#1a1a2e] text-white">
                    📅 Tất cả ngày
                  </option>
                  {dates.map((d) => (
                    <option
                      key={d}
                      value={d}
                      className="bg-[#1a1a2e] text-white"
                    >
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
                <span className="mr-1 text-lg font-bold text-white">
                  {filtered.length}
                </span>{' '}
                / {matches.length} trận
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
              <div className="mb-0.5 mt-2.5 text-[11px] text-white/45">
                Đội 2
              </div>
              <SearchDropdown
                options={reportTeamOptions}
                value={r2}
                onChange={setR2}
                placeholder="-- Chọn đội 2 --"
              />
              <button
                onClick={() => setAnalyzed(true)}
                className="mt-3.5 w-full rounded-lg bg-[#17a2b8] px-3 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[#138496]"
              >
                📊 Xem thống kê
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
        {view === 'data' ? (
          <>
            <div className="mb-5 flex items-baseline gap-3">
              <h1 className="text-xl font-bold text-[#1a1a2e]">
                Kết quả trận đấu
              </h1>
              <span className="text-[13px] text-[#888]">
                {filtered.length} trận
              </span>
            </div>
            <DataTable matches={filtered} />
          </>
        ) : (
          <>
            <div className="mb-5 flex items-baseline gap-3">
              <h1 className="text-xl font-bold text-[#1a1a2e]">
                Phân tích đối đầu &amp; Form
              </h1>
              <span className="text-[13px] text-[#888]">
                Dữ liệu 05–11/07/2026
              </span>
            </div>
            {analyzed && r1 && r2 && r1 !== r2 ? (
              <Analysis matches={matches} t1={r1} t2={r2} />
            ) : (
              <div className="flex h-[300px] flex-col items-center justify-center rounded-xl bg-white shadow-sm">
                <div className="mb-4 text-5xl">📊</div>
                <div className="text-[15px] text-[#888]">
                  Chọn 2 đội ở menu bên trái rồi nhấn{' '}
                  <strong>Xem thống kê</strong>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
