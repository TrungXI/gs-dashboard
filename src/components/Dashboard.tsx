'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import type { Match } from '../types/match';
import type { FilterOptions } from '../lib/gsMatchesDb';
import SearchDropdown from './SearchDropdown';
import DataTable from './DataTable';
import { LoadingState, Spinner } from './Spinner';
import GSLive from './GSLive';
import MatchAnalysis from './MatchAnalysis';
import BetStatsView from './BetStatsView';
import BetStatsTable from './BetStatsTable';
import H2HMatrix, { type OpenPairFn } from './H2HMatrix';
import TeamFormReport from './TeamFormReport';
import RankingLive from './RankingLive';

type View = 'data' | 'gs-live' | 'report' | 'match-analysis' | 'bet-stats' | 'bet-table' | 'h2h-matrix' | 'team-form';
type FType = 'all' | '20p' | '16p';

const LS_UI = 'gs_ui_state';

function loadUiState() {
  try {
    const s = localStorage.getItem(LS_UI);
    if (!s) return null;
    return JSON.parse(s) as {
      view?: View; fType?: FType; fDate?: string; fTeam?: string; fTeam2?: string;
    };
  } catch { return null; }
}

const EMPTY_OPTIONS: FilterOptions = { dates: [], teams: [], count20: 0, count16: 0, total: 0 };

export default function Dashboard({
  initialMatches,
  initialTotal,
  initialOptions,
  pageSize,
}: {
  initialMatches: Match[];
  initialTotal: number;
  initialOptions: FilterOptions | null;
  pageSize: number;
}) {
  // ── data view: server-driven page ──────────────────────────────────────
  const [dataMatches, setDataMatches] = useState<Match[]>(initialMatches);
  const [dataTotal, setDataTotal] = useState<number>(initialTotal);
  const [options, setOptions] = useState<FilterOptions>(initialOptions ?? EMPTY_OPTIONS);
  const [dataLoading, setDataLoading] = useState(false);      // full (filter change) reload
  const [loadingMore, setLoadingMore] = useState(false);      // append next page
  const [dataError, setDataError] = useState<string | null>(null);

  const [view, setView] = useState<View>('data');
  // Deep-link: eventId to auto-open in the routed view's drawer (consumed once).
  const [deepLinkMatch, setDeepLinkMatch] = useState<number | null>(null);
  const deepLinkConsumed = useRef(false);
  // Preset carried from the H2H matrix → bet-table (league + team pair). Keyed so
  // a fresh click always remounts BetStatsTable with the new pair.
  const [betTablePreset, setBetTablePreset] = useState<{ key: number; type: FType; team: string; team2: string } | null>(null);
  const openPairInBetTable = useCallback<OpenPairFn>((p) => {
    setBetTablePreset({ key: Date.now(), type: p.type, team: p.team, team2: p.team2 });
    setView('bet-table');
  }, []);
  const [fType, setFType] = useState<FType>('all');
  const [fDate, setFDate] = useState('all'); // 'all' | YYYY-MM-DD
  const [fTeam, setFTeam] = useState('all');
  const [fTeam2, setFTeam2] = useState('all'); // second team → head-to-head filter
  const uiRestored = useRef(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  // ── Deep-link (?view=live|keo&match=<eventId>) ──────────────────────────
  // Runs once on mount, BEFORE the localStorage UI-restore effect, so a shared
  // link wins over the persisted view. After consuming, strip the query params
  // so the URL is clean ("/") — F5 won't re-open the drawer.
  useEffect(() => {
    if (deepLinkConsumed.current) return;
    const params = new URLSearchParams(window.location.search);
    const vParam = params.get('view');
    const mParam = params.get('match');
    if (!vParam && !mParam) return;
    deepLinkConsumed.current = true;

    const targetView: View | null =
      vParam === 'live' ? 'gs-live' : vParam === 'keo' ? 'bet-stats' : null;
    if (targetView) setView(targetView);

    const eventId = mParam ? Number(mParam) : NaN;
    if (Number.isFinite(eventId)) setDeepLinkMatch(eventId);

    // Clean the URL back to "/" — consume the deep-link exactly once.
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist UI state
  const lsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!uiRestored.current) return;
    if (lsTimer.current) clearTimeout(lsTimer.current);
    lsTimer.current = setTimeout(() => {
      localStorage.setItem(LS_UI, JSON.stringify({ view, fType, fDate, fTeam, fTeam2 }));
    }, 300);
    return () => { if (lsTimer.current) clearTimeout(lsTimer.current); };
  }, [view, fType, fDate, fTeam, fTeam2]);

  // ── Fetch a server-filtered page. offset 0 replaces, >0 appends. ────────
  // `loadPageWith` takes explicit filters (used at mount before state settles);
  // `loadPage` uses the current filter state.
  const loadPageWith = useCallback(async (
    type: string, date: string, team: string, team2: string, offset: number, withOptions: boolean,
  ) => {
    const append = offset > 0;
    if (append) setLoadingMore(true); else setDataLoading(true);
    setDataError(null);
    try {
      const p = new URLSearchParams({
        type, date, team, team2, limit: String(pageSize), offset: String(offset),
      });
      if (withOptions) p.set('options', '1');
      const res = await fetch(`/api/gs-matches?${p.toString()}`);
      const json = (await res.json()) as {
        ok: boolean; matches?: Match[]; total?: number; options?: FilterOptions; error?: string;
      };
      if (!json.ok) throw new Error(json.error || 'Lỗi tải dữ liệu');
      const next = json.matches ?? [];
      setDataTotal(json.total ?? 0);
      if (json.options) setOptions(json.options);
      setDataMatches((prev) => (append ? [...prev, ...next] : next));
    } catch (e) {
      if (!append) setDataMatches([]);
      setDataError(e instanceof Error ? e.message : String(e));
    } finally {
      if (append) setLoadingMore(false); else setDataLoading(false);
    }
  }, [pageSize]);

  const loadPage = useCallback((offset: number, withOptions: boolean) =>
    loadPageWith(fType, fDate, fTeam, fTeam2, offset, withOptions),
  [loadPageWith, fType, fDate, fTeam, fTeam2]);

  const didInitialFetch = useRef(false);

  useEffect(() => {
    const ui = loadUiState();
    if (ui) {
      // A deep-link view (set above) takes precedence over the persisted view.
      if (ui.view && !deepLinkConsumed.current) setView(ui.view);
      if (ui.fType) setFType(ui.fType);
      if (ui.fDate) setFDate(ui.fDate);
      if (ui.fTeam) setFTeam(ui.fTeam);
      if (ui.fTeam2) setFTeam2(ui.fTeam2);
    }
    uiRestored.current = true;

    // If SSR gave us no data (DB was down at request time) OR the restored
    // filters are still the defaults, kick the initial page fetch here — the
    // filter-change effect below only fires *after* a filter actually changes.
    const rType = ui?.fType ?? 'all';
    const rDate = ui?.fDate ?? 'all';
    const rTeam = ui?.fTeam ?? 'all';
    const rTeam2 = ui?.fTeam2 ?? 'all';
    const isDefault = rType === 'all' && rDate === 'all' && rTeam === 'all' && rTeam2 === 'all';
    const ssrOk = initialMatches.length > 0 || !!initialOptions;
    if (isDefault && !ssrOk) {
      // Default filters but SSR failed → fetch page 0 now.
      loadPageWith('all', 'all', 'all', 'all', 0, true);
    } else if (isDefault && ssrOk) {
      // Default filters and SSR succeeded → SSR page 0 is already correct,
      // just mark the initial fetch as done so the filter effect doesn't skip
      // a legitimate later change.
      didInitialFetch.current = true;
    }
    // If restored filters are non-default, the setFType/… above schedule a
    // re-render; the filter-change effect then fires and fetches with them.

    // Clear dead keys from old versions
    ['gs_matches', 'gs_updated_at', 'volta_matches', 'volta_updated_at', 'gs_data_version'].forEach(k => localStorage.removeItem(k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch page 0 whenever filters change. The very first run (on mount, right
  // after the restore effect) is skipped — the restore effect already handled
  // the initial fetch (or SSR provided the default page).
  useEffect(() => {
    if (!uiRestored.current) return;
    if (!didInitialFetch.current) { didInitialFetch.current = true; return; }
    loadPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fType, fDate, fTeam, fTeam2]);

  // Periodically refresh page 0 (sync with collector poll) while on data view.
  useEffect(() => {
    if (view !== 'data') return;
    const id = setInterval(() => loadPage(0, true), 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [view, loadPage]);

  // Keep the H2H pair valid: if the first team is cleared or changed to the
  // same value as the second, drop the second team back to "all".
  useEffect(() => {
    if (fTeam2 !== 'all' && (fTeam === 'all' || fTeam === fTeam2)) setFTeam2('all');
  }, [fTeam, fTeam2]);

  const loadMore = useCallback(() => {
    if (loadingMore || dataMatches.length >= dataTotal) return;
    loadPage(dataMatches.length, false);
  }, [loadingMore, dataMatches.length, dataTotal, loadPage]);

  // ── Filter option lists (from server-computed options) ──────────────────
  const dataTeamOptions = useMemo(
    () => [{ value: 'all', label: '-- Tất cả đội --' }, ...options.teams.map((t) => ({ value: t, label: t }))],
    [options.teams],
  );

  // Second-team options for the head-to-head filter. Drop the team already
  // chosen in the first dropdown so the same team can't be picked twice.
  const dataTeam2Options = useMemo(
    () => [
      { value: 'all', label: '-- Đội đối đầu --' },
      ...options.teams.filter((t) => t !== fTeam).map((t) => ({ value: t, label: t })),
    ],
    [options.teams, fTeam],
  );

  const typeChips: [FType, string][] = [
    ['all', 'Tất cả'],
    ['20p', `20p (${options.count20})`],
    ['16p', `16p (${options.count16})`],
  ];

  const dates = options.dates; // for sidebar range label (DD/MM/YYYY labels)

  const navItems: [View, string, string][] = [
    ['data', '📋', 'GS Dữ liệu'],
    ['gs-live', '🔴', 'GS Live'],
    ['report', '🏆', 'Xếp hạng'],
    ['match-analysis', '📈', 'Phân Tích Kèo'],
    ['bet-stats', '📊', 'Thống kê kèo'],
    ['bet-table', '🧮', 'Bảng kèo per-trận'],
    ['h2h-matrix', '🔥', 'Ma trận Tài/Xỉu'],
    ['team-form', '🔄', 'Quy luật phong độ'],
  ];

  const sidebarRange = dates.length > 0
    ? `${dates[dates.length - 1].label}–${dates[0].label} · ${options.total} trận`
    : `${options.total} trận`;

  const hasMore = dataMatches.length < dataTotal;

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
                  {sidebarRange}
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
              <select
                value={fDate}
                onChange={(e) => setFDate(e.target.value)}
                className="rounded-lg bg-white/[.07] px-3 py-2 text-xs text-white outline-none"
              >
                <option value="all" className="bg-[#111] text-white">📅 Tất cả ngày</option>
                {dates.map((d) => (
                  <option key={d.date} value={d.date} className="bg-[#111] text-white">
                    {d.label} ({d.count} trận)
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
              <span className="text-xs font-semibold text-white/40">vs</span>
              <div className="w-52">
                <SearchDropdown
                  options={dataTeam2Options}
                  value={fTeam2}
                  onChange={setFTeam2}
                  placeholder="-- Đội đối đầu --"
                />
              </div>
              <span className="text-xs text-white/50 ml-auto flex items-center gap-1.5">
                {dataLoading && <Spinner size={13} />}
                <span>
                  <span className="mr-1 text-base font-bold text-white">{dataTotal}</span>trận
                </span>
              </span>
            </div>
            <div className="mb-5 flex items-baseline gap-3">
              <h1 className="text-xl font-bold text-white">Kết quả trận đấu</h1>
            </div>

            {dataError ? (
              <div className="flex h-[200px] flex-col items-center justify-center gap-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
                <div className="text-3xl">⚠️</div>
                <div className="text-[13px] text-[#f87171]">{dataError}</div>
                <button
                  onClick={() => loadPage(0, true)}
                  className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20 hover:text-white"
                >
                  Thử lại
                </button>
              </div>
            ) : dataLoading && dataMatches.length === 0 ? (
              <LoadingState label="Đang tải trận đấu…" />
            ) : dataMatches.length === 0 ? (
              <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
                <div className="mb-3 text-4xl">📭</div>
                <div className="text-[14px] text-[#888]">Không có trận đấu phù hợp bộ lọc</div>
              </div>
            ) : (
              <>
                <DataTable
                  matches={dataMatches}
                  highlightTeam={fTeam !== 'all' ? fTeam : undefined}
                  highlightTeam2={fTeam2 !== 'all' ? fTeam2 : undefined}
                />
                {hasMore && (
                  <div className="mt-4 flex justify-center">
                    <button
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="flex items-center gap-2 rounded-lg bg-white/[.08] px-4 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/[.16] hover:text-white disabled:opacity-60"
                    >
                      {loadingMore && <Spinner size={14} />}
                      {loadingMore
                        ? 'Đang tải…'
                        : `Xem thêm (${dataMatches.length}/${dataTotal})`}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        ) : view === 'report' ? (
          <RankingLive />
        ) : view === 'match-analysis' ? (
          <MatchAnalysis />
        ) : view === 'bet-stats' ? (
          <BetStatsView initialMatch={deepLinkMatch} />
        ) : view === 'bet-table' ? (
          <BetStatsTable
            key={betTablePreset?.key ?? 'default'}
            preset={betTablePreset}
          />
        ) : view === 'h2h-matrix' ? (
          <H2HMatrix onOpenPair={openPairInBetTable} />
        ) : view === 'team-form' ? (
          <TeamFormReport />
        ) : (
          <GSLive initialMatch={deepLinkMatch} />
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
