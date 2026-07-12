'use client';

import type { VoltaMatch } from '../types/voltaMatch';

function Logo({ src, alt }: { src: string; alt: string }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="h-5 w-5 flex-shrink-0 rounded-full object-cover" />;
}

export default function VoltaTable({ matches }: { matches: VoltaMatch[] }) {
  if (!matches.length) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-[#555]">
        Không có dữ liệu
      </div>
    );
  }

  return (
    <div className="gs-volta-table overflow-x-auto rounded-xl border border-[#2a2a2a]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[#1a1a1a]">
            {['Giờ', 'Ngày', 'Đội nhà', 'Tỉ số', 'Đội khách', 'Thắng'].map((h) => (
              <th
                key={h}
                className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#666]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => {
            const homeWin = m.homeScore > m.awayScore;
            const awayWin = m.awayScore > m.homeScore;
            return (
              <tr
                key={m.matchId}
                className={`border-t border-[#222] ${
                  i % 2 === 0 ? 'bg-[#141414]' : 'bg-[#181818]'
                } hover:bg-[#222] transition-colors`}
              >
                <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[#555]">{m.time}</td>
                <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[#555]">{m.date}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Logo src={m.homeLogo} alt={m.homeTeam} />
                    <span className={`text-[13px] font-semibold ${homeWin ? 'text-[#4ade80]' : 'text-[#bbb]'}`}>
                      {m.homeTeam}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  <span className="rounded-md bg-[#1e1e1e] px-2.5 py-0.5 font-bold text-white border border-[#333]">
                    <span className={homeWin ? 'text-[#4ade80]' : 'text-[#f87171]'}>{m.homeScore}</span>
                    <span className="text-[#555]"> – </span>
                    <span className={awayWin ? 'text-[#4ade80]' : 'text-[#f87171]'}>{m.awayScore}</span>
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Logo src={m.awayLogo} alt={m.awayTeam} />
                    <span className={`text-[13px] font-semibold ${awayWin ? 'text-[#4ade80]' : 'text-[#bbb]'}`}>
                      {m.awayTeam}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className="text-[12px] font-bold text-[#4ade80]">{m.winner}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
