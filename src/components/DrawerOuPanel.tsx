'use client';

import { useEffect, useState } from 'react';
import type { H2HPair, H2HPairStat, H2HPairMatch } from '../lib/gsMatchesDb';
import { LoadingState, Spinner } from './Spinner';
import { pct, shortName } from './H2HMatrix';

interface H2HPairResponse extends Partial<H2HPair> {
  ok: boolean;
  error?: string;
}

// One verdict card for a single market (FT or H1) — mirrors PairVerdict styling
// in H2HMatrix, but read-only (no deep-link) and decoupled from H2HCell.
function VerdictCard({
  title,
  home,
  away,
  stat,
  onClick,
  active = false,
}: {
  title: string;
  home: string;
  away: string;
  stat: H2HPairStat | null;
  onClick?: () => void;
  // Market của hiệp đang đá → tô viền/nền xanh da trời (đồng bộ Kiểu 2 ở list Xếp hạng).
  active?: boolean;
}) {
  // Class active giống hệt box active ngoài list (RankingLive Kiểu 2) — xanh da trời nhẹ.
  const activeCls = 'border-[#38bdf8]/50 bg-[#38bdf8]/15';

  if (!stat || stat.n === 0) {
    return (
      <div className={`rounded-lg border border-dashed p-4 ${active ? activeCls : 'border-[#3a3a3a] bg-[#141414]'}`}>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#777]">{title}</div>
        <div className="text-[13px] text-[#888]">Chưa đủ dữ liệu đối đầu cho cặp này.</div>
      </div>
    );
  }

  const taiPct = stat.overPct;
  const xiuPct = stat.n > 0 ? stat.under / stat.n : 0;
  const leanTai = stat.over > stat.under;
  const leanXiu = stat.under > stat.over;
  const verdict = leanTai ? 'NGHIÊNG TÀI' : leanXiu ? 'NGHIÊNG XỈU' : 'CÂN BẰNG';
  const vColor = leanTai ? '#4ade80' : leanXiu ? '#f87171' : '#9a9a9a';
  const marginSign = stat.avgMargin > 0 ? '+' : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border p-4 text-left transition-colors ${
        active ? activeCls : 'border-[#2a2a2a] bg-[#141414] hover:border-[#3a3a3a] hover:bg-[#181818]'
      }`}
    >
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#777]">{title}</div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[15px] font-bold text-[#eee]">
          {shortName(home)} <span className="text-[#555]">vs</span> {shortName(away)}
        </div>
        <span
          className="whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-bold"
          style={{ background: `${vColor}22`, color: vColor }}
        >
          {verdict}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-[#22c55e]/[.08] px-3 py-2.5 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#4ade80]">Tài</div>
          <div className="text-[22px] font-extrabold tabular-nums text-[#4ade80]">{pct(taiPct)}</div>
          <div className="text-[10px] tabular-nums text-[#6f6f6f]">{stat.over}/{stat.n} trận</div>
        </div>
        <div className="rounded-md bg-[#ef4444]/[.08] px-3 py-2.5 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f87171]">Xỉu</div>
          <div className="text-[22px] font-extrabold tabular-nums text-[#f87171]">{pct(xiuPct)}</div>
          <div className="text-[10px] tabular-nums text-[#6f6f6f]">{stat.under}/{stat.n} trận</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#888]">
        <span>{stat.n} trận đối đầu</span>
        <span>· TB <span className="text-[#bbb] tabular-nums">{stat.avgTotal.toFixed(1)}</span> bàn</span>
        <span>
          · chênh{' '}
          <span className="tabular-nums" style={{ color: stat.avgMargin >= 0 ? '#4ade80' : '#f87171' }}>
            {marginSign}{stat.avgMargin.toFixed(2)}
          </span>
        </span>
      </div>
      <div className="mt-3 border-t border-[#222] pt-2 text-[11px] font-semibold text-[#60a5fa]">
        👆 Bấm xem {stat.n} trận chi tiết →
      </div>
    </button>
  );
}

// One row in the drill-down list — a single historical H2H match, showing the
// score + total/line + Tài/Xỉu/Hòa badge for the currently-viewed market.
function MatchRow({ match, market }: { match: H2HPairMatch; market: 'ft' | 'h1' }) {
  const m = market === 'ft' ? match.ft : match.h1;
  const badge =
    m.result === 'tai'
      ? { label: 'TÀI', color: '#4ade80' }
      : m.result === 'xiu'
        ? { label: 'XỈU', color: '#f87171' }
        : m.result === 'hoa'
          ? { label: 'HÒA', color: '#9a9a9a' }
          : { label: 'chưa có line', color: '#777' };

  return (
    <div className="flex items-center gap-2 border-b border-[#1a1a1a]/70 px-3 py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-[#ddd]">
          {shortName(match.home)} <span className="text-[#555]">vs</span> {shortName(match.away)}
        </div>
        <div className="mt-0.5 text-[10px] tabular-nums text-[#6f6f6f]">
          {match.date} · HT <span className="text-[#9a9a9a]">{match.htScore}</span> · FT{' '}
          <span className="text-[#9a9a9a]">{match.ftScore}</span>
        </div>
        <div className="mt-0.5 text-[10px] tabular-nums text-[#6f6f6f]">
          Tổng <span className="text-[#bbb]">{m.total}</span>
          {m.line != null && (
            <>
              {' '}
              · line <span className="text-[#bbb]">{m.line.toFixed(1)}</span>
            </>
          )}
        </div>
      </div>
      <span
        className="whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-bold"
        style={{ background: `${badge.color}22`, color: badge.color }}
      >
        {badge.label}
      </span>
    </div>
  );
}

export default function DrawerOuPanel({
  eventId,
  activeMarket,
}: {
  eventId: number;
  // Hiệp đang đá: 'h1'→thẻ H1 xanh, 'ft'→thẻ FT xanh, null/undefined→không tô.
  activeMarket?: 'ft' | 'h1' | null;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<H2HPair | null>(null);
  const [detail, setDetail] = useState<'ft' | 'h1' | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    // Giữ data + drill-down cũ trong lúc reload (đổi trận qua ◀▶) — phủ mờ thay
    // vì blank trắng. Data mới thay data cũ khi fetch xong.
    setDetail(null);

    fetch(`/api/gs-h2h-pair?eventId=${eventId}`, { cache: 'no-store' })
      .then(async (r) => {
        const json = (await r.json()) as H2HPairResponse;
        if (!alive) return;
        if (!json.ok) {
          setError(
            json.error === 'event not found'
              ? 'Không tìm thấy trận này trong dữ liệu kèo.'
              : json.error || 'Không tải được dữ liệu đối đầu.',
          );
          return;
        }
        setData({
          home: json.home ?? '',
          away: json.away ?? '',
          league: json.league ?? '20p',
          ft: json.ft ?? null,
          h1: json.h1 ?? null,
          matches: json.matches ?? [],
        });
      })
      .catch(() => {
        if (alive) setError('Không tải được dữ liệu đối đầu.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [eventId]);

  // Lần đầu (chưa có data) → full loading; reload (đã có data) → giữ khung + phủ mờ.
  if (loading && !data) return <LoadingState label="Đang tải dữ liệu đối đầu…" />;

  if (error) {
    return (
      <div className="m-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[12px] text-[#f87171]">
        {error}
      </div>
    );
  }

  if (!data || (!data.ft && !data.h1)) {
    return (
      <div className="m-3 rounded-lg border border-dashed border-[#3a3a3a] bg-[#141414] p-5 text-center text-[13px] text-[#888]">
        Chưa đủ dữ liệu đối đầu cho cặp này.
      </div>
    );
  }

  if (detail !== null) {
    const marketTitle = detail === 'ft' ? 'FT cả trận' : 'H1 hiệp 1';
    return (
      // Cả header + list nằm trong vùng cuộn của drawer body (parent). Header
      // sticky top-0 nền đục để luôn thấy nút "← Quay lại" khi list dài.
      <div className="px-3 pb-3 md:px-4 md:pb-4">
        <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 border-b border-[#1a1a1a] bg-[#111] px-3 py-3 md:-mx-4 md:px-4">
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="whitespace-nowrap rounded-md border border-[#2a2a2a] bg-[#141414] px-2.5 py-1.5 text-[12px] font-semibold text-[#ddd] transition-colors hover:bg-[#1c1c1c]"
          >
            ← Quay lại
          </button>
          <div className="min-w-0 text-[12px] font-bold text-[#eee]">
            Chi tiết {marketTitle} — {shortName(data.home)} <span className="text-[#555]">vs</span>{' '}
            {shortName(data.away)}
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-[#2a2a2a] bg-[#141414]">
          {data.matches.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12px] text-[#666]">Chưa có trận đối đầu</div>
          ) : (
            <div className="flex flex-col">
              {data.matches.map((m, i) => (
                <MatchRow key={`${m.date}-${m.ftScore}-${i}`} match={m} market={detail} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {loading && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-[#141414]/80 px-2 py-1 text-[11px] font-semibold text-[#17a2b8]">
          <Spinner size={12} /> Đang tải…
        </div>
      )}
      <div
        className={`flex flex-col gap-3 px-3 py-3 md:px-4 md:py-4 transition-opacity duration-200 ${
          loading ? 'pointer-events-none opacity-40' : ''
        }`}
      >
        <VerdictCard
          title="🕐 H1 — Hiệp 1"
          home={data.home}
          away={data.away}
          stat={data.h1}
          onClick={() => setDetail('h1')}
          active={activeMarket === 'h1'}
        />
        <VerdictCard
          title="⚽ FT — Cả trận"
          home={data.home}
          away={data.away}
          stat={data.ft}
          onClick={() => setDetail('ft')}
          active={activeMarket === 'ft'}
        />
      </div>
    </div>
  );
}
