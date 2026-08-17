'use client';

import { useEffect, useRef, useState } from 'react';
import SabaTokenBar from './SabaTokenBar';
import { useSabaNoti, SabaNotiToggles, SabaToastHost } from './SabaNoti';

// ── SABA (C-Sport) live video wall ───────────────────────────────────────────
// Mirrors LiveVideoWall.tsx's grid + VideoCell scale pattern, but embeds the
// SABA red5pro player via an iframe (NO WebRTC/HLS re-serving, NO snapshot).
// Data from /api/gs-saba-video (list of live+streaming matches), polled 2s.
// See SPEC §6.2.

const REFRESH_MS = 2_000;

// iframe render width (mirror LiveVideoWall CONTENT_W); scaled to fit the cell.
const CONTENT_W = 1440;
// ~500:320 aspect from the desktop video (mirror LiveVideoWall ASPECT).
const ASPECT = 320 / 500;
// Fallback cell width before the grid column is measured on first paint.
const FALLBACK_W = 440;

// SABA player base — full origin + rotating session prefix, e.g.
//   https://c0z0ia.bpy6vurb.com/(S(<session>))
// NOTE: the base now comes FROM the API response (`playerBase`), NOT from
// NEXT_PUBLIC_SABA_PLAYER_BASE. The rotating session S(...) is captured server-
// side from the token bar; if it's empty the iframes 404, so we show a banner
// instead of mounting broken iframes.

// TODO(backend contract): field names below mirror the agreed
// /api/gs-saba-video shape — confirm against review/backend-fix-summary.md when
// it lands (matchId, homeId, awayId, gv, streamingJson object, score_home,
// score_away, minute). If BE renames anything, update here + the mapper in the
// poll effect.
interface SabaVideoMatch {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  homeId: number | string;
  awayId: number | string;
  gv: number | string;
  // streamingJson: object like {"11":{"_f":2,"streamingsrc":11,...},"19":{...}}
  // Serialised + URL-encoded into the `streaming` param below.
  streamingJson: Record<string, unknown>;
  score_home: number;
  score_away: number;
  minute: number | null;
  period?: number | null; // optional: nếu BE thêm vào video response → bật phát hiện HT; nếu không → chỉ goal
}

// Build the SABA player iframe URL client-side from the working-example format.
// playerBase already carries the origin + session prefix, e.g.
//   https://<host>/(S(<session>))
function playerSrc(playerBase: string, m: SabaVideoMatch): string {
  const base = playerBase.replace(/\/+$/, '');
  const streaming = encodeURIComponent(JSON.stringify(m.streamingJson ?? {}));
  const params =
    `streamingType=SB` +
    `&id=${m.matchId}` +
    `&noMenu=false` +
    `&Hid=${m.homeId}` +
    `&Aid=${m.awayId}` +
    `&sportType=1` +
    `&GV=${m.gv}` +
    `&display=streaming` +
    `&isLive=true` +
    `&matchId3Rd=` +
    `&parentMatchId=0` +
    `&vocalStreaming=` +
    `&streaming=${streaming}` +
    `&isSingleMatch=false` +
    `&lang=vn` +
    `&generalStreamingType=Match` +
    `&focusSourceType=2`;
  return `${base}/Streaming/Schedule?${params}`;
}

// ── 📸 Snapshot (client-side getDisplayMedia) — ported from LiveVideoWall ─────
// SABA video là WebRTC (không chụp server-side được), nên chụp phía CLIENT: xin
// getDisplayMedia 1 lần, cắt đúng ô video (data-cap-event) rồi POST multipart lên
// /api/video-snapshot (endpoint DÙNG CHUNG với GS Video — không sửa) → Telegram.
let sharedStream: MediaStream | null = null;
async function getShareStream(): Promise<MediaStream> {
  const track = sharedStream?.getVideoTracks()[0];
  if (track && track.readyState === 'live') return sharedStream!;
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
  } as MediaStreamConstraints);
  sharedStream = stream;
  const vt = stream.getVideoTracks()[0];
  if (vt) vt.onended = () => { sharedStream = null; };
  return stream;
}

async function captureSabaShot(match: SabaVideoMatch): Promise<void> {
  const stream = await getShareStream();
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  await v.play();
  await new Promise<void>((resolve) => {
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback;
    if (rvfc) rvfc.call(v, () => resolve());
    else setTimeout(resolve, 120);
  });

  try {
    const settings = stream.getVideoTracks()[0].getSettings();
    const tw = settings.width!;
    const th = settings.height!;
    const sx = tw / window.innerWidth;
    const sy = th / window.innerHeight;

    const el = document.querySelector(`[data-cap-event="${match.matchId}"]`);
    if (!el) throw new Error('không thấy khung video');
    const box = el.getBoundingClientRect();

    const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));
    const srcL = clamp(box.left * sx, tw);
    const srcT = clamp(box.top * sy, th);
    const srcW = clamp(box.width * sx, tw - srcL);
    const srcH = clamp(box.height * sy, th - srcT);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(box.width);
    canvas.height = Math.round(box.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('không tạo được canvas');
    ctx.drawImage(v, srcL, srcT, srcW, srcH, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    );
    if (!blob) throw new Error('không tạo được ảnh');

    const fd = new FormData();
    fd.append('image', blob, 'shot.jpg');
    fd.append('eventId', String(match.matchId));
    fd.append('homeTeam', match.homeTeam);
    fd.append('awayTeam', match.awayTeam);
    fd.append('h1Home', String(match.score_home));
    fd.append('h1Away', String(match.score_away));
    fd.append('leagueName', match.leagueName || '');
    if (match.minute != null) fd.append('phase', `${match.minute}'`);
    // Nhãn nguồn để BE sau này định tuyến sang topic SABA riêng nếu muốn. Endpoint
    // hiện KHÔNG đọc field này → ảnh SABA tạm về CHUNG topic với GS (xem summary).
    fd.append('source', 'saba');

    const res = await fetch('/api/video-snapshot', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => ({ ok: false, error: 'lỗi phản hồi' }))) as {
      ok: boolean; error?: string;
    };
    if (!json.ok) throw new Error(json.error || 'gửi thất bại');
  } finally {
    v.srcObject = null; // nhả <video>, KHÔNG stop track chung (khỏi xin quyền lại)
  }
}

// Một ô video: iframe SABA player render ở 1440px rồi scale nhỏ vừa cột lưới.
// Click-to-load: chỉ mount iframe sau khi bấm ▶ (mirror VideoCell của LiveVideoWall).
function VideoCell({
  match,
  playerBase,
  displayW,
  bulk,
  onToast,
}: {
  match: SabaVideoMatch;
  playerBase: string;
  displayW: number;
  bulk: { on: boolean; n: number } | null;
  onToast: (msg: string, ok: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [shooting, setShooting] = useState(false);
  // "Bật hết / Tắt hết" từ parent. Iframe keyed theo matchId → không remount khi
  // cuộn khuất/đổi tab → luồng video giữ nguyên.
  useEffect(() => { if (bulk) setLoaded(bulk.on); }, [bulk]);
  const displayH = Math.round(displayW * ASPECT);
  const scale = displayW / CONTENT_W;
  const iframeH = Math.round(displayH / scale);
  const src = playerSrc(playerBase, match);

  // 📸 chụp CLIENT-SIDE tức thì (getDisplayMedia) → cắt khung video → gửi Telegram.
  const onSnapshot = async () => {
    if (shooting) return;
    setShooting(true);
    try {
      await captureSabaShot(match);
      onToast('Đã gửi ảnh vào Tele', true);
    } catch (e) {
      onToast('Không chụp được: ' + (e instanceof Error ? e.message : String(e)), false);
    } finally {
      setShooting(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] overflow-hidden">
      {/* Header: teams + score + minute + 📸 chụp */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#222]">
        <div className="flex-1 min-w-0 text-[13px] font-semibold truncate">
          <span className="text-[#4ade80]">{match.homeTeam}</span>
          <span className="text-[#555]"> vs </span>
          <span className="text-[#fb7185]">{match.awayTeam}</span>
        </div>
        <div className="shrink-0 text-[14px] font-bold tabular-nums text-white">
          {match.score_home} - {match.score_away}
        </div>
        {match.minute != null && (
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#aaa] bg-white/[.06] border border-[#2a2a2a]">
            {match.minute}&apos;
          </span>
        )}
        {/* 📸 chụp — chụp phía CLIENT tức thì rồi gửi Telegram (endpoint chung với GS) */}
        <button
          type="button"
          onClick={onSnapshot}
          disabled={shooting}
          title="Chụp ảnh video gửi Telegram"
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {shooting ? '⏳' : '📸'}
        </button>
      </div>

      {/* Video box — data-cap-event: 📸 crop đúng ô này (chỉ vùng iframe) */}
      <div data-cap-event={match.matchId} className="relative bg-black overflow-hidden" style={{ width: displayW, height: displayH }}>
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

export default function SabaVideo() {
  const [matches, setMatches] = useState<SabaVideoMatch[]>([]);
  const [playerBase, setPlayerBase] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  // Bật/tắt HẾT video 1 lần — n đổi mỗi lần bấm để mọi VideoCell re-apply (mirror LiveVideoWall).
  const bulkN = useRef(0);
  const [bulkLoad, setBulkLoad] = useState<{ on: boolean; n: number } | null>(null);

  // Noti chung (OS goal/HT + toast) — dùng chung với SABA Live qua SabaNoti.
  // Trang Video: API có score → phát hiện GHI BÀN; period (nếu BE thêm) → HT.
  const noti = useSabaNoti();
  const detectRef = useRef(noti.detect);
  detectRef.current = noti.detect;

  // Grid column width — đo cột thực bằng ResizeObserver để iframe scale đúng (mirror LiveVideoWall).
  const gridRef = useRef<HTMLDivElement>(null);
  const [cellW, setCellW] = useState(FALLBACK_W);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const iw = window.innerWidth;
      const cols = iw >= 1024 ? 3 : iw >= 640 ? 2 : 1;
      const gap = 12; // gap-3 = 12px
      const total = el.clientWidth;
      const w = Math.floor((total - gap * (cols - 1)) / cols);
      if (w > 0) setCellW(w);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    window.addEventListener('resize', measure);
    return () => { obs.disconnect(); window.removeEventListener('resize', measure); };
  }, [matches.length]);

  // Poll /api/gs-saba-video mỗi 2s — ngừng khi tab ẩn.
  useEffect(() => {
    let cancelled = false;
    const fetchMatches = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/gs-saba-video', { cache: 'no-store' });
        const json = (await res.json()) as {
          ok: boolean; playerBase?: string; matches?: SabaVideoMatch[]; error?: string;
        };
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error ?? 'Lỗi tải dữ liệu');
        } else {
          setError(null);
          const next = json.matches ?? [];
          setPlayerBase(json.playerBase ?? '');
          setMatches(next);
          setLastFetch(new Date());
          // Phát hiện ghi bàn (score tăng) → noti/toast. HT chỉ khi BE trả period.
          detectRef.current(next.map((m) => ({
            matchId: m.matchId,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            scoreHome: m.score_home,
            scoreAway: m.score_away,
            period: m.period ?? null,
            minute: m.minute,
          })));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    fetchMatches();
    const id = setInterval(fetchMatches, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="p-5">
      {/* Thanh nhập token session SABA (dùng chung với trang SABA Live) */}
      <div className="mb-3">
        <SabaTokenBar />
      </div>
      {/* Header: tiêu đề + trạng thái + bật/tắt hết */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-base font-bold text-white whitespace-nowrap">SABA Video</h1>
        <span className="text-[11px] text-[#666]">
          {matches.length} trận{lastFetch && ` · ${lastFetch.toLocaleTimeString('vi-VN')}`}
        </span>
        {/* Toggle noti (goal/HT/toast) — dùng chung với SABA Live */}
        <span className="mx-0.5 h-4 w-px bg-[#2a2a2a]" />
        <SabaNotiToggles noti={noti} />
        <span className="mx-0.5 h-4 w-px bg-[#2a2a2a]" />
        <button
          type="button"
          onClick={() => setBulkLoad({ on: true, n: ++bulkN.current })}
          className="rounded px-2 py-0.5 text-[11px] border border-[#22c55e]/40 text-[#22c55e] bg-[#22c55e]/10 hover:bg-[#22c55e]/20 transition-colors"
          title="Mở tất cả video cùng lúc"
        >
          ▶ Bật hết
        </button>
        <button
          type="button"
          onClick={() => setBulkLoad({ on: false, n: ++bulkN.current })}
          className="rounded px-2 py-0.5 text-[11px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444] transition-colors"
          title="Tắt tất cả video cùng lúc"
        >
          ⏹ Tắt hết
        </button>
      </div>

      {error ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="text-3xl">⚠️</div>
          <div className="text-[13px] text-[#f87171]">{error}</div>
        </div>
      ) : matches.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="mb-3 text-4xl">📭</div>
          <div className="text-[14px] text-[#888]">Chưa có trận C-Sport nào đang phát trực tiếp.</div>
        </div>
      ) : !playerBase ? (
        // Có trận live nhưng session SABA rỗng/hết hạn → iframe sẽ 404. Hiện banner
        // thay vì mount iframe hỏng; user dán lại link ở thanh token phía trên.
        <div className="flex h-[200px] flex-col items-center justify-center gap-3 rounded-xl bg-[#1a1a1a] border border-[#f59e0b]/40">
          <div className="text-3xl">🔑</div>
          <div className="text-[13px] text-[#fbbf24]">Chưa có session SABA — dán lại link ở token bar</div>
        </div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {matches.map((m) => (
            <VideoCell key={m.matchId} match={m} playerBase={playerBase} displayW={cellW} bulk={bulkLoad} onToast={noti.showToast} />
          ))}
        </div>
      )}
      {/* Toast in-app (ghi bàn) — góc dưới-phải */}
      <SabaToastHost noti={noti} />
    </div>
  );
}
