'use client';

import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Match } from '../types/match';
import { TeamBadge, TypeBadge } from './badges';

const ROW_HEIGHT = 37;
const CARD_HEIGHT = 118;

function ScoreCell({ my, opp }: { my: string; opp: string }) {
  const mn = +my;
  const on = +opp;
  const cls = mn > on ? 'text-[#4ade80]' : mn < on ? 'text-[#f87171]' : 'text-[#fbbf24]';
  return <span className={`font-bold ${cls}`}>{my}</span>;
}

// Filter đội chỉ để lọc — không tô nền active cho đội trùng filter.
function hlClass(_team: string, _team1?: string, _team2?: string): string {
  return '';
}

// Format độ chấp: 1 → "1", 0.75 → "0.75" (bỏ số 0 thừa).
function fmtLine(n: number): string {
  return String(n);
}

// Chấp mở kèo: đội trên (Chủ/Khách) + độ chấp. Xám khi thiếu cả 2 nguồn.
// Dấu "*" nhỏ = lấy từ fallback gs_full_ticks (odds_log không có).
function HandicapCell({ m }: { m: Match }) {
  if (m.hcOpenLine == null || m.hcOpenFav == null) {
    return <span className="text-[#555]">—</span>;
  }
  const favHome = m.hcOpenFav === 'home';
  const favLabel = favHome ? 'Chủ' : 'Khách';
  const title = `${favLabel} chấp ${fmtLine(m.hcOpenLine)}${m.hcOpenSource === '16p' ? ' (nguồn 16p ticks)' : ''}`;
  return (
    <span title={title} className="whitespace-nowrap font-semibold text-[#fbbf24]">
      <span className={favHome ? 'text-[#60a5fa]' : 'text-[#f472b6]'}>{favLabel}</span>{' '}
      -{fmtLine(m.hcOpenLine)}
      {m.hcOpenSource === '16p' && <span className="text-[#555]" title="nguồn gs_full_ticks">*</span>}
    </span>
  );
}

// Kết quả từng bên: thắng FT (so tổng) và thắng H1 (so hiệp 1).
function outcome(m: Match) {
  const ftH = +m.ttHome, ftA = +m.ttAway, h1H = +m.h1Home, h1A = +m.h1Away;
  return {
    homeWinFt: ftH > ftA,
    awayWinFt: ftA > ftH,
    homeWinH1: h1H > h1A,
    awayWinH1: h1A > h1H,
  };
}

function DataTable({ matches, highlightTeam, highlightTeam2 }: { matches: Match[]; highlightTeam?: string; highlightTeam2?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Card layout dưới md, bảng ở md trở lên — hàng cao khác nhau nên virtualizer
  // phải biết breakpoint để estimateSize đúng (list ~6000 dòng, giữ virtualization).
  const [isMobile, setIsMobile] = useState(false);
  const isMobileRef = useRef(false);
  isMobileRef.current = isMobile;

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => (isMobileRef.current ? CARD_HEIGHT : ROW_HEIGHT),
    overscan: 15,
  });

  // Re-measure khi đổi breakpoint (chiều cao hàng thay đổi).
  useEffect(() => {
    virtualizer.measure();
  }, [isMobile, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  const paddingTop = items.length > 0 ? items[0].start : 0;
  const paddingBottom =
    items.length > 0 ? totalHeight - items[items.length - 1].end : 0;

  // ── Mobile: card cho mỗi trận ──────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="gs-data-table rounded-lg border border-[#2a2a2a] overflow-hidden">
        <div
          ref={containerRef}
          style={{ height: 'calc(100vh - 220px)', overflowY: 'auto' }}
        >
          <div style={{ paddingTop, paddingBottom }} className="flex flex-col gap-2 p-2">
            {items.map((vrow) => {
              const m = matches[vrow.index];
              const i = vrow.index;
              const o = outcome(m);
              return (
                <div
                  key={i}
                  style={{ height: CARD_HEIGHT - 8 }}
                  className="flex flex-col justify-between rounded-lg border border-[#222] bg-[#181818] px-3 py-2.5"
                >
                  <div className="flex items-center justify-between text-[11px] text-[#888]">
                    <span className="whitespace-nowrap">
                      {m.date} · {m.time.split(' ')[1]}
                    </span>
                    <TypeBadge type={m.matchType} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`flex-1 ${hlClass(m.homeTeam, highlightTeam, highlightTeam2)}`}>
                      <TeamBadge name={m.homeTeam} type={m.matchType} winFt={o.homeWinFt} winH1={o.homeWinH1} />
                    </span>
                    <span className="text-[11px] font-semibold text-white/30">vs</span>
                    <span className={`flex-1 text-right ${hlClass(m.awayTeam, highlightTeam, highlightTeam2)}`}>
                      <TeamBadge name={m.awayTeam} type={m.matchType} winFt={o.awayWinFt} winH1={o.awayWinH1} />
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-[#888]">
                      H1{' '}
                      <ScoreCell my={m.h1Home} opp={m.h1Away} />
                      <span className="text-[#555]"> – </span>
                      <ScoreCell my={m.h1Away} opp={m.h1Home} />
                    </span>
                    <span className="text-[#888]">
                      TT{' '}
                      <ScoreCell my={m.ttHome} opp={m.ttAway} />
                      <span className="text-[#555]"> – </span>
                      <ScoreCell my={m.ttAway} opp={m.ttHome} />
                    </span>
                    <span className="ml-auto text-[#888]">
                      Chấp <HandicapCell m={m} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop: bảng gọn, khống chế bề rộng ──────────────────────────────
  return (
    <div className="gs-data-table max-w-[1100px] rounded-lg border border-[#2a2a2a] overflow-hidden">
      <div
        ref={containerRef}
        style={{ height: 'calc(100vh - 220px)', overflowY: 'auto' }}
      >
        <table className="w-full table-fixed border-collapse bg-[#141414] text-sm">
          <colgroup>
            <col className="w-12" />
            <col className="w-24" />
            <col className="w-16" />
            <col className="w-20" />
            <col />
            <col />
            <col className="w-20" />
            <col className="w-20" />
            <col className="w-24" />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              {['#', 'Ngày', 'Giờ', 'Loại', 'Đội Nhà', 'Đội Khách', 'H1', 'TT', 'Chấp mở'].map((h, i) => (
                <th
                  key={h}
                  className={`bg-[#1a1a1a] px-2.5 py-2.5 text-xs font-semibold text-[#aaa] ${
                    i === 0 || i === 3 || i >= 6 ? 'text-center' : 'text-left'
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td colSpan={9} style={{ height: paddingTop }} />
              </tr>
            )}
            {items.map((vrow) => {
              const m = matches[vrow.index];
              const i = vrow.index;
              const o = outcome(m);
              return (
                <tr
                  key={i}
                  className={`${i % 2 === 0 ? 'bg-[#141414]' : 'bg-[#181818]'} hover:bg-[#222]`}
                  style={{ height: ROW_HEIGHT }}
                >
                  <td className="border-b border-[#222] px-2.5 py-2 text-center text-[11px] text-[#555]">
                    {i + 1}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2 text-xs text-[#888]">
                    {m.date}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2 text-xs text-[#888]">
                    {m.time.split(' ')[1]}
                  </td>
                  <td className="border-b border-[#222] px-2.5 py-2 text-center">
                    <TypeBadge type={m.matchType} />
                  </td>
                  <td className="border-b border-[#222] px-2.5 py-2">
                    <span className={hlClass(m.homeTeam, highlightTeam, highlightTeam2)}>
                      <TeamBadge name={m.homeTeam} type={m.matchType} winFt={o.homeWinFt} winH1={o.homeWinH1} />
                    </span>
                  </td>
                  <td className="border-b border-[#222] px-2.5 py-2">
                    <span className={hlClass(m.awayTeam, highlightTeam, highlightTeam2)}>
                      <TeamBadge name={m.awayTeam} type={m.matchType} winFt={o.awayWinFt} winH1={o.awayWinH1} />
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2 text-center">
                    <ScoreCell my={m.h1Home} opp={m.h1Away} /> –{' '}
                    <ScoreCell my={m.h1Away} opp={m.h1Home} />
                  </td>
                  <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2 text-center">
                    <ScoreCell my={m.ttHome} opp={m.ttAway} /> –{' '}
                    <ScoreCell my={m.ttAway} opp={m.ttHome} />
                  </td>
                  <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2 text-center text-xs">
                    <HandicapCell m={m} />
                  </td>
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td colSpan={9} style={{ height: paddingBottom }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
