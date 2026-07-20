'use client';

import { useEffect, useState } from 'react';
import { LoadingState } from './Spinner';
import H1StatsPanel from './H1StatsPanel';
import MatchAnalysis from './MatchAnalysis';
import type { GsBetsResponse, GsBetPick, GsBetStats } from '../app/api/gs-bets/route';

interface GsAiPickResponse {
  ok: boolean;
  error?: string;
  ht_score?: string | null;
  variant?: string;
  ou_line?: string | null;
  pick?: string;
  side?: string;
  confidence?: string;
  reasoning?: string;
  redFlags?: string[];
  ai_model?: string;
}

function parseScore(s: string | null): [number, number] | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

// Các field chỉ số H1 kỳ vọng (19 cặp × home/away = 38 field) — khớp bộ 38 field của predict.js.
const H1_STAT_KEYS: (keyof GsBetStats)[] = [
  'home_xg', 'away_xg',
  'home_shots', 'away_shots',
  'home_sot', 'away_sot',
  'home_shot_acc', 'away_shot_acc',
  'home_poss', 'away_poss',
  'home_passes', 'away_passes',
  'home_pass_acc', 'away_pass_acc',
  'home_dribble_acc', 'away_dribble_acc',
  'home_tackles', 'away_tackles',
  'home_tackles_won', 'away_tackles_won',
  'home_interceptions', 'away_interceptions',
  'home_saves', 'away_saves',
  'home_fouls', 'away_fouls',
  'home_offsides', 'away_offsides',
  'home_free_kicks', 'away_free_kicks',
  'home_corners', 'away_corners',
  'home_penalties', 'away_penalties',
  'home_yellow', 'away_yellow',
  'home_red', 'away_red',
];

// Tỉ lệ field non-null / tổng field kỳ vọng (0..1). Khớp MIN_STATS_COVERAGE=0.80 của predict.js.
function statsCoverage(stats: GsBetStats | null): number {
  if (!stats) return 0;
  let present = 0;
  for (const k of H1_STAT_KEYS) if (stats[k] != null) present++;
  return present / H1_STAT_KEYS.length;
}

const MIN_STATS_COVERAGE = 0.8;

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

/** Pick lớn, in đậm, màu theo side: Tài xanh lá / Xỉu xanh dương / BỎ xám. */
function AiSide({ side, pick }: { side?: string; pick?: string }) {
  const s = (side ?? '').trim();
  const color = s === 'Tài'
    ? 'text-[#4ade80]'
    : s === 'Xỉu'
      ? 'text-[#60a5fa]'
      : 'text-[#8a8a8a]';
  return (
    <div className="min-w-0">
      <div className={`text-[26px] font-extrabold leading-none ${color}`}>{s || '—'}</div>
      {pick && pick.trim() && pick.trim() !== s && (
        <div className="mt-1 truncate text-[12px] font-semibold text-[#bbb]">{pick}</div>
      )}
    </div>
  );
}

/** Badge độ tin: Cao / TB / Thấp (chỉ tham khảo). */
function ConfidenceBadge({ confidence }: { confidence?: string }) {
  const c = (confidence ?? '').trim();
  if (!c) return null;
  const cls = c === 'Cao'
    ? 'border-[#4ade80]/40 bg-[#4ade80]/10 text-[#4ade80]'
    : c === 'TB'
      ? 'border-[#fbbf24]/40 bg-[#fbbf24]/10 text-[#fbbf24]'
      : 'border-[#8a8a8a]/40 bg-[#8a8a8a]/10 text-[#9a9a9a]';
  return (
    <span className={`flex-shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-bold ${cls}`}>
      Tin: {c}
    </span>
  );
}

export default function MatchDetailDrawer({
  eventId,
  home,
  away,
  onClose,
}: {
  eventId: number;
  home: string;
  away: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<GsBetPick | null>(null);
  const [stats, setStats] = useState<GsBetStats | null>(null);
  const [tab, setTab] = useState<'h1' | 'h2h' | 'ai'>('h1');

  // Tab AI Kèo — lazy: chỉ fetch khi mở tab (tiết kiệm chi phí API)
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPick, setAiPick] = useState<GsAiPickResponse | null>(null);
  const [aiFetched, setAiFetched] = useState(false);

  // ESC đóng drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setPick(null);
    setStats(null);
    // reset AI tab khi đổi trận
    setAiPick(null);
    setAiError(null);
    setAiFetched(false);
    setAiLoading(false);

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

  // Lazy: chỉ gọi /api/gs-ai-pick lần đầu khi mở tab AI (tiết kiệm chi phí API)
  useEffect(() => {
    if (tab !== 'ai' || aiFetched) return;
    let alive = true;
    setAiFetched(true);
    setAiLoading(true);
    setAiError(null);

    fetch(`/api/gs-ai-pick?event=${eventId}`)
      .then(async (r) => {
        const json = (await r.json()) as GsAiPickResponse;
        if (!alive) return;
        if (!json.ok) {
          setAiError(json.error || 'Không tạo được kèo AI.');
          return;
        }
        setAiPick(json);
      })
      .catch(() => {
        if (alive) setAiError('Không tạo được kèo AI.');
      })
      .finally(() => {
        if (alive) setAiLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [tab, aiFetched, eventId]);

  // Tỉ số: HT lấy từ pick.ht_score (fallback stats.ht_score), FT từ pick.ft_score; H2 = FT − HT.
  const htStr = pick?.ht_score ?? stats?.ht_score ?? null;
  const ftStr = pick?.ft_score ?? null;
  const ht = parseScore(htStr);
  const ft = parseScore(ftStr);

  // Tab AI Kèo chỉ hiện khi chỉ số H1 đủ độ phủ ≥ 80% (giống MIN_STATS_COVERAGE của predict.js).
  const coverage = statsCoverage(stats);
  const showAiTab = !loading && !error && coverage >= MIN_STATS_COVERAGE;

  // Nếu đang ở tab AI mà độ phủ tụt < 80% (đổi trận) → về tab H1.
  useEffect(() => {
    if (tab === 'ai' && !showAiTab) setTab('h1');
  }, [tab, showAiTab]);

  const tabDefs: [typeof tab, string][] = [
    ['h1', '📊 Chỉ Số H1'],
    ['h2h', '⚔️ Đối Kháng'],
    ...(showAiTab ? [['ai', '🤖 AI Kèo'] as [typeof tab, string]] : []),
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
          {/* Tab 1 — Chỉ Số H1 (nội dung cũ, không đổi) */}
          {tab === 'h1' && (
            <>
              {loading && <LoadingState label="Đang tải chi tiết trận…" />}

              {!loading && error && (
                <div className="m-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[12px] text-[#f87171]">
                  {error}
                </div>
              )}

              {!loading && !error && (
                <div className="flex flex-col gap-0">
                  {/* Tỉ số: HT (hết H1) + FT (chung cuộc) */}
                  <div className="px-3 py-3 md:px-4 md:py-4 border-b border-[#1a1a1a]">
                    <div className="mb-2 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">⚽ Tỉ số</div>
                    <div className="flex gap-2">
                      <ScoreCell label="Hết H1" score={ht ? `${ht[0]} - ${ht[1]}` : '—'} />
                      <ScoreCell label="Chung cuộc" score={ft ? `${ft[0]} - ${ft[1]}` : '—'} strong />
                    </div>
                  </div>

                  {/* Panel chỉ số Hiệp 1 — dùng chung với tab Kèo */}
                  <div className="px-3 py-3 md:px-4 md:py-4 border-b border-[#1a1a1a]">
                    <div className="mb-2 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">📊 Chỉ số H1</div>
                    <H1StatsPanel stats={stats} homeName={home} awayName={away} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Tab 2 — Đối Kháng (lịch sử đối đầu, tái sử dụng MatchAnalysis embedded) */}
          {tab === 'h2h' && (
            <MatchAnalysis embedded initialTeamA={home} initialTeamB={away} />
          )}

          {/* Tab 3 — AI Kèo (thử nghiệm, lazy fetch) */}
          {tab === 'ai' && (
            <div className="flex flex-col gap-0">
              {/* Nhãn thử nghiệm nổi bật */}
              <div className="m-3 rounded-lg border border-[#a855f7]/40 bg-[#a855f7]/10 px-3 py-2.5 text-[11px] leading-relaxed text-[#d8b4fe]">
                🧪 <span className="font-bold">AI THỬ NGHIỆM</span> — tham khảo, CHƯA chứng minh (bot AI đang thua ~2/10). KÈO CHÍNH xem Premium.
              </div>

              {aiLoading && <LoadingState label="AI đang phân tích kèo…" />}

              {!aiLoading && aiError && (
                <div className="m-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[12px] text-[#f87171]">
                  {aiError}
                </div>
              )}

              {/* Fallback: fetch xong nhưng không có pick lẫn lỗi → không để tab trống/quay vô hạn */}
              {!aiLoading && !aiError && !aiPick && (
                <div className="m-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[12px] text-[#f87171]">
                  Không tạo được gợi ý, thử lại.
                </div>
              )}

              {!aiLoading && !aiError && aiPick && (
                <div className="px-3 pb-4 md:px-4">
                  {/* Pick lớn + confidence */}
                  <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <AiSide side={aiPick.side} pick={aiPick.pick} />
                      <ConfidenceBadge confidence={aiPick.confidence} />
                    </div>
                    {(aiPick.ht_score || aiPick.ou_line) && (
                      <div className="mt-2 text-[10px] text-[#666]">
                        {aiPick.ht_score ? `HT ${aiPick.ht_score}` : ''}
                        {aiPick.ou_line ? `  ·  vạch OU ${aiPick.ou_line}` : ''}
                        {aiPick.variant ? `  ·  giải ${aiPick.variant}` : ''}
                      </div>
                    )}
                  </div>

                  {/* Lý do */}
                  {aiPick.reasoning && (
                    <div className="mt-3 rounded-lg border border-[#2a2a2a] bg-[#141414] px-4 py-3">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#555]">💭 Lý do</div>
                      <div className="text-[12px] leading-relaxed text-[#ccc]">{aiPick.reasoning}</div>
                    </div>
                  )}

                  {/* Red flags */}
                  {aiPick.redFlags && aiPick.redFlags.length > 0 && (
                    <div className="mt-3 rounded-lg border border-[#2a2a2a] bg-[#141414] px-4 py-3">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#555]">🚩 Cảnh báo</div>
                      <ul className="flex flex-col gap-1">
                        {aiPick.redFlags.map((f, i) => (
                          <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-[#e8a33d]">
                            <span className="flex-shrink-0">•</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiPick.ai_model && (
                    <div className="mt-3 text-right text-[9px] text-[#444]">model: {aiPick.ai_model}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
