'use client';

import type { Match } from '../types/match';
import { teamColor } from '../lib/teamColors';
import {
  calcStats,
  resultFor,
  h2hSum,
  type TypeStats,
  type TeamStats,
} from '../lib/stats';
import { TypeBadge, ResultTag } from './badges';

function scoreLine(m: Match, team: string) {
  const isHome = m.homeTeam === team;
  const opp = isHome ? m.awayTeam : m.homeTeam;
  const myTT = isHome ? m.ttHome : m.ttAway;
  const opTT = isHome ? m.ttAway : m.ttHome;
  const myH1 = isHome ? m.h1Home : m.h1Away;
  const opH1 = isHome ? m.h1Away : m.h1Home;
  return (
    <>
      {isHome ? '🏠' : '✈️'} vs {opp} · H1:{myH1}-{opH1} ·{' '}
      <strong>
        {myTT}-{opTT}
      </strong>
    </>
  );
}

function FormRow({
  label,
  matches,
  team,
}: {
  label: '20p' | '16p';
  matches: Match[];
  team: string;
}) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <span className="flex w-[75px] flex-shrink-0 items-center gap-1 text-xs font-semibold text-[#666]">
        <TypeBadge type={label} /> Form
      </span>
      <span className="flex flex-wrap gap-1">
        {matches.length ? (
          matches.map((m, i) => (
            <ResultTag key={i} result={resultFor(m, team)} />
          ))
        ) : (
          <span className="text-[#999]">–</span>
        )}
      </span>
    </div>
  );
}

function StatsTable({ s20, s16 }: { s20: TypeStats; s16: TypeStats }) {
  const pct = (w: number, n: number) => (n ? Math.round((w / n) * 100) + '%' : '–');
  const avg = (g: number, n: number) => (n ? (g / n).toFixed(1) : '–');

  const StatRow = ({ label, s }: { label: '20p' | '16p'; s: TypeStats }) => {
    if (!s.n) {
      return (
        <tr>
          <td className="border-b border-[#f5f5f5] px-2 py-[7px]">
            <TypeBadge type={label} />
          </td>
          <td
            colSpan={8}
            className="border-b border-[#f5f5f5] px-2 py-[7px] text-center text-xs text-[#bbb]"
          >
            Không có dữ liệu
          </td>
        </tr>
      );
    }
    return (
      <tr>
        <td className="border-b border-[#f5f5f5] px-2 py-[7px]">
          <TypeBadge type={label} />
        </td>
        <td className="border-b border-[#f5f5f5] px-2 py-[7px] text-center">{s.n}</td>
        <td className="border-b border-[#f5f5f5] px-2 py-[7px] text-center font-bold text-[#155724]">
          {s.W}
        </td>
        <td className="border-b border-[#f5f5f5] px-2 py-[7px] text-center font-bold text-[#856404]">
          {s.D}
        </td>
        <td className="border-b border-[#f5f5f5] px-2 py-[7px] text-center font-bold text-[#721c24]">
          {s.L}
        </td>
        <td className="border-b border-[#f5f5f5] px-2 py-[7px] text-center font-bold">
          {pct(s.W, s.n)}
        </td>
        <td className="border-b border-[#f5f5f5] px-2 py-[7px] text-center">
          {s.gf}–{s.ga}
        </td>
        <td className="border-b border-[#f5f5f5] px-2 py-[7px] text-center font-semibold text-[#17a2b8]">
          {avg(s.gf, s.n)} / {avg(s.ga, s.n)}
        </td>
        <td className="border-b border-[#f5f5f5] px-2 py-[7px] text-center text-[#999]">
          {s.h1gf}–{s.h1ga}
        </td>
      </tr>
    );
  };

  return (
    <table className="mt-1 w-full border-collapse text-xs">
      <thead>
        <tr>
          {['Giải', 'Trận', 'W', 'D', 'L', '%W', 'TT', 'TB g/th', 'H1'].map(
            (h) => (
              <th
                key={h}
                className="bg-[#f0f2f5] px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#555]"
              >
                {h}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        <StatRow label="20p" s={s20} />
        <StatRow label="16p" s={s16} />
      </tbody>
    </table>
  );
}

function RecentTable({ matches, team }: { matches: Match[]; team: string }) {
  if (!matches.length) {
    return <p className="my-1 text-xs text-[#999]">Không có dữ liệu</p>;
  }
  return (
    <table className="w-full border-collapse">
      <tbody>
        {matches.map((m, i) => (
          <tr key={i}>
            <td className="whitespace-nowrap px-1.5 py-1 text-[11px] text-[#999]">
              {m.date}
            </td>
            <td className="px-1.5 py-1 text-xs">{scoreLine(m, team)}</td>
            <td className="px-1 py-1">
              <ResultTag result={resultFor(m, team)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamCard({ matches, team }: { matches: Match[]; team: string }) {
  const s: TeamStats = calcStats(matches, team);
  const c = teamColor(team);
  return (
    <div className="overflow-hidden rounded-[10px] border-[1.5px] border-[#e8eaf0] bg-white shadow-sm">
      <div
        className="px-4 py-3 text-[15px] font-bold"
        style={{ background: c.bg, color: c.fg }}
      >
        {team}
      </div>
      <div className="p-4">
        <FormRow label="20p" matches={s.r20} team={team} />
        <FormRow label="16p" matches={s.r16} team={team} />
        <div className="mt-3.5">
          <StatsTable s20={s.s20} s16={s.s16} />
        </div>
        <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-[#666]">
              <TypeBadge type="20p" /> 5 trận gần nhất
            </div>
            <RecentTable matches={s.r20} team={team} />
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-[#666]">
              <TypeBadge type="16p" /> 5 trận gần nhất
            </div>
            <RecentTable matches={s.r16} team={team} />
          </div>
        </div>
      </div>
    </div>
  );
}

function H2HBar({
  label,
  matches,
  t1,
  t2,
}: {
  label: '20p' | '16p';
  matches: Match[];
  t1: string;
  t2: string;
}) {
  const s = h2hSum(matches, t1);
  if (!s.n) return null;
  const w1 = Math.round((s.W / s.n) * 100);
  const wd = Math.round((s.D / s.n) * 100);
  const w2 = 100 - w1 - wd;
  return (
    <div className="min-w-[200px] flex-1 rounded-lg bg-[#f8f9fa] px-3.5 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <TypeBadge type={label} /> — {s.n} trận
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold text-[#333]">
          {t1}
        </span>
        <div className="flex h-[22px] flex-1 overflow-hidden rounded">
          <div
            className="flex items-center justify-center bg-[#28a745] text-[11px] font-bold text-white"
            style={{ width: `${w1}%` }}
            title={`${t1}: ${s.W}W`}
          >
            {s.W || ''}
          </div>
          <div
            className="flex items-center justify-center bg-[#ffc107] text-[11px] font-bold text-[#333]"
            style={{ width: `${wd}%` }}
            title={`Hòa: ${s.D}D`}
          >
            {s.D || ''}
          </div>
          <div
            className="flex items-center justify-center bg-[#dc3545] text-[11px] font-bold text-white"
            style={{ width: `${w2}%` }}
            title={`${t2}: ${s.L}W`}
          >
            {s.L || ''}
          </div>
        </div>
        <span className="w-20 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[11px] font-semibold text-[#333]">
          {t2}
        </span>
      </div>
      <div className="mt-1.5 text-[11px] text-[#888]">
        Bàn: {t1} <strong>{s.gf}</strong> – <strong>{s.ga}</strong> {t2}
      </div>
    </div>
  );
}

function H2HBlock({
  matches,
  t1,
  t2,
}: {
  matches: Match[];
  t1: string;
  t2: string;
}) {
  const h2h = matches.filter(
    (m) =>
      (m.homeTeam === t1 && m.awayTeam === t2) ||
      (m.homeTeam === t2 && m.awayTeam === t1),
  );
  if (!h2h.length) {
    return <p className="text-[#999]">Chưa gặp nhau trong dữ liệu này</p>;
  }
  const h20 = h2h.filter((m) => m.matchType === '20p');
  const h16 = h2h.filter((m) => m.matchType === '16p');

  return (
    <>
      <div className="mb-3.5 flex flex-wrap gap-3.5">
        <H2HBar label="20p" matches={h20} t1={t1} t2={t2} />
        <H2HBar label="16p" matches={h16} t1={t1} t2={t2} />
      </div>
      <table className="mt-3 w-full border-collapse text-xs">
        <tbody>
          {h2h.map((m, i) => {
            const ih = m.homeTeam === t1;
            const t1TT = ih ? m.ttHome : m.ttAway;
            const t2TT = ih ? m.ttAway : m.ttHome;
            const t1H1 = ih ? m.h1Home : m.h1Away;
            const t2H1 = ih ? m.h1Away : m.h1Home;
            const winner =
              +t1TT > +t2TT ? t1 : +t2TT > +t1TT ? t2 : 'Hòa';
            const wCls =
              winner === t1
                ? 'text-[#155724]'
                : winner === t2
                  ? 'text-[#721c24]'
                  : 'text-[#856404]';
            return (
              <tr key={i}>
                <td className="whitespace-nowrap border-b border-[#f5f5f5] px-2 py-[5px] text-[11px] text-[#999]">
                  {m.date}
                </td>
                <td className="border-b border-[#f5f5f5] px-2 py-[5px] text-xs">
                  {ih ? '🏠' : '✈️'} {m.homeTeam} vs {m.awayTeam}
                </td>
                <td className="border-b border-[#f5f5f5] px-2 py-[5px] text-center text-xs text-[#999]">
                  H1 {t1H1}–{t2H1}
                </td>
                <td className="border-b border-[#f5f5f5] px-2 py-[5px] text-center font-bold">
                  {t1TT} – {t2TT}
                </td>
                <td
                  className={`border-b border-[#f5f5f5] px-2 py-[5px] text-center text-xs font-bold ${wCls}`}
                >
                  {winner}
                </td>
                <td className="border-b border-[#f5f5f5] px-2 py-[5px] text-center">
                  <TypeBadge type={m.matchType} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export default function Analysis({
  matches,
  t1,
  t2,
}: {
  matches: Match[];
  t1: string;
  t2: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TeamCard matches={matches} team={t1} />
        <TeamCard matches={matches} team={t2} />
      </div>
      <div className="overflow-hidden rounded-[10px] border-[1.5px] border-[#1a1a2e] bg-white shadow-sm">
        <div className="bg-[#1a1a2e] px-4 py-3 text-[15px] font-bold text-white">
          ⚔️ Đối đầu trực tiếp: {t1} vs {t2}
        </div>
        <div className="p-4">
          <H2HBlock matches={matches} t1={t1} t2={t2} />
        </div>
      </div>
    </div>
  );
}
