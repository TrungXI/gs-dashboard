'use client';

import { useEffect, useRef, useState } from 'react';
import type { GsLiveMatch } from '../app/api/gs-live/route';

const LS_TOKEN = 'gs_video_wall_token';
const REFRESH_MS = 15_000;

// Cho phép dán nguyên link (vd https://m.zenandfe.com/?token=69-xxx&agentId=69&…)
// → tự bóc query param `token`. Nếu không phải URL thì coi input là token thô.
function extractToken(input: string): string {
  const v = input.trim();
  if (!v) return '';
  if (v.includes('token=')) {
    const m = v.match(/[?&]token=([^&#\s]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  }
  return v;
}

// iframe render width (matches GSLive VideoCell); scaled down to fit the grid cell.
const CONTENT_W = 1440;
// ~500:320 aspect from GSLive desktop video.
const ASPECT = 320 / 500;
// Fallback cell width before the grid column is measured on first paint.
const FALLBACK_W = 440;

// Một ô video: iframe zenandfe render ở 1440px rồi scale nhỏ vừa cột lưới.
// Click-to-load: chỉ mount iframe sau khi bấm ▶ (copy pattern VideoCell của GSLive).
function VideoCell({
  token,
  agentId,
  match,
  displayW,
}: {
  token: string;
  agentId: string;
  match: GsLiveMatch;
  displayW: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const displayH = Math.round(displayW * ASPECT);
  const scale = displayW / CONTENT_W;
  const iframeH = Math.round(displayH / scale);
  const src = `https://det.zenandfe.com/?token=${encodeURIComponent(token)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${match.eventId}&brand=&muted=1`;
  const isHT = match.period === 4;

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] overflow-hidden">
      {/* Header: teams + score + phase */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#222]">
        <div className="flex-1 min-w-0 text-[13px] font-semibold text-white truncate">
          {match.homeTeam} <span className="text-[#555]">vs</span> {match.awayTeam}
        </div>
        <div className="shrink-0 text-[14px] font-bold tabular-nums text-white">
          {match.h1Home} - {match.h1Away}
        </div>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#aaa] bg-white/[.06] border border-[#2a2a2a]">
          {isHT ? 'HT' : match.isH2 ? 'H2' : 'H1'}
          {match.minuteElapsed != null ? ` ${match.minuteElapsed}'` : ''}
        </span>
      </div>

      {/* Video box */}
      <div className="relative bg-black overflow-hidden" style={{ width: displayW, height: displayH }}>
        {loaded ? (
          <iframe
            src={src}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: CONTENT_W, height: iframeH,
              border: 'none', display: 'block',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
            title={`${match.homeTeam} vs ${match.awayTeam}`}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setLoaded(true)}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#444] hover:text-[#888] transition-colors"
          >
            <span className="text-3xl">▶</span>
            <span className="text-[11px]">Xem video</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function LiveVideoWall() {
  // Desktop check — cổng JS boolean; iframe KHÔNG bao giờ mount trên mobile.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Token — nhập tay ở top bar, lưu localStorage, prefill lúc mount.
  const [token, setToken] = useState('');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_TOKEN);
      if (saved) setToken(saved);
    } catch { /* ignore */ }
  }, []);
  const onTokenChange = (v: string) => {
    const t = extractToken(v);
    setToken(t);
    try { localStorage.setItem(LS_TOKEN, t); } catch { /* ignore */ }
  };
  const agentId = token.split('-')[0] || '69';

  // Grid column width — đo cột thực bằng ResizeObserver để lưới 3 cột fill ngang.
  const gridRef = useRef<HTMLDivElement>(null);
  const [cellW, setCellW] = useState(FALLBACK_W);
  useEffect(() => {
    if (!isDesktop) return;
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const cols = 3;
      const gap = 12; // gap-3 = 0.75rem = 12px
      const total = el.clientWidth;
      const w = Math.floor((total - gap * (cols - 1)) / cols);
      if (w > 0) setCellW(w);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [isDesktop]);

  // Match list — fetch /api/gs-live, refresh mỗi 15s, refetch khi token đổi.
  const [matches, setMatches] = useState<GsLiveMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  useEffect(() => {
    if (!isDesktop || !token) return;
    let cancelled = false;

    const fetchMatches = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/gs-live?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; matches?: GsLiveMatch[]; error?: string };
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error || 'Lỗi tải trận');
        setMatches((json.matches ?? []).filter((m) => m.isLive));
        setLastFetch(new Date());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchMatches();
    const id = setInterval(fetchMatches, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [isDesktop, token]);

  // Mobile: chỉ hiện thông báo, KHÔNG render lưới/iframe.
  if (!isDesktop) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6 text-center">
        <div className="text-[14px] text-[#aaa]">
          Trang này chỉ hỗ trợ trên máy tính (desktop)
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Top section: title + token input + refresh status */}
      <div className="mb-5">
        <div className="mb-3 flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-white">Video Live — Tất cả trận</h1>
          <span className="text-xs text-[#666]">
            {matches.length} trận live
            {lastFetch && ` · cập nhật ${lastFetch.toLocaleTimeString('vi-VN')}`}
            {loading && ' · đang tải…'}
          </span>
        </div>
        <input
          type="text"
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder="Dán token hoặc nguyên link (tự bóc token)…"
          className="w-full max-w-xl rounded-lg bg-white/[.07] px-3 py-2 text-sm text-white placeholder:text-[#666] outline-none border border-[#2a2a2a] focus:border-[#17a2b8]"
        />
      </div>

      {/* Grid section */}
      {!token ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="mb-3 text-4xl">🔑</div>
          <div className="text-[14px] text-[#888]">Dán token vào ô phía trên để xem video.</div>
        </div>
      ) : error ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="text-3xl">⚠️</div>
          <div className="text-[13px] text-[#f87171]">{error}</div>
        </div>
      ) : matches.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="mb-3 text-4xl">📭</div>
          <div className="text-[14px] text-[#888]">Không có trận nào đang live</div>
        </div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-3 gap-3">
          {matches.map((m) => (
            <VideoCell key={m.eventId} token={token} agentId={agentId} match={m} displayW={cellW} />
          ))}
        </div>
      )}
    </div>
  );
}
