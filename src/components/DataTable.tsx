'use client';

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Match } from '../types/match';
import { TeamBadge, TypeBadge } from './badges';

const ROW_HEIGHT = 37;

function ScoreCell({ my, opp }: { my: string; opp: string }) {
  const mn = +my;
  const on = +opp;
  const cls = mn > on ? 'text-[#4ade80]' : mn < on ? 'text-[#f87171]' : 'text-[#fbbf24]';
  return <span className={`font-bold ${cls}`}>{my}</span>;
}

// Highlight pill styles: team1 = amber/red, team2 = blue — distinct so H2H rows read at a glance.
const HL1 = 'inline-block rounded px-1.5 py-0.5 bg-[#ffedd5] text-[#b91c1c] font-bold text-[11px]';
const HL2 = 'inline-block rounded px-1.5 py-0.5 bg-[#dbeafe] text-[#1d4ed8] font-bold text-[11px]';

function hlClass(team: string, team1?: string, team2?: string): string {
  if (team1 && team === team1) return HL1;
  if (team2 && team === team2) return HL2;
  return '';
}

function DataTable({ matches, highlightTeam, highlightTeam2 }: { matches: Match[]; highlightTeam?: string; highlightTeam2?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  const items = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  const paddingTop = items.length > 0 ? items[0].start : 0;
  const paddingBottom =
    items.length > 0 ? totalHeight - items[items.length - 1].end : 0;

  return (
    <div className="gs-data-table rounded-lg border border-[#2a2a2a] overflow-hidden">
      <div
        ref={containerRef}
        style={{ height: 'calc(100vh - 220px)', overflowY: 'auto', overflowX: 'auto' }}
      >
        <table className="w-full min-w-[720px] border-collapse bg-[#141414] text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {['#', 'Ngày', 'Giờ', 'Loại', 'Đội Nhà', 'Đội Khách', 'H1', 'TT'].map((h, i) => (
                <th
                  key={h}
                  className={`bg-[#1a1a1a] px-2.5 py-2.5 text-xs font-semibold text-[#aaa] ${
                    i === 0 || i >= 6 ? 'text-center' : 'text-left'
                  } ${i === 3 ? 'text-center' : ''}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td colSpan={8} style={{ height: paddingTop }} />
              </tr>
            )}
            {items.map((vrow) => {
              const m = matches[vrow.index];
              const i = vrow.index;
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
                      <TeamBadge name={m.homeTeam} />
                    </span>
                  </td>
                  <td className="border-b border-[#222] px-2.5 py-2">
                    <span className={hlClass(m.awayTeam, highlightTeam, highlightTeam2)}>
                      <TeamBadge name={m.awayTeam} />
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
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td colSpan={8} style={{ height: paddingBottom }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
