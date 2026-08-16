'use client';

import { useEffect, useRef, useState } from 'react';
import SabaTokenBar from './SabaTokenBar';
import { useSabaNoti, SabaNotiToggles, SabaToastHost } from './SabaNoti';

// ── SABA (C-Sport) live odds page ────────────────────────────────────────────
// Mirrors RankingLive.tsx's card visual (score + phase + 1X2 + Chấp + Tài Xỉu)
// but TRIMMED: SABA has NO K-Sport history / H2H / TX-signal / whitelist data,
// so none of those overlays are wired. Data comes from /api/gs-saba-live (DB),
// polled every 2s. See SPEC §6.1.

// Response shape from /api/gs-saba-live (SPEC §5.1). Structurally a subset of the
// K-Sport GsLiveMatch the card renderer needs, plus SABA-only fields (raw names,
// mapped flags, matchId, hasStreaming).
type OuLine = { line: string | null; over: string | null; under: string | null; suspended?: boolean };
type HcLine = { line: string | null; home: string | null; away: string | null; homeGives: boolean; favoriteSide: 'home' | 'away' | null };

// Thể thức Virtual PES từ feed SABA — các giải cùng tên nhưng khác thể thức chơi rất khác nhau.
type PlayFormat = '5min' | '15min' | '20min' | 'penalty';
// Chip lọc theo thể thức (thứ tự cố định). null = "Tất cả".
const PLAY_FORMAT_CHIPS: { key: PlayFormat; label: string }[] = [
  { key: '5min', label: "5'" },
  { key: '15min', label: "15'" },
  { key: '20min', label: "20'" },
  { key: 'penalty', label: 'Penalty' },
];

export interface SabaLiveMatch {
  matchId: number;
  eventId: number; // alias = matchId (React key)
  leagueId: number | null;
  leagueName: string;
  leagueNameVn: string | null;   // tên giải tiếng Việt (ưu tiên hiển thị); null → fallback leagueName
  leagueGroupId: number | null;  // nhóm giải (thứ tự section); null → xếp cuối
  countryCode: string | null;    // mã quốc gia (cờ), e.g. 'EN', 'ES'; null → ẩn cờ
  playFormat: PlayFormat | null; // thể thức Virtual PES: 5/15/20 phút hoặc penalty; null → 'Khác'
  matchType: 'saba';
  homeTeam: string; // canonical_name ?? raw home_team
  awayTeam: string;
  homeTeamRaw: string;
  awayTeamRaw: string;
  mappedHome: boolean;
  mappedAway: boolean;
  h1Home: number;
  h1Away: number;
  homeRed: number;               // thẻ đỏ đội nhà (0 → không hiện badge)
  awayRed: number;               // thẻ đỏ đội khách
  goalTeam: 'home' | 'away' | null; // đội vừa ghi bàn gần nhất (⚽ mờ); null → không hiện
  penStatus: string | null;      // trạng thái loạt penalty (giải PENALTY SHOOTOUTS); null → ẩn
  minuteElapsed: number | null;
  period: number;
  isH2: boolean;
  isLive: boolean;
  bettingOpen: boolean;
  suspended: boolean;
  oddsHome: number | null;
  oddsAway: number | null;
  oddsDraw: number | null;
  malayHome: string | null;
  malayAway: string | null;
  malayDraw: string | null;
  hcLines: HcLine[];
  hcH1Lines: HcLine[];
  ouLines: OuLine[];
  ouH1Lines: OuLine[];
  hasStreaming: boolean;
}

// ── Phase badge — self-contained (SABA has no startTime; drive off feed state) ──
// isLive=false → KT (kết thúc) / no live marker; period 4 → HT; H2 → green; else H1.
function phaseParts(m: SabaLiveMatch): { big: string; small: string | null; color: string } {
  if (!m.isLive) return { big: 'KT', small: null, color: '#888' };
  if (m.period === 4) return { big: 'HT', small: 'Nghỉ', color: '#fbbf24' };
  const min = m.minuteElapsed ?? 0;
  if (m.isH2) return { big: 'H2', small: `${min}'`, color: '#4ade80' };
  return { big: 'H1', small: `${min}'`, color: '#fbbf24' };
}

// Tên giải hiển thị: ưu tiên tiếng Việt, fallback tên gốc, fallback 'C-Sport'.
function leagueLabel(m: SabaLiveMatch): string {
  return (m.leagueNameVn && m.leagueNameVn.trim()) || (m.leagueName && m.leagueName.trim()) || 'C-Sport';
}

// Cờ quốc gia bằng emoji suy từ mã 2 ký tự (ISO alpha-2 → regional indicators).
// Mã không hợp lệ / null → chuỗi rỗng (ẩn cờ).
function countryFlag(code: string | null): string {
  if (!code) return '';
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)));
}

// Gom trận theo giải. Key = leagueId (fallback tên giải). Mỗi section giữ nhãn +
// cờ + danh sách trận. Sắp xếp section theo (leagueGroupId, tên giải); trong section
// theo tên đội nhà. leagueGroupId null → xếp cuối (Number.MAX_SAFE_INTEGER).
interface LeagueSection {
  key: string;
  leagueId: number | null;
  label: string;
  flag: string;
  groupId: number;
  matches: SabaLiveMatch[];
}
function groupByLeague(matches: SabaLiveMatch[]): LeagueSection[] {
  const map = new Map<string, LeagueSection>();
  for (const m of matches) {
    const key = m.leagueId != null ? `id:${m.leagueId}` : `name:${leagueLabel(m)}`;
    let sec = map.get(key);
    if (!sec) {
      sec = {
        key,
        leagueId: m.leagueId,
        label: leagueLabel(m),
        flag: countryFlag(m.countryCode),
        groupId: m.leagueGroupId ?? Number.MAX_SAFE_INTEGER,
        matches: [],
      };
      map.set(key, sec);
    }
    sec.matches.push(m);
  }
  const sections = [...map.values()];
  for (const sec of sections) {
    sec.matches.sort((a, b) => a.homeTeam.localeCompare(b.homeTeam));
  }
  sections.sort((a, b) => (a.groupId !== b.groupId ? a.groupId - b.groupId : a.label.localeCompare(b.label)));
  return sections;
}

// ── Ported verbatim from RankingLive (self-contained, no K-Sport deps) ──────────

// Thẻ đỏ — ô đỏ nhỏ (+ số lượng nếu ≥2) cạnh tên đội, ẩn khi 0.
function RedCardBadge({ n }: { n: number }) {
  if (!n || n <= 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5" title={`${n} thẻ đỏ`}>
      <span className="inline-block h-[13px] w-[9px] rounded-[2px] bg-[#ef4444] shadow-[0_0_3px_rgba(239,68,68,.6)]" />
      {n > 1 && <span className="text-[10px] font-bold tabular-nums text-[#ef4444]">×{n}</span>}
    </span>
  );
}

// Một dòng OU line: line — Tài <over> · Xỉu <under>. Line thiếu/suspended → mọi ô "—".
// Tài xanh lá (#4ade80), Xỉu đỏ (#fb7185) — đồng bộ card.
function OuLiveRow({ row, divider }: { row: OuLine | null; divider: boolean }) {
  const dead = !row || row.suspended;
  return (
    <div className={`flex items-center gap-1 text-[10px] md:text-[11px] tabular-nums${divider ? ' border-t border-[#222] pt-0.5' : ''}`}>
      <span className="w-[26px] md:w-[30px] shrink-0 text-right text-[#888]">{dead ? '—' : row!.line ?? '—'}</span>
      <span className="min-w-0 flex-1 truncate text-[#4ade80]">Tài <span className="font-semibold">{dead ? '—' : row!.over ?? '—'}</span></span>
      <span className="shrink-0 text-[#555]">·</span>
      <span className="min-w-0 flex-1 truncate text-[#fb7185]">Xỉu <span className="font-semibold">{dead ? '—' : row!.under ?? '—'}</span></span>
    </div>
  );
}

// Box OU line LIVE cho MỘT hiệp (H1 hoặc H2/cả trận). Luôn giữ khung 2 dòng;
// thiếu line thì dòng đó hiện "—". active = hiệp ĐANG đá → tô viền/nền xanh da trời.
function OuLiveBox({ title, lines, active = false }: { title: string; lines?: OuLine[]; active?: boolean }) {
  const src = lines ?? [];
  const rows: (OuLine | null)[] = [src[0] ?? null, src[1] ?? null];
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col rounded-md border px-2 py-1.5 ${
        active ? 'border-[#38bdf8]/50 bg-[#38bdf8]/15' : 'border-[#2a2a2a] bg-[#1c1c1c]'
      }`}
    >
      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#777]">{title}</div>
      <div className="flex flex-col gap-0.5">
        {rows.map((row, idx) => (
          <OuLiveRow key={idx} row={row} divider={idx > 0} />
        ))}
      </div>
    </div>
  );
}

// Màu giá Malay theo DẤU: dương → trắng, âm → đỏ (mirror LiveVideoWall priceCls).
function priceCls(v: string | null | undefined): string {
  const n = parseFloat(String(v ?? ''));
  return !Number.isNaN(n) && n < 0 ? 'text-[#fb7185]' : 'text-white';
}

// ── Chấp (HDP) row — trimmed from LiveVideoWall's HcLiveRow ───────────────────
// line + nhà · khách (Malay). Line thiếu → "—".
function HcRow({ row, divider }: { row: HcLine | null; divider: boolean }) {
  const dead = !row;
  return (
    <div className={`flex items-center gap-1 text-[10px] md:text-[11px] tabular-nums${divider ? ' border-t border-[#222] pt-0.5' : ''}`}>
      <span className="w-[26px] md:w-[30px] shrink-0 text-right text-[#888]">{dead ? '—' : row!.line ?? '—'}</span>
      <span className={`min-w-0 flex-1 truncate text-right font-semibold ${dead ? 'text-[#555]' : priceCls(row!.home)}`}>{dead ? '—' : row!.home ?? '—'}</span>
      <span className="shrink-0 text-[#555]">·</span>
      <span className={`min-w-0 flex-1 truncate font-semibold ${dead ? 'text-[#555]' : priceCls(row!.away)}`}>{dead ? '—' : row!.away ?? '—'}</span>
    </div>
  );
}

// Box Chấp (HDP) cho MỘT hiệp — 2 line, giữ khung như OuLiveBox.
function HcBox({ title, lines, active = false }: { title: string; lines?: HcLine[]; active?: boolean }) {
  const src = lines ?? [];
  const rows: (HcLine | null)[] = [src[0] ?? null, src[1] ?? null];
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col rounded-md border px-2 py-1.5 ${
        active ? 'border-[#38bdf8]/50 bg-[#38bdf8]/15' : 'border-[#2a2a2a] bg-[#1c1c1c]'
      }`}
    >
      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#777]">{title}</div>
      <div className="flex flex-col gap-0.5">
        {rows.map((row, idx) => (
          <HcRow key={idx} row={row} divider={idx > 0} />
        ))}
      </div>
    </div>
  );
}

// ── Trimmed card (mirror RankingLive MatchBox, K-Sport overlays stripped) ─────
function MatchBox({ m, onWatch }: { m: SabaLiveMatch; onWatch: (matchId: number) => void }) {
  const isHT = m.period === 4;
  const phase = phaseParts(m);
  // Hiệp đang diễn ra → box tương ứng (HT coi như đã sang FT/H2).
  const activeMarket = isHT ? 'ft' : phase.big === 'H1' ? 'h1' : phase.big === 'H2' ? 'ft' : null;
  // Đội chấp (favorite) theo marker handicap tường minh từ feed.
  const favoriteSide = m.hcLines[0]?.favoriteSide ?? m.hcH1Lines[0]?.favoriteSide ?? null;
  const unmapped = m.mappedHome === false || m.mappedAway === false;
  // Nhà cái KHOÁ kèo trận NÀY: đóng cược hoặc kèo O/U bị suspend.
  const locked = !!m.isLive && (m.bettingOpen === false || m.ouLines?.[0]?.suspended || m.ouH1Lines?.[0]?.suspended);
  // 1X2 hiển thị: ưu tiên giá Malay verbatim; nếu chỉ có decimal thì hiện decimal.
  const cell1x2 = (malay: string | null, dec: number | null): string => {
    if (malay != null && malay !== '') return malay;
    if (dec != null) return dec.toFixed(2);
    return '—';
  };

  return (
    <div
      data-event-id={m.eventId}
      className="rounded-lg border border-[#2a2a2a] bg-[#141414] p-3 w-full min-w-0 h-full relative flex flex-col gap-2"
    >
      {/* Khoá kèo: phủ mờ CẢ box + ổ khoá nổi lên */}
      {locked && (
        <>
          <div className="pointer-events-none absolute inset-0 z-10 rounded-lg bg-[#0d0d0d]/60" />
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="flex items-center gap-1.5 rounded-md border border-[#fbbf24]/50 bg-black/80 px-3 py-1.5 text-[12px] font-semibold text-[#fbbf24] shadow-lg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Nhà cái khoá kèo
            </div>
          </div>
        </>
      )}
      {/* Dòng 1: tên đội + tỉ số (trái) · phase (phải) */}
      <div className="flex items-center justify-between gap-2 md:gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-2 md:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] md:text-[14px] font-semibold leading-tight">
              <span title={m.mappedHome === false ? `Chưa map: ${m.homeTeamRaw}` : favoriteSide === 'home' ? 'Đội chấp theo handicap live' : undefined} className={`truncate text-[#4ade80] ${favoriteSide === 'home' ? 'underline decoration-[#ef4444] decoration-2 underline-offset-4' : ''}`}>{m.homeTeam}</span>
              {m.goalTeam === 'home' && <span className="shrink-0 text-[11px] opacity-80" title="Đội nhà vừa ghi bàn">⚽</span>}
              <RedCardBadge n={m.homeRed} />
              <span className="shrink-0 font-normal text-[#888]">vs</span>
              <span title={m.mappedAway === false ? `Chưa map: ${m.awayTeamRaw}` : favoriteSide === 'away' ? 'Đội chấp theo handicap live' : undefined} className={`truncate text-[#fb7185] ${favoriteSide === 'away' ? 'underline decoration-[#ef4444] decoration-2 underline-offset-4' : ''}`}>{m.awayTeam}</span>
              {m.goalTeam === 'away' && <span className="shrink-0 text-[11px] opacity-80" title="Đội khách vừa ghi bàn">⚽</span>}
              <RedCardBadge n={m.awayRed} />
              {/* Cờ "chưa map" — làm backlog mapping thủ công hiện rõ trên trang */}
              {unmapped && (
                <span
                  className="shrink-0 rounded border border-[#f59e0b]/50 bg-[#f59e0b]/15 px-1.5 py-0.5 text-[10px] md:text-[11px] font-semibold text-[#fcd34d]"
                  title={`Chưa map sang tên GS: ${m.homeTeamRaw} vs ${m.awayTeamRaw}`}
                >
                  ⚠ chưa map
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[18px] md:text-[20px] font-bold leading-none text-[#fbbf24]">
              {m.h1Home} - {m.h1Away}
            </div>
            {/* Trạng thái loạt luân lưu (giải PENALTY SHOOTOUTS) — chỉ hiện khi có. */}
            {m.penStatus && (
              <div className="mt-0.5 text-[9px] md:text-[10px] font-semibold uppercase tracking-wide text-[#c084fc]" title="Trạng thái loạt luân lưu">
                ⚽ {m.penStatus}
              </div>
            )}
          </div>
        </div>
        <div className="flex w-[52px] md:w-[60px] flex-col items-center justify-center text-center shrink-0 border-l border-[#222] pl-2 md:pl-3">
          <div className="text-[26px] md:text-[30px] font-extrabold leading-none" style={{ color: phase.color }}>
            {phase.big}
          </div>
          {phase.small && (
            <div className="text-[12px] md:text-[13px] font-semibold text-[#aaa] mt-1">{phase.small}</div>
          )}
          {/* Watch link → chuyển sang tab SABA Video, deep-link matchId */}
          {m.hasStreaming && (
            <button
              type="button"
              onClick={() => onWatch(m.matchId)}
              title="Xem video trực tiếp trận này"
              className="mt-1.5 inline-flex items-center gap-1 rounded border border-[#3a3a3a] bg-[#1c1c1c] px-1.5 py-0.5 text-[10px] md:text-[11px] font-semibold text-[#bbb] transition-colors hover:border-[#38bdf8]/60 hover:text-[#7dd3fc]"
            >
              📺 Video
            </button>
          )}
        </div>
      </div>
      {/* 1X2 — nhà · hoà · khách (Malay verbatim, fallback decimal) */}
      <div className="flex items-stretch gap-1.5 md:gap-2 text-[11px] md:text-[12px] tabular-nums">
        <div className="flex min-w-0 flex-1 flex-col items-center rounded-md border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-[#777]">1</span>
          <span className={`font-semibold ${priceCls(m.malayHome)}`}>{cell1x2(m.malayHome, m.oddsHome)}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center rounded-md border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-[#777]">X</span>
          <span className={`font-semibold ${priceCls(m.malayDraw)}`}>{cell1x2(m.malayDraw, m.oddsDraw)}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center rounded-md border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-[#777]">2</span>
          <span className={`font-semibold ${priceCls(m.malayAway)}`}>{cell1x2(m.malayAway, m.oddsAway)}</span>
        </div>
      </div>
      {/* Chấp (HDP) — 2 box: H1 + Hiệp 2 / cả trận */}
      <div className="mt-1.5 border-t border-[#222] pt-1.5">
        <div className="mb-1 text-[9px] md:text-[10px] uppercase tracking-wide text-[#666]">🎯 Chấp (live)</div>
        <div className="flex gap-1.5 md:gap-2">
          <HcBox title="🕐 Hiệp 1" lines={m.hcH1Lines} active={activeMarket === 'h1'} />
          <HcBox title="⚽ Hiệp 2 / cả trận" lines={m.hcLines} active={activeMarket === 'ft'} />
        </div>
      </div>
      {/* OU line LIVE — 2 box: H1 + Hiệp 2 / cả trận */}
      <div className="mt-1.5 border-t border-[#222] pt-1.5">
        <div className="mb-1 text-[9px] md:text-[10px] uppercase tracking-wide text-[#666]">📊 Tài Xỉu (live)</div>
        <div className="flex gap-1.5 md:gap-2">
          <OuLiveBox title="🕐 Hiệp 1" lines={m.ouH1Lines} active={activeMarket === 'h1'} />
          <OuLiveBox title="⚽ Hiệp 2 / cả trận" lines={m.ouLines} active={activeMarket === 'ft'} />
        </div>
      </div>
    </div>
  );
}

export default function SabaFootballLive({ initialMatch = null }: { initialMatch?: number | null }) {
  const [matches, setMatches] = useState<SabaLiveMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Giải đang chọn để lọc (jump-chip). null = hiện tất cả section. Key khớp LeagueSection.key.
  const [activeLeague, setActiveLeague] = useState<string | null>(null);
  // Thể thức chơi đang lọc (5'/15'/20'/Penalty). null = tất cả thể thức.
  const [activeFormat, setActiveFormat] = useState<PlayFormat | null>(null);
  // Noti chung (OS goal/HT + toast) — dùng chung với SABA Video qua SabaNoti.
  const noti = useSabaNoti();
  const detectRef = useRef(noti.detect);
  detectRef.current = noti.detect;
  // Tick 30s để phút hiển thị cập nhật (mirror RankingLive nowMs) — nhẹ, chỉ ép render.
  const [, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) setNowMs(Date.now()); }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Watch link → chuyển view sang SABA Video + deep-link matchId qua URL param.
  const goToVideo = (matchId: number) => {
    window.location.href = `/?view=saba-video&match=${matchId}`;
  };

  // Deep-link (initialMatch) — cuộn tới trận đó khi list có (chỉ 1 lần).
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || initialMatch == null) return;
    const el = document.querySelector(`[data-event-id="${initialMatch}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      deepLinkDone.current = true;
    }
  }, [initialMatch, matches]);

  // Poll /api/gs-saba-live mỗi 2s — inflight guard chặn chồng request khi API chậm;
  // ngừng poll khi tab ẩn (4G/pin).
  useEffect(() => {
    let alive = true;
    let inflight = false;

    async function poll() {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (inflight) return;
      inflight = true;
      try {
        const res = await fetch('/api/gs-saba-live', { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; matches?: SabaLiveMatch[]; error?: string };
        if (!alive) return;
        if (!json.ok) {
          setError(json.error ?? 'Lỗi tải dữ liệu');
        } else {
          setError(null);
          const next = json.matches ?? [];
          setMatches(next);
          // Phát hiện ghi bàn / hết H1 client-side rồi bắn noti/toast (giống GS).
          detectRef.current(next.map((m) => ({
            matchId: m.matchId,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            scoreHome: m.h1Home,
            scoreAway: m.h1Away,
            period: m.period,
            minute: m.minuteElapsed,
            goalTeam: m.goalTeam,
          })));
        }
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        inflight = false;
      }
    }

    poll();
    const POLL_MS = 2_000;
    const id = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // API chỉ trả trận đang live (is_live=true, backend lọc), nên mỗi trận = 1 trận live.
  // Lọc theo thể thức chơi TRƯỚC (ảnh hưởng cả chip giải + section), rồi gom theo giải.
  const formatMatches = activeFormat ? matches.filter((m) => m.playFormat === activeFormat) : matches;
  // Số trận mỗi thể thức cho badge chip (đếm trên TOÀN bộ trận live, không theo filter giải).
  const formatCounts = (fmt: PlayFormat) => matches.filter((m) => m.playFormat === fmt).length;
  const sections = groupByLeague(formatMatches);
  // activeLeague còn hợp lệ sau khi đổi thể thức? Nếu section biến mất thì coi như bỏ lọc giải.
  const leagueStillShown = activeLeague != null && sections.some((s) => s.key === activeLeague);
  const shownSections = leagueStillShown ? sections.filter((s) => s.key === activeLeague) : sections;

  return (
    <div className="flex flex-col gap-4">
      {/* Thanh nhập token session SABA (dùng chung với trang SABA Video) */}
      <SabaTokenBar />
      {/* Header: tiêu đề + số trận live + số giải + toggle noti (goal/HT/toast) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-base font-bold text-white whitespace-nowrap">SABA Football Live</h1>
        <span className="text-[11px] text-[#666]">
          {matches.length} trận đang live · {sections.length} giải
          {activeFormat && ` · lọc ${PLAY_FORMAT_CHIPS.find((c) => c.key === activeFormat)?.label}`}
        </span>
        <span className="mx-0.5 h-4 w-px bg-[#2a2a2a]" />
        <SabaNotiToggles noti={noti} />
      </div>

      {error ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="text-3xl">⚠️</div>
          <div className="text-[13px] text-[#f87171]">{error}</div>
        </div>
      ) : matches.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="mb-3 text-4xl">📭</div>
          <div className="text-[14px] text-[#888]">Chưa có trận C-Sport nào đang live.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Chip lọc theo THỂ THỨC chơi (Virtual PES 5'/15'/20'/Penalty) — các thể thức
              hành xử khác nhau nên lọc rất hữu ích. Ẩn chip không có trận live nào. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#555]">Thể thức</span>
            <button
              type="button"
              onClick={() => setActiveFormat(null)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border transition-colors ${
                activeFormat === null
                  ? 'border-[#f0a500] bg-[#f0a500]/15 text-[#fcd34d]'
                  : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#bbb]'
              }`}
            >
              Tất cả<span className="ml-1 text-[9px] opacity-70">{matches.length}</span>
            </button>
            {PLAY_FORMAT_CHIPS.filter((c) => formatCounts(c.key) > 0).map((c) => {
              const on = activeFormat === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setActiveFormat(on ? null : c.key)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border transition-colors ${
                    on
                      ? 'border-[#f0a500] bg-[#f0a500]/15 text-[#fcd34d]'
                      : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#bbb]'
                  }`}
                >
                  {c.label}<span className="ml-1 text-[9px] opacity-70">{formatCounts(c.key)}</span>
                </button>
              );
            })}
          </div>

          {/* Chip nhảy giải — bấm để lọc còn 1 giải; bấm lại (hoặc "Tất cả") để bỏ lọc. */}
          {sections.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setActiveLeague(null)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border transition-colors ${
                  activeLeague === null
                    ? 'border-[#17a2b8] bg-[#17a2b8]/15 text-[#8ee]'
                    : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#bbb]'
                }`}
              >
                Tất cả<span className="ml-1 text-[9px] opacity-70">{matches.length}</span>
              </button>
              {sections.map((s) => {
                const on = activeLeague === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setActiveLeague(on ? null : s.key)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border transition-colors ${
                      on
                        ? 'border-[#17a2b8] bg-[#17a2b8]/15 text-[#8ee]'
                        : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#bbb]'
                    }`}
                  >
                    {s.flag && <span className="mr-1">{s.flag}</span>}
                    {s.label}
                    <span className="ml-1 text-[9px] opacity-70">{s.matches.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Mỗi giải = 1 section: header (cờ + tên giải + số trận) + lưới card của giải đó. */}
          {shownSections.map((s) => (
            <section key={s.key}>
              <div className="mb-2 flex items-center gap-2 border-b border-[#222] pb-1.5">
                {s.flag && <span className="text-[15px] leading-none">{s.flag}</span>}
                <h2 className="text-[15px] font-bold text-white">{s.label}</h2>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#aaa] bg-white/[.06] border border-[#2a2a2a]">
                  {s.matches.length} trận
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {s.matches.map((m) => (
                  <MatchBox key={m.eventId} m={m} onWatch={goToVideo} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {/* Toast in-app (ghi bàn / hết H1) — góc dưới-phải */}
      <SabaToastHost noti={noti} />
    </div>
  );
}
