'use client';

import { useEffect, useState } from 'react';
import { LoadingState, Spinner } from './Spinner';
import H1StatsPanel from './H1StatsPanel';
import MatchAnalysis from './MatchAnalysis';
import MatchupView from './MatchupView';
import DrawerOuPanel from './DrawerOuPanel';
import type { GsBetsResponse, GsBetPick, GsBetStats } from '../app/api/gs-bets/route';

function parseScore(s: string | null): [number, number] | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

/** Ô tỉ số: nhãn nhỏ + tỉ số tabular. */
function ScoreCell({ label, score, strong }: { label: string; score: string; strong?: boolean }) {
  return (
    <div className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2.5 text-center">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#666]">{label}</div>
      <div className={`mt-1 tabular-nums leading-none ${strong ? 'text-[20px] font-extrabold text-white' : 'text-[18px] font-bold text-[#ddd]'}`}>
        {score}
      </div>
    </div>
  );
}

export default function MatchDetailDrawer({
  eventId,
  home,
  away,
  onClose,
  initialTab,
  activeMarket,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
}: {
  eventId: number;
  home: string;
  away: string;
  onClose: () => void;
  initialTab?: 'h1' | 'h2h' | 'matchup' | 'ou';
  // Market đang chạy (đồng bộ Kiểu 2 list): 'h1'→thẻ H1 xanh, 'ft'→thẻ FT xanh, null→không.
  activeMarket?: 'ft' | 'h1' | null;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<GsBetPick | null>(null);
  const [stats, setStats] = useState<GsBetStats | null>(null);
  const [tab, setTab] = useState<'h1' | 'h2h' | 'matchup' | 'ou'>(initialTab ?? 'h1');

  // ESC đóng drawer · ← / → sang trận trước / kế (giữ nguyên tab đang xem)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onPrev?.();
      else if (e.key === 'ArrowRight' && hasNext) onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    // Giữ pick/stats cũ trong lúc reload (đổi trận qua ◀▶) — vùng tab H1 phủ mờ
    // thay vì blank trắng rồi reflow. Data mới thay data cũ khi fetch xong.

    fetch(`/api/gs-bets?eventId=${eventId}`)
      .then(async (r) => {
        const json = (await r.json()) as GsBetsResponse;
        if (!alive) return;
        if (!json.ok) {
          setError(json.error === 'no db'
            ? 'Chưa cấu hình ANALYSIS_DATABASE_URL — không kết nối được DB thống kê.'
            : json.error || 'Không tải được chi tiết trận.');
          return;
        }
        setPick(json.pick ?? null);
        setStats(json.stats ?? null);
      })
      .catch(() => {
        if (alive) setError('Không tải được chi tiết trận.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [eventId]);

  // Tỉ số: HT lấy từ pick.ht_score (fallback stats.ht_score), FT từ pick.ft_score; H2 = FT − HT.
  const htStr = pick?.ht_score ?? stats?.ht_score ?? null;
  const ftStr = pick?.ft_score ?? null;
  const ht = parseScore(htStr);
  const ft = parseScore(ftStr);

  const tabDefs: [typeof tab, string][] = [
    ['h1', '📊 Chỉ Số H1'],
    ['matchup', '🔥 Diễn biến'],
    ['h2h', '⚔️ Đối Kháng'],
    ['ou', '🎯 Tài/Xỉu'],
  ];

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/60" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[201] w-[calc(100%-44px)] md:w-[680px] bg-[#111] border-l border-[#2a2a2a] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#222] flex-shrink-0 bg-[#0d0d0d]">
          <span className="text-[13px] font-bold text-[#fbbf24]">📋</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-white truncate">
              {home} <span className="text-[#555] font-normal">vs</span> {away}
            </div>
            <div className="text-[10px] text-[#555] mt-0.5">
              {loading ? 'Đang tải…' : error ? 'Lỗi tải dữ liệu' : 'Chi tiết trận'}
            </div>
          </div>
          {/* Prev / Next — sang trận trước/kế trong bảng Xếp hạng Live (giữ nguyên tab) */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => onPrev?.()}
              disabled={!hasPrev}
              title="Trận trước (←)"
              className="rounded-md border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-1 text-[13px] leading-none text-[#aaa] transition-colors enabled:hover:border-[#444] enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => onNext?.()}
              disabled={!hasNext}
              title="Trận kế (→)"
              className="rounded-md border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-1 text-[13px] leading-none text-[#aaa] transition-colors enabled:hover:border-[#444] enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              ▶
            </button>
          </div>
          <button
            onClick={onClose}
            className="text-[#555] hover:text-white text-lg leading-none flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Tab switcher — mirror tab styling từ MatchAnalysis */}
        <div className="flex gap-1.5 px-3 py-2 border-b border-[#222] bg-[#0d0d0d] flex-shrink-0">
          {tabDefs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                tab === key
                  ? 'bg-[#17a2b8] text-white'
                  : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Tab 1 — Chỉ Số H1 */}
          {tab === 'h1' && (
            <>
              {/* Lần đầu (chưa có data) → full loading. Reload (đổi trận, đã có data)
                  → giữ khung + phủ mờ, không blank trắng. */}
              {loading && pick === null && stats === null && (
                <LoadingState label="Đang tải chi tiết trận…" />
              )}

              {!loading && error && (
                <div className="m-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[12px] text-[#f87171]">
                  {error}
                </div>
              )}

              {!error && (pick !== null || stats !== null) && (
                <div className="relative">
                  {loading && (
                    <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-[#141414]/80 px-2 py-1 text-[11px] font-semibold text-[#17a2b8]">
                      <Spinner size={12} /> Đang tải…
                    </div>
                  )}
                  <div className={`flex flex-col gap-0 transition-opacity duration-200 ${loading ? 'pointer-events-none opacity-40' : ''}`}>
                    {/* Tỉ số: HT (hết H1) + FT (chung cuộc) */}
                    <div className="px-3 py-3 md:px-4 md:py-4 border-b border-[#1a1a1a]">
                      <div className="mb-2 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">⚽ Tỉ số</div>
                      <div className="flex gap-2">
                        <ScoreCell label="Hết H1" score={ht ? `${ht[0]} - ${ht[1]}` : '—'} />
                        <ScoreCell label="Chung cuộc" score={ft ? `${ft[0]} - ${ft[1]}` : '—'} strong />
                      </div>
                    </div>

                    {/* Panel chỉ số Hiệp 1 */}
                    <div className="px-3 py-3 md:px-4 md:py-4 border-b border-[#1a1a1a]">
                      <div className="mb-2 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">📊 Chỉ số H1</div>
                      <H1StatsPanel stats={stats} homeName={home} awayName={away} />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Tab — Diễn biến (matchup H2H narrative, filtered to home vs away) */}
          {tab === 'matchup' && <MatchupView teamA={home} teamB={away} />}

          {/* Tab 2 — Đối Kháng (lịch sử đối đầu, tái sử dụng MatchAnalysis embedded) */}
          {tab === 'h2h' && (
            <MatchAnalysis embedded initialTeamA={home} initialTeamB={away} />
          )}

          {/* Tab — Tài/Xỉu (đối đầu H2H Tài/Xỉu của đúng cặp trận live này) */}
          {tab === 'ou' && <DrawerOuPanel eventId={eventId} activeMarket={activeMarket} />}
        </div>
      </div>
    </>
  );
}
