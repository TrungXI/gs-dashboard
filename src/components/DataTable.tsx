import type { Match } from '../types/match';
import { TeamBadge, TypeBadge } from './badges';

function ScoreCell({ my, opp }: { my: string; opp: string }) {
  const mn = +my;
  const on = +opp;
  const cls = mn > on ? 'text-[#155724]' : mn < on ? 'text-[#721c24]' : 'text-[#856404]';
  return <span className={`font-bold ${cls}`}>{my}</span>;
}

export default function DataTable({ matches }: { matches: Match[] }) {
  return (
    <div className="overflow-x-auto rounded-lg shadow-sm">
      <table className="w-full min-w-[720px] border-collapse bg-white text-sm">
        <thead>
          <tr>
            <th className="bg-[#1a1a2e] px-2.5 py-2.5 text-center text-xs font-semibold text-white">
              #
            </th>
            <th className="bg-[#1a1a2e] px-2.5 py-2.5 text-left text-xs font-semibold text-white">
              Ngày
            </th>
            <th className="bg-[#1a1a2e] px-2.5 py-2.5 text-left text-xs font-semibold text-white">
              Giờ
            </th>
            <th className="bg-[#1a1a2e] px-2.5 py-2.5 text-center text-xs font-semibold text-white">
              Loại
            </th>
            <th className="bg-[#1a1a2e] px-2.5 py-2.5 text-left text-xs font-semibold text-white">
              Đội Nhà
            </th>
            <th className="bg-[#1a1a2e] px-2.5 py-2.5 text-left text-xs font-semibold text-white">
              Đội Khách
            </th>
            <th className="bg-[#1a1a2e] px-2.5 py-2.5 text-center text-xs font-semibold text-white">
              H1
            </th>
            <th className="bg-[#1a1a2e] px-2.5 py-2.5 text-center text-xs font-semibold text-white">
              TT
            </th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => (
            <tr
              key={i}
              className="odd:bg-white even:bg-[#f8f9fa] hover:bg-[#e8f4f8]"
            >
              <td className="border-b border-gray-100 px-2.5 py-2 text-center text-[11px] text-[#999]">
                {i + 1}
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2.5 py-2 text-xs text-[#666]">
                {m.date}
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2.5 py-2 text-xs text-[#666]">
                {m.time.split(' ').slice(1).join(' ')}
              </td>
              <td className="border-b border-gray-100 px-2.5 py-2 text-center">
                <TypeBadge type={m.matchType} />
              </td>
              <td className="border-b border-gray-100 px-2.5 py-2">
                <TeamBadge name={m.homeTeam} />
              </td>
              <td className="border-b border-gray-100 px-2.5 py-2">
                <TeamBadge name={m.awayTeam} />
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2.5 py-2 text-center">
                <ScoreCell my={m.h1Home} opp={m.h1Away} /> –{' '}
                <ScoreCell my={m.h1Away} opp={m.h1Home} />
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2.5 py-2 text-center">
                <ScoreCell my={m.ttHome} opp={m.ttAway} /> –{' '}
                <ScoreCell my={m.ttAway} opp={m.ttHome} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
