'use client';

import { useEffect, useRef, useState } from 'react';
import type { GsLiveMatch } from '../app/api/gs-live/route';

const LS_TOKEN = 'gs_video_wall_token';
const REFRESH_MS = 2_000;

// Chụp ảnh phía SERVER: POST JSON lên /api/video-snapshot → route forward sang
// microservice capture (headful Chrome/Xvfb) tự chụp + gửi Telegram. Mất ~30s.
async function captureAndSend(match: GsLiveMatch, token: string): Promise<void> {
  const isHT = match.period === 4;
  const phase = isHT ? 'HT' : match.isH2 ? 'H2' : 'H1';
  const res = await fetch('/api/video-snapshot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      eventId: match.eventId,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      h1Home: match.h1Home,
      h1Away: match.h1Away,
      leagueName: match.leagueName || '',
      phase,
      token,
    }),
  });
  const json = (await res.json().catch(() => ({ ok: false, error: 'lỗi phản hồi' }))) as {
    ok: boolean;
    error?: string;
  };
  if (!json.ok) throw new Error(json.error || 'gửi thất bại');
}

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

// Thứ tự hiển thị giải cố định: 16p → 20p → 20p_intl → còn lại.
const MATCH_TYPE_ORDER: Record<string, number> = { '16p': 0, '20p': 1, '20p_intl': 2 };

// Gom trận theo GIẢI. Key = leagueName (fallback matchType nếu rỗng).
// Mỗi section giữ 1 lưới 3 cột riêng. Sort ổn định: theo matchType rồi tên giải.
function groupByLeague(matches: GsLiveMatch[]): { key: string; name: string; matches: GsLiveMatch[] }[] {
  const map = new Map<string, { key: string; name: string; matches: GsLiveMatch[] }>();
  for (const m of matches) {
    const name = (m.leagueName || '').trim() || m.matchType;
    if (!map.has(name)) map.set(name, { key: name, name, matches: [] });
    map.get(name)!.matches.push(m);
  }
  return Array.from(map.values()).sort((a, b) => {
    const oa = MATCH_TYPE_ORDER[a.matches[0].matchType] ?? 99;
    const ob = MATCH_TYPE_ORDER[b.matches[0].matchType] ?? 99;
    return oa !== ob ? oa - ob : a.name.localeCompare(b.name);
  });
}

// iframe render width (matches GSLive VideoCell); scaled down to fit the grid cell.
const CONTENT_W = 1440;
// ~500:320 aspect from GSLive desktop video.
const ASPECT = 320 / 500;
// Fallback cell width before the grid column is measured on first paint.
const FALLBACK_W = 440;

// Kèo Chấp (handicap) live — line + giá nhà/khách (Malay). Đội chấp gạch chân đỏ,
// đồng bộ cách RankingLive đánh dấu favoriteSide. Đội nhà xanh · khách đỏ.
function HcLiveRow({
  row,
  divider,
}: {
  row: GsLiveMatch['hcLines'][number] | null;
  divider: boolean;
}) {
  const dead = !row;
  const fav = row?.favoriteSide ?? null;
  return (
    <div className={`flex items-center gap-1 text-[10px] tabular-nums${divider ? ' border-t border-[#222] pt-0.5' : ''}`}>
      <span className="w-[30px] shrink-0 text-right text-[#888]">{dead ? '—' : row!.line ?? '—'}</span>
      <span className={`min-w-0 flex-1 truncate text-[#4ade80] ${fav === 'home' ? 'underline decoration-[#ef4444] decoration-2 underline-offset-2' : ''}`}>Nhà <span className="font-semibold">{dead ? '—' : row!.home ?? '—'}</span></span>
      <span className="shrink-0 text-[#555]">·</span>
      <span className={`min-w-0 flex-1 truncate text-[#fb7185] ${fav === 'away' ? 'underline decoration-[#ef4444] decoration-2 underline-offset-2' : ''}`}>Khách <span className="font-semibold">{dead ? '—' : row!.away ?? '—'}</span></span>
    </div>
  );
}

// Một dòng OU line: line — Tài <over> · Xỉu <under>. Line thiếu/suspended → "—".
// Copy màu/nhãn từ OuLiveRow của RankingLive: Tài xanh #4ade80 · Xỉu đỏ #fb7185.
function OuLiveRow({
  row,
  divider,
}: {
  row: GsLiveMatch['ouLines'][number] | null;
  divider: boolean;
}) {
  const dead = !row || row.suspended;
  return (
    <div className={`flex items-center gap-1 text-[10px] tabular-nums${divider ? ' border-t border-[#222] pt-0.5' : ''}`}>
      <span className="w-[30px] shrink-0 text-right text-[#888]">{dead ? '—' : row!.line ?? '—'}</span>
      <span className="min-w-0 flex-1 truncate text-[#4ade80]">Tài <span className="font-semibold">{dead ? '—' : row!.over ?? '—'}</span></span>
      <span className="shrink-0 text-[#555]">·</span>
      <span className="min-w-0 flex-1 truncate text-[#fb7185]">Xỉu <span className="font-semibold">{dead ? '—' : row!.under ?? '—'}</span></span>
    </div>
  );
}

// Một nhóm kèo (Chấp + Tài Xỉu) cho MỘT hiệp: nhãn hiệp + 2 cột x 2 line.
// hcLines/ouLines rỗng (vd đã sang H2 nên không còn kèo H1) → render 2 dòng "—".
function OddsHalf({
  label,
  hcLines,
  ouLines,
}: {
  label: string;
  hcLines: GsLiveMatch['hcLines'];
  ouLines: GsLiveMatch['ouLines'];
}) {
  const hcRows: (GsLiveMatch['hcLines'][number] | null)[] = [hcLines[0] ?? null, hcLines[1] ?? null];
  const ouRows: (GsLiveMatch['ouLines'][number] | null)[] = [ouLines[0] ?? null, ouLines[1] ?? null];
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-[#8ecbd6]">{label}</div>
      <div className="flex gap-2">
        {/* Chấp */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#777]">Chấp</div>
          <div className="flex flex-col gap-0.5">
            {hcRows.map((row, idx) => (
              <HcLiveRow key={idx} row={row} divider={idx > 0} />
            ))}
          </div>
        </div>
        {/* Tài Xỉu */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#777]">Tài Xỉu</div>
          <div className="flex flex-col gap-0.5">
            {ouRows.map((row, idx) => (
              <OuLiveRow key={idx} row={row} divider={idx > 0} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Hộp kèo dưới video: HAI nhóm — "H1" (hcH1Lines/ouH1Lines) + "Cả trận" (hcLines/ouLines).
// Khi nhà cái khoá kèo (match.suspended) → phủ mờ + ổ khoá CHỈ trên hộp này (cả 2 hiệp),
// video phía trên KHÔNG bị ảnh hưởng. Style ổ khoá mirror RankingLive (amber #fbbf24).
function OddsBox({ match }: { match: GsLiveMatch }) {
  return (
    <div className="relative border-t border-[#222] px-3 py-2">
      {/* Khoá kèo: phủ mờ + ổ khoá CHỈ hộp odds, không đụng video */}
      {match.suspended && (
        <>
          <div className="pointer-events-none absolute inset-0 z-10 bg-[#0d0d0d]/60" />
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="flex items-center gap-1.5 rounded-md border border-[#fbbf24]/50 bg-black/80 px-2.5 py-1 text-[11px] font-semibold text-[#fbbf24] shadow-lg">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Nhà cái đang khoá kèo
            </div>
          </div>
        </>
      )}
      <div className="flex flex-col gap-2">
        <OddsHalf label="H1" hcLines={match.hcH1Lines} ouLines={match.ouH1Lines} />
        <div className="border-t border-[#222]" />
        <OddsHalf label="Cả trận" hcLines={match.hcLines} ouLines={match.ouLines} />
      </div>
    </div>
  );
}

// Một ô video: iframe zenandfe render ở 1440px rồi scale nhỏ vừa cột lưới.
// Click-to-load: chỉ mount iframe sau khi bấm ▶ (copy pattern VideoCell của GSLive).
function VideoCell({
  token,
  agentId,
  match,
  displayW,
  onToast,
}: {
  token: string;
  agentId: string;
  match: GsLiveMatch;
  displayW: number;
  onToast: (msg: string, ok: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [shooting, setShooting] = useState(false);
  const displayH = Math.round(displayW * ASPECT);
  const scale = displayW / CONTENT_W;
  const iframeH = Math.round(displayH / scale);
  const src = `https://det.zenandfe.com/?token=${encodeURIComponent(token)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${match.eventId}&brand=&muted=1`;
  const isHT = match.period === 4;

  // 📸 chụp: POST JSON lên /api/video-snapshot → microservice chụp headless + gửi Telegram (~30s).
  const onSnapshot = async () => {
    if (shooting) return;
    setShooting(true);
    onToast('Đang chụp…', true);
    try {
      await captureAndSend(match, token);
      onToast('Đã gửi ảnh vào Tele', true);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setShooting(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] overflow-hidden">
      {/* Header: teams + score + phase + 📸 chụp */}
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
        {/* 📸 chụp — bên phải badge hiệp; gọi microservice, KHÔNG chụp phía client */}
        <button
          type="button"
          onClick={onSnapshot}
          disabled={shooting}
          title="Chụp ảnh video gửi Telegram"
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {shooting ? '⏳ Đang chụp…' : '📸'}
        </button>
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

      {/* Kèo Chấp + Tài Xỉu (cả trận). Khoá kèo chỉ phủ hộp này, video vẫn rõ. */}
      <OddsBox match={match} />
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

  // Toast chụp ảnh — 1 thông báo fixed góc dưới-phải, tự ẩn sau 3s.
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

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
        <div className="flex flex-col gap-6">
          {groupByLeague(matches).map((section, si) => (
            <section key={section.key}>
              {/* Header giải: tên giải + badge số trận */}
              <div className="mb-2 flex items-center gap-2 border-b border-[#222] pb-1.5">
                <h2 className="text-[15px] font-bold text-white">{section.name}</h2>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#aaa] bg-white/[.06] border border-[#2a2a2a]">
                  {section.matches.length} trận
                </span>
              </div>
              <div ref={si === 0 ? gridRef : undefined} className="grid grid-cols-3 gap-3">
                {section.matches.map((m) => (
                  <VideoCell key={m.eventId} token={token} agentId={agentId} match={m} displayW={cellW} onToast={showToast} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Toast chụp ảnh — góc dưới-phải */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 rounded-lg border px-3.5 py-2 text-[13px] font-medium shadow-lg ${
            toast.ok
              ? 'border-[#17a2b8]/50 bg-black/90 text-[#8ee]'
              : 'border-[#f87171]/50 bg-black/90 text-[#f87171]'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
