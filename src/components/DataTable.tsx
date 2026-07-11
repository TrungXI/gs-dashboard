import { memo } from 'react';
import type { Match } from '../types/match';
import { TeamBadge, TypeBadge } from './badges';

function ScoreCell({ my, opp }: { my: string; opp: string }) {
  const mn = +my;
  const on = +opp;
  const cls = mn > on ? 'text-[#4ade80]' : mn < on ? 'text-[#f87171]' : 'text-[#fbbf24]';
  return <span className={`font-bold ${cls}`}>{my}</span>;
}

const DataTable = memo(function DataTable({ matches }: { matches: Match[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#2a2a2a]">
      <table className="w-full min-w-[720px] border-collapse bg-[#141414] text-sm">
        <thead>
          <tr>
            {['#', 'Ngày', 'Giờ', 'Loại', 'Đội Nhà', 'Đội Khách', 'H1', 'TT'].map((h, i) => (
              <th
                key={h}
                className={`bg-[#1a1a1a] px-2.5 py-2.5 text-xs font-semibold text-[#aaa] ${i === 0 || i >= 6 ? 'text-center' : 'text-left'} ${i === 3 ? 'text-center' : ''}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => (
            <tr
              key={i}
              className="odd:bg-[#141414] even:bg-[#181818] hover:bg-[#222]"
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
                <TeamBadge name={m.homeTeam} />
              </td>
              <td className="border-b border-[#222] px-2.5 py-2">
                <TeamBadge name={m.awayTeam} />
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
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default DataTable;
