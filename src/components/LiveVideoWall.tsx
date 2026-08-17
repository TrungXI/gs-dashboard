'use client';

import { useEffect, useRef, useState } from 'react';
import type { GsLiveMatch } from '../app/api/gs-live/route';
import { notiOnce } from '../lib/notiDedup';

const LS_TOKEN = 'gs_video_wall_token';
const REFRESH_MS = 2_000;

// Stream chia sẻ màn hình dùng chung cả session — xin quyền getDisplayMedia CHỈ 1 LẦN.
// Track chết (user stop share / tab đóng) → xoá cache để lần sau xin lại.
let sharedStream: MediaStream | null = null;
async function getShareStream(): Promise<MediaStream> {
  const track = sharedStream?.getVideoTracks()[0];
  if (track && track.readyState === 'live') return sharedStream!;
  const stream = await navigator.mediaDevices.getDisplayMedia({
    // Yêu cầu độ phân giải cao nhất có thể để ảnh crop nét hơn.
    video: {
      displaySurface: 'browser',
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 10 },
    },
    audio: false,
    preferCurrentTab: true,
  } as MediaStreamConstraints);
  sharedStream = stream;
  const vt = stream.getVideoTracks()[0];
  if (vt) vt.onended = () => { sharedStream = null; };
  return stream;
}

// Chụp ảnh CLIENT-SIDE (getDisplayMedia) tức thì: cắt đúng khung video đang phát
// (ô data-cap-event) rồi POST multipart lên /api/video-snapshot → gửi Telegram.
async function captureAndSend(
  match: GsLiveMatch,
  _token: string,
  score: { home: number; away: number },
): Promise<void> {
  const isHT = match.period === 4;
  const phase = isHT ? 'HT' : match.isH2 ? 'H2' : 'H1';

  const stream = await getShareStream();

  // <video> ẩn để lấy frame từ stream.
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  await v.play();
  // Chờ đúng 1 frame render xong trước khi vẽ canvas.
  await new Promise<void>((resolve) => {
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback;
    if (rvfc) rvfc.call(v, () => resolve());
    else setTimeout(resolve, 120);
  });

  try {
    const settings = stream.getVideoTracks()[0].getSettings();
    const tw = settings.width!;
    const th = settings.height!;
    // Stream chụp cả tab/màn hình theo pixel; toạ độ DOM theo CSS px → cần scale.
    const sx = tw / window.innerWidth;
    const sy = th / window.innerHeight;

    const el = document.querySelector(`[data-cap-event="${match.eventId}"]`);
    if (!el) throw new Error('không thấy khung video');
    const box = el.getBoundingClientRect();

    const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));
    // Nguồn crop trong stream — kẹp trong [0..tw]/[0..th] tránh tràn ngoài frame.
    const rawL = box.left * sx;
    const rawT = box.top * sy;
    const srcL = clamp(rawL, tw);
    const srcT = clamp(rawT, th);
    const srcW = clamp(box.width * sx, tw - srcL);
    const srcH = clamp(box.height * sy, th - srcT);

    // Canvas theo PIXEL NGUỒN (không phải CSS px) → giữ nguyên độ nét stream, không downscale.
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(srcW));
    canvas.height = Math.max(1, Math.round(srcH));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('không tạo được canvas');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(v, srcL, srcT, srcW, srcH, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95),
    );
    if (!blob) throw new Error('không tạo được ảnh');

    const fd = new FormData();
    fd.append('image', blob, 'shot.jpg');
    fd.append('eventId', String(match.eventId));
    fd.append('homeTeam', match.homeTeam);
    fd.append('awayTeam', match.awayTeam);
    fd.append('h1Home', String(score.home));
    fd.append('h1Away', String(score.away));
    fd.append('leagueName', match.leagueName || '');
    fd.append('phase', phase);

    const res = await fetch('/api/video-snapshot', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => ({ ok: false, error: 'lỗi phản hồi' }))) as {
      ok: boolean;
      error?: string;
    };
    if (!json.ok) throw new Error(json.error || 'gửi thất bại');
  } finally {
    // Chỉ nhả <video>, KHÔNG stop track chung để lần sau khỏi xin quyền lại.
    v.srcObject = null;
  }
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

// Màu giá Malay theo DẤU: dương → trắng, âm → đỏ. (Bên nhà/khách·tài/xỉu phân biệt bằng vị trí trái/phải.)
function priceCls(v: string | null | undefined): string {
  const n = parseFloat(String(v ?? ''));
  return !Number.isNaN(n) && n < 0 ? 'text-[#fb7185]' : 'text-white';
}

// Thẻ đỏ — ô đỏ nhỏ (+ số lượng nếu ≥2) cạnh tên đội, ẩn khi 0 (mirror RankingLive).
function RedCard({ n }: { n: number }) {
  if (!n || n <= 0) return null;
  return (
    <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 align-middle" title={`${n} thẻ đỏ`}>
      <span className="inline-block h-[11px] w-[8px] rounded-[2px] bg-[#ef4444]" />
      {n > 1 && <span className="text-[9px] font-bold text-[#ef4444]">×{n}</span>}
    </span>
  );
}

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
  return (
    <div className={`flex items-center gap-1 text-[10px] tabular-nums${divider ? ' border-t border-[#222] pt-0.5' : ''}`}>
      <span className="w-[30px] shrink-0 text-right text-[#888]">{dead ? '—' : row!.line ?? '—'}</span>
      <span className={`min-w-0 flex-1 whitespace-nowrap text-right font-semibold sm:truncate ${dead ? 'text-[#555]' : priceCls(row!.home)}`}>{dead ? '—' : row!.home ?? '—'}</span>
      <span className="shrink-0 text-[#555]">·</span>
      <span className={`min-w-0 flex-1 whitespace-nowrap font-semibold sm:truncate ${dead ? 'text-[#555]' : priceCls(row!.away)}`}>{dead ? '—' : row!.away ?? '—'}</span>
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
      <span className={`min-w-0 flex-1 whitespace-nowrap text-right font-semibold sm:truncate ${dead ? 'text-[#555]' : priceCls(row!.over)}`}>{dead ? '—' : row!.over ?? '—'}</span>
      <span className="shrink-0 text-[#555]">·</span>
      <span className={`min-w-0 flex-1 whitespace-nowrap font-semibold sm:truncate ${dead ? 'text-[#555]' : priceCls(row!.under)}`}>{dead ? '—' : row!.under ?? '—'}</span>
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
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-[#8ecbd6]">{label}</div>
      <div className="flex gap-2">
        {/* Chấp (trái) — line + nhà · khách */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {hcRows.map((row, idx) => (
            <HcLiveRow key={idx} row={row} divider={idx > 0} />
          ))}
        </div>
        {/* Tài Xỉu (phải) — line + tài · xỉu */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {ouRows.map((row, idx) => (
            <OuLiveRow key={idx} row={row} divider={idx > 0} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Hộp kèo dưới video: HAI nhóm — "H1" (hcH1Lines/ouH1Lines) + "Cả trận" (hcLines/ouLines).
// Khi nhà cái khoá kèo (match.suspended) → phủ mờ + ổ khoá CHỈ trên hộp này (cả 2 hiệp),
// video phía trên KHÔNG bị ảnh hưởng. Style ổ khoá mirror RankingLive (amber #fbbf24).
function OddsBox({ match }: { match: GsLiveMatch }) {
  // Khoá kèo per-match — mirror RankingLive (Tài Xỉu Live): đóng cược HOẶC O/U (cả trận / H1)
  // bị suspend, KHÔNG chỉ dựa kèo chấp (match.suspended). Nhà cái hay khoá riêng O/U.
  const locked =
    match.bettingOpen === false ||
    !!match.ouLines?.[0]?.suspended ||
    !!match.ouH1Lines?.[0]?.suspended ||
    match.suspended;
  return (
    <div className="relative border-t border-[#222] px-3 py-2">
      {/* Khoá kèo: phủ mờ + ổ khoá CHỈ hộp odds, không đụng video */}
      {locked && (
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
      {/* Mobile: 2 nhóm xếp DỌC (mỗi nhóm full bề ngang → số line không bị cắt).
          Desktop (sm+): nằm ngang cạnh nhau như cũ. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <OddsHalf label="Cả trận" hcLines={match.hcLines} ouLines={match.ouLines} />
        <div className="h-px w-full shrink-0 bg-[#222] sm:h-auto sm:w-px sm:self-stretch" />
        <OddsHalf label="H1" hcLines={match.hcH1Lines} ouLines={match.ouH1Lines} />
      </div>
    </div>
  );
}

// Một bàn thắng của trận đang live (từ /api/gs-live-goals): đội (h/a), hiệp, phút, tỉ số.
interface GoalEvent { e: number; s: 'h' | 'a'; h2: boolean; m: number; sh: number; sa: number; }

// Timeline ghi bàn cho MỘT trận — thanh H1|H2, chấm mỗi bàn kèm phút + tỉ số.
// Mirror cách RankingLive vẽ (nhà = cyan, khách = hồng). Rỗng → không render.
function GoalTimelineBar({ match, goals }: { match: GsLiveMatch; goals: GoalEvent[] }) {
  if (goals.length === 0) return null;
  const HOME = '#38bdf8', AWAY = '#fb7185';
  // Feed 20p (Asian lẫn International) chạy tới ~phút 50 mỗi hiệp; 16p ~45.
  const HALF_MAX = (match.matchType === '20p' || match.matchType === '20p_intl') ? 50 : 45;
  const posOf = (g: GoalEvent) => {
    const mm = Math.min(Math.max(g.m, 0), HALF_MAX);
    return g.h2 ? 50 + (mm / HALF_MAX) * 50 : (mm / HALF_MAX) * 50;
  };
  return (
    <div className="border-t border-[#222] px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-[9px] uppercase tracking-wide text-[#666]">
        <span>⚽ Timeline ghi bàn ({goals.length})</span>
        <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: HOME }} /><span className="max-w-[70px] truncate" style={{ color: HOME }}>{match.homeTeam}</span></span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: AWAY }} /><span className="max-w-[70px] truncate" style={{ color: AWAY }}>{match.awayTeam}</span></span>
        </span>
      </div>
      <div className="relative h-10 rounded border border-[#242424] bg-[#161616]">
        <div className="absolute inset-y-0 left-0 w-1/2 rounded-l bg-[#fbbf24]/[.04]" />
        <div className="absolute inset-y-0 right-0 w-1/2 rounded-r bg-[#4ade80]/[.04]" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-[#3a3a3a]" />
        <span className="absolute left-1 top-0.5 text-[8px] font-semibold text-[#fbbf24]/70">H1</span>
        <span className="absolute right-1 top-0.5 text-[8px] font-semibold text-[#4ade80]/70">H2</span>
        {goals.map((g, i) => {
          const left = posOf(g);
          const color = g.s === 'h' ? HOME : AWAY;
          const team = g.s === 'h' ? match.homeTeam : match.awayTeam;
          return (
            <div key={`${g.s}-${g.h2 ? 'H2' : 'H1'}-${g.m}-${g.sh}-${g.sa}-${i}`}
              className="absolute inset-y-0" style={{ left: `${left}%` }}
              title={`${team} ghi phút ${g.m}' (${g.h2 ? 'H2' : 'H1'}) — ${g.sh}-${g.sa}`}>
              <div className="absolute inset-y-1.5 w-px" style={{ background: color, opacity: 0.4, transform: 'translateX(-0.5px)' }} />
              <div className="absolute left-0 top-1/2 h-[9px] w-[9px] rounded-full" style={{ background: color, transform: 'translate(-50%,-50%)', boxShadow: '0 0 0 2px #161616' }} />
              <span className="absolute left-0 -top-0.5 text-[8px] font-bold tabular-nums" style={{ color, transform: 'translateX(-50%)' }}>{g.m}&apos;</span>
              <span className="absolute left-0 bottom-0 text-[7px] tabular-nums text-white/45" style={{ transform: 'translateX(-50%)' }}>{g.sh}-{g.sa}</span>
            </div>
          );
        })}
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
  bulk,
  h1Remembered,
  goals,
}: {
  token: string;
  agentId: string;
  match: GsLiveMatch;
  displayW: number;
  onToast: (msg: string, ok: boolean) => void;
  bulk: { on: boolean; n: number } | null;
  h1Remembered: { home: number; away: number } | undefined;
  goals: GoalEvent[];
}) {
  const [loaded, setLoaded] = useState(false);
  // "Bật hết / Tắt hết" từ parent → set loaded theo tín hiệu bulk. Ô mới mount cũng
  // theo trạng thái bulk mới nhất. Iframe đã keyed theo eventId nên khi loaded=true
  // rồi cuộn khuất/đổi tab KHÔNG remount → video WebRTC vẫn chạy tiếp.
  useEffect(() => { if (bulk) setLoaded(bulk.on); }, [bulk]);
  const [shooting, setShooting] = useState(false);
  const displayH = Math.round(displayW * ASPECT);
  const scale = displayW / CONTENT_W;
  const iframeH = Math.round(displayH / scale);
  const src = `https://det.zenandfe.com/?token=${encodeURIComponent(token)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${match.eventId}&brand=&muted=1`;
  const isHT = match.period === 4;
  // Box viền vàng: từ lúc vào HT cho đến hết phút 10 của H2.
  const isHtHighlight = isHT || (match.isH2 && match.minuteElapsed != null && match.minuteElapsed <= 10);
  // Đội chấp (favorite) → tô đỏ tên ở title. Ưu tiên kèo cả trận, fallback H1.
  const favSide = match.hcLines?.[0]?.favoriteSide ?? match.hcH1Lines?.[0]?.favoriteSide ?? null;

  // 📸 chụp CLIENT-SIDE tức thì (getDisplayMedia) → cắt khung video → gửi Telegram.
  const onSnapshot = async () => {
    if (shooting) return;
    setShooting(true);
    try {
      const useRemembered = match.h1Home === 0 && match.h1Away === 0 && !!h1Remembered;
      const score = useRemembered
        ? { home: h1Remembered!.home, away: h1Remembered!.away }
        : { home: match.h1Home, away: match.h1Away };
      await captureAndSend(match, token, score);
      onToast('Đã gửi ảnh vào Tele', true);
    } catch (e) {
      onToast('Không chụp được: ' + (e instanceof Error ? e.message : String(e)), false);
    } finally {
      setShooting(false);
    }
  };

  return (
    <div className={`rounded-lg border ${isHtHighlight ? 'border-yellow-400' : 'border-[#2a2a2a]'} bg-[#141414] overflow-hidden`}>
      {/* Header: teams + score + phase + 📸 chụp */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#222]">
        <div className="flex-1 min-w-0 text-[13px] font-semibold truncate">
          <span className={favSide === 'home' ? 'text-[#fb7185]' : 'text-white'}>{match.homeTeam}</span>
          <RedCard n={match.redHome} />
          <span className="text-[#555]"> vs </span>
          <span className={favSide === 'away' ? 'text-[#fb7185]' : 'text-white'}>{match.awayTeam}</span>
          <RedCard n={match.redAway} />
        </div>
        <div className="shrink-0 text-[14px] font-bold tabular-nums text-white">
          {/* Tỉ số: nếu live mất H1 (0-0) mà đã nhớ giá trị cũ thì hiện giá trị đã nhớ. */}
          {(() => {
            const useRemembered = match.h1Home === 0 && match.h1Away === 0 && !!h1Remembered;
            const home = useRemembered ? h1Remembered!.home : match.h1Home;
            const away = useRemembered ? h1Remembered!.away : match.h1Away;
            return `${home} - ${away}`;
          })()}
        </div>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#aaa] bg-white/[.06] border border-[#2a2a2a]">
          {isHT ? 'HT' : match.isH2 ? 'H2' : 'H1'}
          {match.minuteElapsed != null ? ` ${match.minuteElapsed}'` : ''}
        </span>
        {/* 📸 chụp — bên phải badge hiệp; chụp phía CLIENT tức thì rồi gửi Telegram */}
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

      {/* Video box — data-cap-event: 📸 crop đúng ô này (chỉ vùng iframe, không cả màn hình) */}
      <div data-cap-event={match.eventId} className="relative bg-black overflow-hidden" style={{ width: displayW, height: displayH }}>
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

      {/* Timeline ghi bàn — chỉ hiện khi trận đã có bàn. */}
      <GoalTimelineBar match={match} goals={goals} />
    </div>
  );
}

export default function LiveVideoWall() {
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

  // Toast — 1 thông báo fixed góc dưới-phải, tự ẩn sau 3s. Nhiều sự kiện trong 1 tick
  // (2 bàn cùng lúc, hết trận + ghi bàn…) nên dùng HÀNG ĐỢI: mỗi msg hiện tuần tự ~3s.
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastQueue = useRef<{ msg: string; ok: boolean }[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Rút msg kế tiếp khỏi hàng đợi; hết thì ẩn toast. Tự gọi lại sau 3s.
  const drainToast = () => {
    const next = toastQueue.current.shift();
    if (!next) { setToast(null); toastTimer.current = null; return; }
    setToast(next);
    toastTimer.current = setTimeout(drainToast, 3000);
  };
  // Đẩy 1 msg vào hàng đợi; nếu chưa có toast nào đang chạy thì khởi động vòng rút.
  const showToast = (msg: string, ok: boolean) => {
    toastQueue.current.push({ msg, ok });
    if (!toastTimer.current) drainToast();
  };

  // Noti OS/browser (ra Macbook) + toast in-app — bật/tắt ĐỘC LẬP với trang Ranking
  // (dùng key localStorage riêng cho video-wall). OS noti mặc định TẮT; toast mặc định BẬT.
  // Ref mirror để vòng poll (async) đọc giá trị mới nhất.
  const [osNotiGoal, setOsNotiGoal] = useState(false);
  const [osNotiHT, setOsNotiHT] = useState(false);
  const osNotiGoalRef = useRef(false);
  const osNotiHTRef = useRef(false);
  const [toastOn, setToastOn] = useState(true);
  const toastOnRef = useRef(true);
  // Công tắc TỔNG — tắt là im HẾT mọi kênh (toast + OS, ghi bàn + hết hiệp + hết
  // trận), bất kể 3 toggle con đang bật. Mặc định BẬT; chỉ '0' mới tắt.
  const [notiMaster, setNotiMaster] = useState(true);
  const notiMasterRef = useRef(true);
  useEffect(() => {
    const g = localStorage.getItem('gs_video_os_noti_goal') === '1';
    const h = localStorage.getItem('gs_video_os_noti_ht') === '1';
    setOsNotiGoal(g); osNotiGoalRef.current = g;
    setOsNotiHT(h);   osNotiHTRef.current = h;
    const t = localStorage.getItem('gs_video_toast') !== '0'; // chỉ '0' mới tắt
    setToastOn(t); toastOnRef.current = t;
    const master = localStorage.getItem('gs_video_noti_master') !== '0';
    setNotiMaster(master); notiMasterRef.current = master;
  }, []);

  async function requestAndSet(
    key: string,
    setter: (v: boolean) => void,
    ref: { current: boolean },
  ) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return;
    }
    setter(true); ref.current = true;
    localStorage.setItem(key, '1');
  }

  function notifyOS(kind: 'goal' | 'ht', title: string, body: string, eventId?: number) {
    if (!notiMasterRef.current) return; // công tắc tổng tắt → im hết
    const allowed = kind === 'goal' ? osNotiGoalRef.current : osNotiHTRef.current;
    if (!allowed) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (eventId != null && !notiOnce(`${kind}:${eventId}:${body.split('\n')[0]}`)) return; // chống noti trùng (nhiều nguồn/race)
    new Notification(title, { body, silent: false });
  }

  // Grid column width — đo cột thực bằng ResizeObserver để lưới 3 cột fill ngang.
  const gridRef = useRef<HTMLDivElement>(null);
  const [cellW, setCellW] = useState(FALLBACK_W);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      // Số cột theo breakpoint Tailwind của lưới (lg:3 · sm:2 · mobile:1) — phải khớp
      // grid-cols để cellW = bề rộng cột thật, iframe scale đúng.
      const iw = window.innerWidth;
      const cols = iw >= 1024 ? 3 : iw >= 640 ? 2 : 1;
      const gap = 12; // gap-3 = 0.75rem = 12px
      const total = el.clientWidth;
      const w = Math.floor((total - gap * (cols - 1)) / cols);
      if (w > 0) setCellW(w);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    // window resize cũng đo lại: vượt breakpoint / xoay ngang màn hình.
    window.addEventListener('resize', measure);
    return () => { obs.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // Lọc giải — Set các key giải ĐANG BẬT. Giải mới xuất hiện coi như BẬT mặc định
  // (chỉ ẩn giải user chủ động tắt). Không nhớ qua reload — mặc định BẬT hết mỗi lần load.
  const [disabledLeagues, setDisabledLeagues] = useState<Set<string>>(new Set());
  const toggleLeague = (key: string) => {
    setDisabledLeagues((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  // Mirror ra ref để noti loop (chạy trong interval, closure cũ) luôn đọc trạng thái mới nhất.
  const disabledLeaguesRef = useRef<Set<string>>(new Set());
  useEffect(() => { disabledLeaguesRef.current = disabledLeagues; }, [disabledLeagues]);

  // Snapshot trận ở tick TRƯỚC (keyed eventId) để diff sự kiện: tổng bàn, phase, còn-live.
  // primedRef=false ở lần fetch đầu → chỉ lập baseline, KHÔNG bắn toast.
  const prevSnapshotRef = useRef<Map<number, { total: number; home: number; away: number; phase: 'H1' | 'HT' | 'H2'; homeTeam: string; awayTeam: string; lgKey: string }>>(new Map());
  const primedRef = useRef(false);

  // Nhớ tỉ số H1 per-eventId (mirror RankingLive h1FinalRef/h1Finals): live API hay
  // NGỪNG gửi tỉ số H1 khi trận sang H2 → header về 0-0. Ghi lại khi h1Home/h1Away > 0
  // (và chốt lúc H1→H2), sau đó render giá trị đã nhớ để không mất tỉ số.
  const h1FinalRef = useRef<Map<number, { home: number; away: number }>>(new Map());
  const [h1Finals, setH1Finals] = useState<Map<number, { home: number; away: number }>>(new Map());

  // Match list — fetch /api/gs-live, refresh mỗi 15s, refetch khi token đổi.
  const [matches, setMatches] = useState<GsLiveMatch[]>([]);
  const [loading, setLoading] = useState(false);
  // Bật/tắt HẾT video: mỗi lần bấm đổi `n` để mọi VideoCell re-apply (kể cả ô mới mount).
  const [bulkLoad, setBulkLoad] = useState<{ on: boolean; n: number } | null>(null);
  const bulkN = useRef(0);
  // KHÔNG remount iframe khi đổi/quay lại tab (user 2026-08-15: giữ video chạy, đừng reload).
  // iframe không có key động + không unmount → luồng WebRTC tự resume khi quay lại, khỏi load lại.
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const fetchMatches = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/gs-live?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; matches?: GsLiveMatch[]; error?: string };
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error || 'Lỗi tải trận');
        const live = (json.matches ?? []).filter((m) => m.isLive);

        // Diff sự kiện so với snapshot tick trước — bỏ qua lần đầu (chỉ lập baseline).
        const next = new Map<number, { total: number; home: number; away: number; phase: 'H1' | 'HT' | 'H2'; homeTeam: string; awayTeam: string; lgKey: string }>();
        for (const m of live) {
          const phase: 'H1' | 'HT' | 'H2' = m.period === 4 ? 'HT' : m.isH2 ? 'H2' : 'H1';
          next.set(m.eventId, { total: m.h1Home + m.h1Away, home: m.h1Home, away: m.h1Away, phase, homeTeam: m.homeTeam, awayTeam: m.awayTeam, lgKey: (m.leagueName || '').trim() || m.matchType });
        }
        if (primedRef.current) {
          const prev = prevSnapshotRef.current;
          for (const m of live) {
            const before = prev.get(m.eventId);
            if (!before) continue; // trận mới xuất hiện — không có gì để so
            // Giải đang TẮT filter → không bắn noti (khớp key với groupByLeague/hiển thị).
            if (disabledLeaguesRef.current.has((m.leagueName || '').trim() || m.matchType)) continue;
            const nowTotal = m.h1Home + m.h1Away;
            // Ghi bàn: tổng bàn tăng → toast (nếu bật) + noti OS
            if (nowTotal > before.total) {
              const goalMin = m.minuteElapsed != null ? ` · ${m.minuteElapsed}'` : '';
              const scorer = m.h1Home > before.home ? m.homeTeam : m.h1Away > before.away ? m.awayTeam : null;
              const scorerLabel = scorer ? `${scorer} ghi bàn` : 'Ghi bàn';
              if (notiMasterRef.current && toastOnRef.current) showToast(`⚽ ${scorerLabel} · ${m.homeTeam} ${m.h1Home}-${m.h1Away} ${m.awayTeam}${goalMin}`, true);
              notifyOS('goal', `⚽ ${scorerLabel}!`, `${m.homeTeam} ${m.h1Home}-${m.h1Away} ${m.awayTeam}${goalMin ? `\n${goalMin.trim()}` : ''}`, m.eventId);
            }
            // Hết hiệp 1: phase trước là H1, giờ sang HT (period=4) → toast (nếu bật) + noti OS
            if (before.phase === 'H1' && m.period === 4) {
              if (notiMasterRef.current && toastOnRef.current) showToast(`⏸️ Hết hiệp 1 · ${m.homeTeam} vs ${m.awayTeam}`, true);
              notifyOS('ht', '🔔 Hết Hiệp 1', `${m.homeTeam} ${m.h1Home}-${m.h1Away} ${m.awayTeam}`, m.eventId);
            }
          }
          // Hết trận: eventId có ở snapshot trước nhưng biến mất khỏi list live hiện tại (chỉ toast in-app)
          for (const [eid, before] of prev) {
            if (!next.has(eid)) {
              if (disabledLeaguesRef.current.has(before.lgKey)) continue; // giải tắt → bỏ qua
              if (notiMasterRef.current && toastOnRef.current) showToast(`🏁 Hết trận · ${before.homeTeam} vs ${before.awayTeam}`, true);
            }
          }
        }
        // Nhớ tỉ số H1: ghi khi thấy giá trị > 0 (mirror RankingLive — chốt H1 khi còn
        // đọc được). Khi API sau đó ngừng gửi (0-0/blank) thì giữ nguyên giá trị đã nhớ.
        let h1Changed = false;
        for (const m of live) {
          if (m.h1Home > 0 || m.h1Away > 0) {
            const prev = h1FinalRef.current.get(m.eventId);
            if (!prev || prev.home !== m.h1Home || prev.away !== m.h1Away) {
              h1FinalRef.current.set(m.eventId, { home: m.h1Home, away: m.h1Away });
              h1Changed = true;
            }
          }
        }
        if (h1Changed) setH1Finals(new Map(h1FinalRef.current));

        prevSnapshotRef.current = next;
        primedRef.current = true;

        setMatches(live);
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
  }, [token]);

  // Timeline ghi bàn per trận live — từ /api/gs-live-goals (ưu tiên gs_16p_ticks,
  // có cả International 20p). Key = danh sách eventId live (đổi khi trận vào/ra) →
  // fetch NGAY, sau đó 10s/lần (bàn thắng hiếm). Tab ẩn thì ngừng cho nhẹ.
  const [goalLog, setGoalLog] = useState<GoalEvent[]>([]);
  const liveIdsKey = matches.map((m) => m.eventId).sort((a, b) => a - b).join(',');
  useEffect(() => {
    if (!liveIdsKey) { setGoalLog([]); return; }
    let alive = true;
    const fetchGoals = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(`/api/gs-live-goals?events=${liveIdsKey}`, { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; goals?: GoalEvent[] };
        if (alive && json.ok) setGoalLog(json.goals ?? []);
      } catch { /* giữ nguyên */ }
    };
    fetchGoals();
    const gid = setInterval(fetchGoals, 10000);
    return () => { alive = false; clearInterval(gid); };
  }, [liveIdsKey]);

  return (
    <div className="p-5">
      {/* Top section: title + token input + refresh status */}
      <div className="mb-2">
        {/* Header gọn: tiêu đề + trạng thái + toggle noti + bật/tắt hết trên CÙNG 1 hàng wrap */}
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-base font-bold text-white whitespace-nowrap">Video Live</h1>
          <span className="text-[11px] text-[#666]">
            {matches.length} trận{lastFetch && ` · ${lastFetch.toLocaleTimeString('vi-VN')}`}
          </span>
          {/* Công tắc TỔNG — tắt là im HẾT (toast + OS, mọi loại). Ưu tiên cao nhất. */}
          <button
            type="button"
            onClick={() => {
              const next = !notiMaster;
              setNotiMaster(next); notiMasterRef.current = next;
              localStorage.setItem('gs_video_noti_master', next ? '1' : '0');
            }}
            className={`rounded px-2 py-0.5 text-[11px] font-semibold border transition-colors ${notiMaster ? 'border-[#22c55e]/40 text-[#22c55e] bg-[#22c55e]/10 hover:bg-[#22c55e]/20' : 'border-[#f87171]/50 text-[#f87171] bg-[#f87171]/10 hover:bg-[#f87171]/20'}`}
            title={notiMaster ? 'Đang bật thông báo — bấm để TẮT HẾT' : 'Đã tắt hết thông báo — bấm để bật lại'}
          >
            {notiMaster ? '🔔 Thông báo: BẬT' : '🔕 Đã tắt hết'}
          </button>
          <button
            type="button"
            disabled={!notiMaster}
            onClick={() => {
              if (osNotiGoal) { setOsNotiGoal(false); osNotiGoalRef.current = false; localStorage.setItem('gs_video_os_noti_goal', '0'); }
              else requestAndSet('gs_video_os_noti_goal', setOsNotiGoal, osNotiGoalRef);
            }}
            className={`rounded px-2 py-0.5 text-[11px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${osNotiGoal ? 'border-[#22c55e]/40 text-[#22c55e] bg-[#22c55e]/10 hover:bg-[#22c55e]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
            title={osNotiGoal ? 'Tắt noti ghi bàn' : 'Bật noti ghi bàn ra Macbook'}
          >
            {osNotiGoal ? '⚽ Ghi bàn ON' : '⚽ Ghi bàn OFF'}
          </button>
          <button
            type="button"
            disabled={!notiMaster}
            onClick={() => {
              if (osNotiHT) { setOsNotiHT(false); osNotiHTRef.current = false; localStorage.setItem('gs_video_os_noti_ht', '0'); }
              else requestAndSet('gs_video_os_noti_ht', setOsNotiHT, osNotiHTRef);
            }}
            className={`rounded px-2 py-0.5 text-[11px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${osNotiHT ? 'border-[#fbbf24]/40 text-[#fbbf24] bg-[#fbbf24]/10 hover:bg-[#fbbf24]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
            title={osNotiHT ? 'Tắt noti hết H1' : 'Bật noti hết H1 ra Macbook'}
          >
            {osNotiHT ? '🔔 Hết H1 ON' : '🔔 Hết H1 OFF'}
          </button>
          {/* Bật/tắt toast popup trong app */}
          <button
            type="button"
            disabled={!notiMaster}
            onClick={() => {
              const next = !toastOn;
              setToastOn(next); toastOnRef.current = next;
              localStorage.setItem('gs_video_toast', next ? '1' : '0');
            }}
            className={`rounded px-2 py-0.5 text-[11px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toastOn ? 'border-[#17a2b8]/40 text-[#3dd6ea] bg-[#17a2b8]/10 hover:bg-[#17a2b8]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
            title={toastOn ? 'Tắt toast popup trong app' : 'Bật toast popup trong app'}
          >
            {toastOn ? '💬 Toast ON' : '🔕 Toast OFF'}
          </button>
          {/* Bật/tắt TẤT CẢ video 1 lần (n đổi mỗi lần bấm để re-fire kể cả bấm lại) */}
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
        <input
          type="text"
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder="Dán token hoặc nguyên link…"
          className="w-full max-w-[260px] rounded-lg bg-white/[.07] px-2.5 py-1 text-xs text-white placeholder:text-[#666] outline-none border border-[#2a2a2a] focus:border-[#17a2b8]"
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
        <div className="flex flex-col gap-4">
          {/* Lọc giải đấu — chip toggle mỗi giải đang live; mặc định BẬT, TẮT thì mờ. */}
          <div className="flex flex-wrap gap-1.5">
            {groupByLeague(matches).map((section) => {
              const on = !disabledLeagues.has(section.key);
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => toggleLeague(section.key)}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold border transition-colors ${
                    on
                      ? 'border-[#17a2b8] bg-[#17a2b8]/15 text-[#8ee]'
                      : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#666] hover:text-[#999]'
                  }`}
                >
                  {section.name}
                  <span className="ml-1 text-[9px] opacity-70">{section.matches.length}</span>
                </button>
              );
            })}
          </div>

          {groupByLeague(matches).filter((section) => !disabledLeagues.has(section.key)).map((section, si) => (
            <section key={section.key}>
              {/* Header giải: tên giải + badge số trận */}
              <div className="mb-2 flex items-center gap-2 border-b border-[#222] pb-1.5">
                <h2 className="text-[15px] font-bold text-white">{section.name}</h2>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#aaa] bg-white/[.06] border border-[#2a2a2a]">
                  {section.matches.length} trận
                </span>
              </div>
              <div ref={si === 0 ? gridRef : undefined} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {section.matches.map((m) => (
                  <VideoCell key={m.eventId} token={token} agentId={agentId} match={m} displayW={cellW} onToast={showToast} bulk={bulkLoad} h1Remembered={h1Finals.get(m.eventId)} goals={goalLog.filter((g) => g.e === m.eventId)} />
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
