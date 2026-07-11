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
      <strong className="text-white">
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
  if (!matches.length) return null;
  return (
    <div className="mb-1 flex items-center gap-2">
      <span className="flex w-[75px] flex-shrink-0 items-center gap-1 text-xs font-semibold text-[#888]">
        <TypeBadge type={label} /> Form
      </span>
      <span className="flex flex-wrap gap-1">
        {matches.map((m, i) => (
          <ResultTag key={i} result={resultFor(m, team)} />
        ))}
      </span>
    </div>
  );
}

function StatsTable({ s20, s16 }: { s20: TypeStats; s16: TypeStats }) {
  const pct = (w: number, n: number) => (n ? Math.round((w / n) * 100) + '%' : '–');
  const avg = (g: number, n: number) => (n ? (g / n).toFixed(1) : '–');

  const StatRow = ({ label, s }: { label: '20p' | '16p'; s: TypeStats }) => {
    if (!s.n) return null;
    return (
      <tr>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px]">
          <TypeBadge type={label} />
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center text-[#ccc]">{s.n}</td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center font-bold text-[#4ade80]">
          {s.W}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center font-bold text-[#fbbf24]">
          {s.D}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center font-bold text-[#f87171]">
          {s.L}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center font-bold text-white">
          {pct(s.W, s.n)}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center text-[#ccc]">
          {s.gf}–{s.ga}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center font-semibold text-[#22d3ee]">
          {avg(s.gf, s.n)} / {avg(s.ga, s.n)}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center text-[#666]">
          {s.h1gf}–{s.h1ga}
        </td>
      </tr>
    );
  };

  if (!s20.n && !s16.n) return null;
  return (
    <table className="mt-1 w-full border-collapse text-xs">
      <thead>
        <tr>
          {['Giải', 'Trận', 'W', 'D', 'L', '%W', 'TT', 'TB g/th', 'H1'].map(
            (h) => (
              <th
                key={h}
                className="bg-[#1e1e1e] px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#777]"
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
    return <p className="my-1 text-xs text-[#555]">Không có dữ liệu</p>;
  }
  return (
    <table className="w-full border-collapse">
      <tbody>
        {matches.map((m, i) => (
          <tr key={i}>
            <td className="whitespace-nowrap px-1.5 py-1 text-[11px] text-[#555]">
              {m.date}
            </td>
            <td className="px-1.5 py-1 text-xs text-[#bbb]">{scoreLine(m, team)}</td>
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
  const has20 = s.s20.n > 0;
  const has16 = s.s16.n > 0;
  const bothTypes = has20 && has16;

  return (
    <div className="overflow-hidden rounded-[10px] border border-[#2a2a2a] bg-[#141414]">
      <div
        className="px-4 py-3 text-[15px] font-bold"
        style={{ background: c.bg, color: c.fg }}
      >
        {team}
      </div>
      <div className="p-4">
        {has20 && <FormRow label="20p" matches={s.r20} team={team} />}
        {has16 && <FormRow label="16p" matches={s.r16} team={team} />}
        <div className="mt-3.5">
          <StatsTable s20={s.s20} s16={s.s16} />
        </div>
        {(has20 || has16) && (
          <div className={`mt-3.5 grid gap-3 ${bothTypes ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {has20 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-[#888]">
                  <TypeBadge type="20p" /> 5 trận gần nhất
                </div>
                <RecentTable matches={s.r20} team={team} />
              </div>
            )}
            {has16 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-[#888]">
                  <TypeBadge type="16p" /> 5 trận gần nhất
                </div>
                <RecentTable matches={s.r16} team={team} />
              </div>
            )}
          </div>
        )}
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
    <div className="min-w-[200px] flex-1 rounded-lg bg-[#1e1e1e] px-3.5 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#aaa]">
        <TypeBadge type={label} /> — {s.n} trận
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold text-[#ddd]">
          {t1}
        </span>
        <div className="flex h-[22px] flex-1 overflow-hidden rounded">
          <div
            className="flex items-center justify-center bg-[#16a34a] text-[11px] font-bold text-white"
            style={{ width: `${w1}%` }}
            title={`${t1}: ${s.W}W`}
          >
            {s.W || ''}
          </div>
          <div
            className="flex items-center justify-center bg-[#d97706] text-[11px] font-bold text-white"
            style={{ width: `${wd}%` }}
            title={`Hòa: ${s.D}D`}
          >
            {s.D || ''}
          </div>
          <div
            className="flex items-center justify-center bg-[#dc2626] text-[11px] font-bold text-white"
            style={{ width: `${w2}%` }}
            title={`${t2}: ${s.L}W`}
          >
            {s.L || ''}
          </div>
        </div>
        <span className="w-20 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[11px] font-semibold text-[#ddd]">
          {t2}
        </span>
      </div>
      <div className="mt-1.5 text-[11px] text-[#666]">
        Bàn: {t1} <strong className="text-[#aaa]">{s.gf}</strong> – <strong className="text-[#aaa]">{s.ga}</strong> {t2}
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
    return <p className="text-[#666]">Chưa gặp nhau trong dữ liệu này</p>;
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
            // Score always shown as home – away to match "homeTeam vs awayTeam" display
            const homeScore = +m.ttHome;
            const awayScore = +m.ttAway;
            const winner =
              homeScore > awayScore ? m.homeTeam : awayScore > homeScore ? m.awayTeam : 'Hòa';
            const wCls =
              winner === t1
                ? 'text-[#4ade80]'
                : winner === t2
                  ? 'text-[#f87171]'
                  : 'text-[#fbbf24]';
            return (
              <tr key={i}>
                <td className="whitespace-nowrap border-b border-[#2a2a2a] px-2 py-[5px] text-[11px] text-[#555]">
                  {m.date}
                </td>
                <td className="border-b border-[#2a2a2a] px-2 py-[5px] text-xs text-[#bbb]">
                  {ih ? '🏠' : '✈️'} {m.homeTeam} vs {m.awayTeam}
                </td>
                <td className="border-b border-[#2a2a2a] px-2 py-[5px] text-center text-xs text-[#555]">
                  H1 {m.h1Home}–{m.h1Away}
                </td>
                <td className="border-b border-[#2a2a2a] px-2 py-[5px] text-center font-bold text-white">
                  {m.ttHome} – {m.ttAway}
                </td>
                <td
                  className={`border-b border-[#2a2a2a] px-2 py-[5px] text-center text-xs font-bold ${wCls}`}
                >
                  {winner}
                </td>
                <td className="border-b border-[#2a2a2a] px-2 py-[5px] text-center">
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
      <div className="overflow-hidden rounded-[10px] border border-[#2a2a2a] bg-[#141414]">
        <div className="bg-[#1a1a1a] px-4 py-3 text-[15px] font-bold text-white border-b border-[#2a2a2a]">
          ⚔️ Đối đầu trực tiếp: {t1} vs {t2}
        </div>
        <div className="p-4">
          <H2HBlock matches={matches} t1={t1} t2={t2} />
        </div>
      </div>
    </div>
  );
}
