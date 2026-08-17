'use client';

import Link from 'next/link';
import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import type { Match } from '../types/match';
import type { FilterOptions } from '../lib/gsMatchesDb';
import SearchDropdown from './SearchDropdown';
import DataTable from './DataTable';
import { LoadingState, Spinner } from './Spinner';
import GSLive from './GSLive';
import SystemMonitor from './SystemMonitor';
import MatchAnalysis from './MatchAnalysis';
import BetStatsView from './BetStatsView';
import BetStatsTable from './BetStatsTable';
import H2HMatrix, { type OpenPairFn } from './H2HMatrix';
import TeamFormReport from './TeamFormReport';
import RankingLive from './RankingLive';
import TxReport from './TxReport';
import BotReport from './BotReport';
import FtPairs from './FtPairs';
import GoalTimeline from './GoalTimeline';
import LiveVideoWall from './LiveVideoWall';
import SabaFootballLive from './SabaFootballLive';
import SabaVideo from './SabaVideo';

type View = 'data' | 'gs-live' | 'report' | 'match-analysis' | 'bet-stats' | 'bet-table' | 'h2h-matrix' | 'team-form' | 'tx-report' | 'bot-report' | 'ft-pairs' | 'goal-timeline' | 'monitor' | 'video' | 'saba-live' | 'saba-video';
type FType = 'all' | '20p' | '16p';

// ── URL routing: view ↔ slug (single source of truth) ─────────────────────
// Mỗi View có 1 slug canonical dùng làm ?view=<slug>. Slug trùng tên view cho
// dễ đọc/chia sẻ. Đây là nguồn duy nhất để build link và parse URL.
const VIEW_TO_SLUG: Record<View, string> = {
  'data': 'data',
  'gs-live': 'gs-live',
  'report': 'report',
  'match-analysis': 'match-analysis',
  'bet-stats': 'bet-stats',
  'bet-table': 'bet-table',
  'h2h-matrix': 'h2h-matrix',
  'team-form': 'team-form',
  'tx-report': 'tx-report',
  'bot-report': 'bot-report',
  'ft-pairs': 'ft-pairs',
  'goal-timeline': 'goal-timeline',
  'monitor': 'monitor',
  'video': 'video',
  'saba-live': 'saba-live',
  'saba-video': 'saba-video',
};

// Slug (kể cả alias cũ) → View. Alias legacy giữ cho link chia sẻ cũ còn chạy;
// URL phát ra về sau luôn dùng slug canonical ở VIEW_TO_SLUG.
const SLUG_TO_VIEW: Record<string, View> = {
  ...Object.fromEntries(Object.entries(VIEW_TO_SLUG).map(([v, s]) => [s, v as View])),
  // Alias INPUT cũ (một chiều):
  'live': 'gs-live',
  'keo': 'bet-stats',
  'tx': 'report',
};

// URL hiển thị + dùng cho <Link href>. Guard SSR.
const slugHref = (v: View) => `/?view=${VIEW_TO_SLUG[v]}`;

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
  // Filter deep-link (from Tài Xỉu Live → open a pair in GS Dữ liệu). When set,
  // the "reset teams on entering data view" effect skips once so the linked pair
  // survives the mount.
  const deepLinkFilterPending = useRef(false);
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

  // ── Deep-link (?view=<slug>&match=<eventId>&type&team&team2) ─────────────
  // Runs once on mount, BEFORE the localStorage UI-restore effect, so một link
  // chia sẻ thắng view đã lưu. ?view=<slug> là PERSISTENT (giữ lại trên URL để
  // ctrl-click/F5 vẫn ở đúng trang); các param còn lại (match/type/team/team2)
  // là ONE-SHOT — tiêu thụ đúng 1 lần rồi bóc khỏi URL.
  useEffect(() => {
    if (deepLinkConsumed.current) return;
    const params = new URLSearchParams(window.location.search);
    const vParam = params.get('view');
    const mParam = params.get('match');
    const typeParam = params.get('type');
    const teamParam = params.get('team');
    const team2Param = params.get('team2');
    if (!vParam && !mParam && !typeParam && !teamParam && !team2Param) return;
    deepLinkConsumed.current = true;

    // ?view=<slug> qua SLUG_TO_VIEW (bao gồm alias legacy live/keo/tx).
    const targetView: View | undefined = vParam ? SLUG_TO_VIEW[vParam] : undefined;
    if (targetView) setView(targetView);

    const eventId = mParam ? Number(mParam) : NaN;
    if (Number.isFinite(eventId)) setDeepLinkMatch(eventId);

    // Pair deep-link → GS Dữ liệu pre-filtered by tournament + both teams.
    if (typeParam === '20p' || typeParam === '16p' || typeParam === 'all') setFType(typeParam);
    if (teamParam) { setFTeam(teamParam); deepLinkFilterPending.current = true; }
    if (team2Param) { setFTeam2(team2Param); deepLinkFilterPending.current = true; }

    // Bóc CHỈ các one-shot param; giữ lại ?view=<slug canonical> nếu có view hợp lệ.
    // (URL-sync effect theo `view` cũng sẽ chuẩn hoá về slug canonical ngay sau.)
    window.history.replaceState(
      null, '',
      targetView ? slugHref(targetView) : window.location.pathname,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Đồng bộ URL theo view ────────────────────────────────────────────────
  // Mọi thay đổi view (nav click, openPairInBetTable, deep-link) đều phản chiếu
  // lên URL dạng /?view=<slug> qua replaceState (không đẩy history, không spam).
  // Đồng thời cập nhật chỉ báo pathname hiển thị ở đầu <main>. Guard SSR.
  const [urlLabel, setUrlLabel] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.history.replaceState(null, '', slugHref(view));
    setUrlLabel(window.location.pathname + window.location.search);
  }, [view]);

  // (Bỏ persist UI state vào localStorage — user 2026-08-15: KHÔNG lưu filter/view nữa.
  //  View lấy từ URL ?view=; filter type/date/2 đội luôn về 'all' mặc định mỗi lần vào.)

  // Vào trang GS Dữ liệu (mount hoặc nhấn tab) → luôn reset filter 2 đội về 'all', không nhớ lựa chọn trước.
  useEffect(() => {
    if (view === 'data') {
      // A pair deep-link just set the teams — let it survive this one mount.
      if (deepLinkFilterPending.current) { deepLinkFilterPending.current = false; return; }
      setFTeam('all'); setFTeam2('all');
    }
  }, [view]);

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
    uiRestored.current = true;

    // KHÔNG khôi phục filter/view từ localStorage nữa (user 2026-08-15). View đã do URL
    // ?view= quyết định; filter type/date/2 đội luôn ở mặc định 'all'. Nên chỉ cần lo
    // initial-fetch: nếu SSR có data thì dùng luôn, không thì fetch page 0 filter mặc định.
    const ssrOk = initialMatches.length > 0 || !!initialOptions;
    if (!ssrOk) {
      loadPageWith('all', 'all', 'all', 'all', 0, true);
    } else {
      // SSR page 0 (filter mặc định) đã đúng → đánh dấu để filter-effect không skip nhầm.
      didInitialFetch.current = true;
    }

    // Dọn key localStorage cũ/không còn dùng (filter data + goal log + version + rác cũ).
    ['gs_ui_state', 'gs_live_goallog', 'gs-video-league-filter', 'gs_gtl_league',
     'gs_tx_type_filter', 'tx-selected-version',
     'gs_matches', 'gs_updated_at', 'volta_matches', 'volta_updated_at', 'gs_data_version']
      .forEach(k => localStorage.removeItem(k));
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
    // 4G: ngừng refresh khi tab ẩn / màn tắt.
    const id = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) loadPage(0, true); }, 2 * 60 * 1000);
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
    // ['gs-live', '🔴', 'GS Live'], // hidden from nav
    ['report', '🎯', 'GS Live'],
    ['video', '📺', 'GS Video'],
    ['saba-live', '⚽', 'SABA Live'],
    // ['saba-video', '🎥', 'SABA Video'], // hidden from nav
    // ['match-analysis', '📈', 'Phân Tích Kèo'], // hidden from nav
    // ['bet-stats', '📊', 'Thống kê kèo'], // hidden from nav
    // ['bet-table', '🧮', 'Bảng kèo per-trận'],   // hidden per OPS task (per-match table)
    // ['h2h-matrix', '🔥', 'Ma trận Tài/Xỉu'],   // hidden per OPS task (matrix)
    // ['team-form', '🔄', 'Quy luật phong độ'], // hidden from nav
    ['tx-report', '💰', 'Báo cáo TX'],
    ['bot-report', '🤖', 'Bot Report'],
    // ['ft-pairs', '📈', 'Cặp WL/BL'], // hidden from nav
    // ['goal-timeline', '⏱️', 'Timeline Ghi Bàn'], // hidden from nav
    ['monitor', '🖥️', 'Monitor'],
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
              <Link
                key={v}
                href={slugHref(v)}
                onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; setView(v); }}
                title={label}
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all ${
                  view === v
                    ? 'bg-white/[.15] text-white'
                    : 'text-white/50 hover:bg-white/[.08] hover:text-white'
                }`}
              >
                {icon}
              </Link>
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
                <Link
                  key={v}
                  href={slugHref(v)}
                  onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; setView(v); }}
                  className={`flex cursor-pointer items-center gap-2 border-l-[3px] px-5 py-2.5 text-[13px] font-semibold transition-all ${
                    view === v
                      ? 'border-[#17a2b8] bg-white/[.12] text-white'
                      : 'border-transparent text-white/60 hover:bg-white/[.08] hover:text-white'
                  }`}
                >
                  <span>{icon}</span> {label}
                </Link>
              ))}
            </nav>

            <div className="flex-1" />
          </div>
        )}
      </aside>

      {/* Main */}
      <main className={`gs-main flex-1 overflow-y-auto pb-[72px] md:pb-6 bg-[#0d0d0d] ${view === 'video' || view === 'saba-video' ? '' : 'p-3 md:p-6'}`}>
        {/* Chỉ báo URL hiện tại — hiển thị trên MỌI view (guard SSR qua urlLabel state). */}
        {urlLabel && (
          <div className={`mb-2 font-mono text-[11px] text-white/35 ${view === 'video' || view === 'saba-video' ? 'px-3 pt-3' : ''}`}>
            {urlLabel}
          </div>
        )}
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
              {/* Mobile: gộp [đội] vs [đội đối đầu] + tổng trận vào 1 dòng riêng (w-full đẩy
                  xuống hàng dưới, bên trong 2 dropdown chia đều flex-1). Desktop giữ inline md:w-52. */}
              <div className="flex w-full items-center gap-2 md:w-auto md:flex-1">
                <div className="min-w-0 flex-1 md:w-52 md:flex-none">
                  <SearchDropdown
                    options={dataTeamOptions}
                    value={fTeam}
                    onChange={setFTeam}
                    placeholder="-- Tất cả đội --"
                  />
                </div>
                <span className="shrink-0 text-xs font-semibold text-white/40">vs</span>
                <div className="min-w-0 flex-1 md:w-52 md:flex-none">
                  <SearchDropdown
                    options={dataTeam2Options}
                    value={fTeam2}
                    onChange={setFTeam2}
                    placeholder="-- Đội đối đầu --"
                  />
                </div>
                <span className="shrink-0 flex items-center gap-1.5 text-xs text-white/50 md:ml-auto">
                  {dataLoading && <Spinner size={13} />}
                  <span>
                    <span className="mr-1 text-base font-bold text-white">{dataTotal}</span>trận
                  </span>
                </span>
              </div>
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
          <RankingLive initialMatch={deepLinkMatch} />
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
        ) : view === 'monitor' ? (
          <SystemMonitor />
        ) : view === 'tx-report' ? (
          <TxReport />
        ) : view === 'bot-report' ? (
          <BotReport />
        ) : view === 'ft-pairs' ? (
          <FtPairs />
        ) : view === 'goal-timeline' ? (
          <GoalTimeline />
        ) : view === 'video' ? (
          <LiveVideoWall />
        ) : view === 'saba-live' ? (
          <SabaFootballLive initialMatch={deepLinkMatch} />
        ) : view === 'saba-video' ? (
          <SabaVideo />
        ) : (
          <GSLive initialMatch={deepLinkMatch} />
        )}
      </main>

      {/* Bottom nav — mobile only */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-14 md:hidden border-t border-[#2a2a2a] bg-[#111]">
        {navItems.map(([v, icon, label]) => (
          <Link
            key={v}
            href={slugHref(v)}
            onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; setView(v); }}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[16px] transition-colors ${
              view === v ? 'text-[#17a2b8]' : 'text-white/50'
            }`}
          >
            <span className="leading-none">{icon}</span>
            <span className="text-[9px] font-semibold leading-none">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
