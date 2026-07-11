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
import {
  h2StatsForTeam,
  h1ToH2Outcomes,
  getCommonH1Scores,
  type CommonH1Score,
  type H1ToH2Result,
} from '../lib/h2Stats';
import { teamH2ResponseToH1, h2hH1ToH2Outcomes, type H2OutcomeSet } from '../lib/h2Stats';
import { useState, useMemo } from 'react';
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

  const H2StatRow = ({ label, s }: { label: '20p' | '16p'; s: TypeStats }) => {
    if (!s.n) return null;
    const h2n = s.h2W + s.h2D + s.h2L; // === s.n
    return (
      <tr>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px]">
          <span className="rounded-[3px] bg-[#334155] px-1.5 py-px text-[10px] font-bold text-[#cbd5e1]">
            H2·{label}
          </span>
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center text-[#ccc]">{h2n}</td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center font-bold text-[#4ade80]">
          {s.h2W}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center font-bold text-[#fbbf24]">
          {s.h2D}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center font-bold text-[#f87171]">
          {s.h2L}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center font-bold text-white">
          {pct(s.h2W, h2n)}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center text-[#ccc]">
          {s.h2gf}–{s.h2ga}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center font-semibold text-[#22d3ee]">
          {avg(s.h2gf, h2n)} / {avg(s.h2ga, h2n)}
        </td>
        <td className="border-b border-[#2a2a2a] px-2 py-[7px] text-center text-[#666]">—</td>
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
        <H2StatRow label="20p" s={s20} />
        <StatRow label="16p" s={s16} />
        <H2StatRow label="16p" s={s16} />
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

function H2CompareBar({
  matches,
  t1,
  t2,
}: {
  matches: Match[];
  t1: string;
  t2: string;
}) {
  const s1 = h2StatsForTeam(matches, t1);
  const s2 = h2StatsForTeam(matches, t2);
  const r1 = Math.round(s1.winRate * 100);
  const r2 = Math.round(s2.winRate * 100);

  const rateColor = (r: number) =>
    r >= 50 ? '#4ade80' : r < 40 ? '#f87171' : '#fbbf24';

  const total = r1 + r2;
  const w1 = total ? Math.round((r1 / total) * 100) : 50;
  const w2 = 100 - w1;

  const c1 = teamColor(t1);
  const c2 = teamColor(t2);

  const cols = [
    { team: t1, c: c1, s: s1, r: r1 },
    { team: t2, c: c2, s: s2, r: r2 },
  ];

  return (
    <div className="rounded-lg bg-[#1e1e1e] px-4 py-3.5">
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-[#777]">
        Hiệp 2 — So sánh
      </div>
      {s1.n === 0 && s2.n === 0 ? (
        <div className="text-xs text-[#666]">Không có dữ liệu H2</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            {cols.map((col) => (
              <div key={col.team}>
                <span
                  className="inline-block rounded px-2 py-0.5 text-xs font-semibold"
                  style={{ background: col.c.bg, color: col.c.fg }}
                >
                  {col.team}
                </span>
                <div className="mt-2">
                  <span
                    className="text-3xl font-bold"
                    style={{ color: rateColor(col.r) }}
                  >
                    {col.r}
                  </span>
                  <span className="text-sm text-[#666]">%</span>
                </div>
                <div className="text-[10px] text-[#888]">H2 win rate</div>
                <div className="mt-1.5 text-xs text-[#888]">
                  H2 W-D-L:{' '}
                  <span className="text-[#4ade80]">{col.s.W}</span>-
                  <span className="text-[#fbbf24]">{col.s.D}</span>-
                  <span className="text-[#f87171]">{col.s.L}</span>
                </div>
                <div className="text-[11px] text-[#666]">
                  Bàn H2: <b className="text-[#aaa]">{col.s.gf}</b>–
                  <b className="text-[#aaa]">{col.s.ga}</b>
                </div>
                <div className="text-[10px] text-[#555]">{col.s.n} trận</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="w-20 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold text-[#ddd]">
              {t1}
            </span>
            <div className="flex h-[22px] flex-1 overflow-hidden rounded">
              {total === 0 ? (
                <div className="flex flex-1 items-center justify-center bg-[#2a2a2a] text-[11px] text-[#666]" />
              ) : (
                <>
                  <div
                    className="flex items-center justify-center bg-[#16a34a] text-[11px] font-bold text-white"
                    style={{ width: `${w1}%` }}
                  >
                    {r1}%
                  </div>
                  <div
                    className="flex items-center justify-center bg-[#dc2626] text-[11px] font-bold text-white"
                    style={{ width: `${w2}%` }}
                  >
                    {r2}%
                  </div>
                </>
              )}
            </div>
            <span className="w-20 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[11px] font-semibold text-[#ddd]">
              {t2}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-[#666]">
            So sánh tỉ lệ thắng Hiệp 2
          </div>
        </>
      )}
    </div>
  );
}

function renderTeamCard(
  teamLabel: string,
  resp: { asHome: H2OutcomeSet; asAway: H2OutcomeSet } | undefined,
  selected: CommonH1Score,
) {
  if (!resp) return <div className="text-[11px] text-[#555]">Không đủ dữ liệu</div>;

  const lead = selected.home - selected.away;
  const round = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  if (lead === 0) {
    const line = (label: string, s: H2OutcomeSet) => {
      const nn = s.h2W + s.h2D + s.h2L;
      return (
        <div className="text-[11px] text-white/70">
          {label}: H2 W {round(s.h2W, nn)}% / D {round(s.h2D, nn)}% / L {round(s.h2L, nn)}% (n=
          {s.n})
        </div>
      );
    };
    return (
      <div className="flex flex-col gap-1">
        {line('Sân nhà', resp.asHome)}
        {line('Sân khách', resp.asAway)}
      </div>
    );
  }

  const primary = lead > 0 ? resp.asHome : resp.asAway;
  const secondary = lead > 0 ? resp.asAway : resp.asHome;

  return (
    <div className="flex flex-col gap-1">
      {primary.n < 5 ? (
        <div className="text-[11px] text-[#888]">
          Đang thắng H1 → Không đủ dữ liệu (n={primary.n})
        </div>
      ) : (
        <div className="text-[11px] text-white/70">
          Đang thắng → tiếp tục: {round(primary.holds, primary.n)}% · bị ngược:{' '}
          {round(primary.reversedAgainst, primary.n)}% (n={primary.n})
        </div>
      )}
      {secondary.n >= 5 && (
        <div className="text-[10px] text-[#888]">
          Khi là {lead > 0 ? 'Khách' : 'Nhà'} (đang thua): comeback{' '}
          {round(secondary.recovers, secondary.n)}% (n={secondary.n})
        </div>
      )}
    </div>
  );
}

function H1ScenarioPicker({
  matches,
  t1,
  t2,
}: {
  matches: Match[];
  t1: string;
  t2: string;
}) {
  const commonH1 = useMemo(() => getCommonH1Scores(matches), [matches]);
  const [selected, setSelected] = useState<CommonH1Score | null>(null);

  const outcome: H1ToH2Result | null = useMemo(
    () => (selected ? h1ToH2Outcomes(matches, selected.home, selected.away) : null),
    [matches, selected],
  );

  const teamResp = useMemo(
    () =>
      selected
        ? {
            t1: teamH2ResponseToH1(matches, t1, selected.home, selected.away),
            t2: teamH2ResponseToH1(matches, t2, selected.home, selected.away),
          }
        : null,
    [matches, selected, t1, t2],
  );

  const h2h = useMemo(
    () => (selected ? h2hH1ToH2Outcomes(matches, t1, t2, selected.home, selected.away) : null),
    [matches, selected, t1, t2],
  );

  let holdPct = 0,
    revPct = 0,
    drawPct = 0;
  if (outcome && outcome.total > 0) {
    holdPct = Math.round(
      ((outcome.homeHolds + outcome.awayHolds) / outcome.total) * 100,
    );
    revPct = Math.round((outcome.reversal / outcome.total) * 100);
    drawPct = 100 - holdPct - revPct;
  }

  return (
    <div className="rounded-lg bg-[#1e1e1e] px-4 py-3.5">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[#777]">
        Kịch bản H1
      </div>
      <div className="flex flex-wrap gap-2">
        {commonH1.map((sc) => (
          <button
            key={sc.label}
            onClick={() => setSelected(selected?.label === sc.label ? null : sc)}
            className={`rounded-md px-3 py-1.5 text-sm font-bold transition-colors ${
              selected?.label === sc.label
                ? 'bg-[#17a2b8] text-white'
                : 'bg-[#2a2a2a] text-[#ccc] hover:bg-[#333]'
            }`}
          >
            {sc.label}
            <span className="ml-1 text-[10px] font-normal text-[#888]">
              {sc.count}
            </span>
          </button>
        ))}
      </div>

      {!selected && (
        <div className="mt-3 text-xs text-[#666]">
          Chọn tỉ số H1 để xem kịch bản Hiệp 2
        </div>
      )}

      {outcome && outcome.total > 0 && selected && (
        <>
          <div className="mt-3 mb-2 text-xs text-[#aaa]">
            Sau H1 {selected.label}, Hiệp 2 diễn biến ({outcome.total} trận):
          </div>
          <div className="flex h-[26px] overflow-hidden rounded">
            <div
              className="flex items-center justify-center bg-[#16a34a] text-[11px] font-bold text-white"
              style={{ width: `${holdPct}%` }}
            >
              Giữ {holdPct}%
            </div>
            <div
              className="flex items-center justify-center bg-[#d97706] text-[11px] font-bold text-white"
              style={{ width: `${drawPct}%` }}
            >
              Hòa {drawPct}%
            </div>
            <div
              className="flex items-center justify-center bg-[#dc2626] text-[11px] font-bold text-white"
              style={{ width: `${revPct}%` }}
            >
              Lật {revPct}%
            </div>
          </div>
          <div className="mt-1.5 flex gap-4 text-[10px]">
            <span className="text-[#4ade80]">■ Giữ (leader thắng)</span>
            <span className="text-[#fbbf24]">■ Hòa</span>
            <span className="text-[#f87171]">■ Lật kèo</span>
          </div>

          {/* Layer 2 — Per-team response */}
          <div className="mt-4 mb-2 text-[11px] font-semibold text-[#888]">
            Phản ứng từng đội khi H1 {selected.label}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { label: t1, resp: teamResp?.t1 },
              { label: t2, resp: teamResp?.t2 },
            ].map(({ label, resp }) => (
              <div
                key={label}
                className="rounded-lg border border-white/10 bg-[#1a1a1a] p-3"
              >
                <div className="text-[12px] font-bold text-white mb-2">{label}</div>
                {renderTeamCard(label, resp, selected)}
              </div>
            ))}
          </div>

          {/* Layer 3 — H2H */}
          <div className="mt-4 rounded-lg border border-white/10 bg-[#1a1a1a] p-3">
            <div className="text-[11px] text-[#888] mb-2">
              {t1} vs {t2} — đối đầu H1 {selected.label}
            </div>
            {h2h && h2h.n > 0 ? (
              <>
                <div className="text-[11px] text-white/60 mb-2">
                  n={h2h.n} trận{h2h.n < 5 ? ' · Không đủ dữ liệu (n<5)' : ''}
                </div>
                {h2h.n >= 1 && (
                  <div className="flex gap-2 flex-wrap text-[11px]">
                    <span style={{ color: '#4ade80' }}>
                      {t1} thắng H2: {Math.round((h2h.t1WinsH2 / h2h.n) * 100)}%
                    </span>
                    <span style={{ color: '#888' }}>
                      Hòa: {Math.round((h2h.drawsH2 / h2h.n) * 100)}%
                    </span>
                    <span style={{ color: '#f87171' }}>
                      {t2} thắng H2: {Math.round((h2h.t2WinsH2 / h2h.n) * 100)}%
                    </span>
                  </div>
                )}
                {h2h.n >= 5 && h2h.t1WinsH2 !== h2h.t2WinsH2 && (
                  <div className="mt-1.5 text-[11px] text-[#fbbf24]">
                    Trong bối cảnh H1 {selected.label}:{' '}
                    {h2h.t1WinsH2 > h2h.t2WinsH2 ? t1 : t2} có H2 mạnh hơn (
                    {h2h.t1WinsH2 > h2h.t2WinsH2
                      ? Math.round((h2h.t1WinsH2 / h2h.n) * 100)
                      : Math.round((h2h.t2WinsH2 / h2h.n) * 100)}
                    % vs{' '}
                    {h2h.t1WinsH2 > h2h.t2WinsH2
                      ? Math.round((h2h.t2WinsH2 / h2h.n) * 100)
                      : Math.round((h2h.t1WinsH2 / h2h.n) * 100)}
                    %)
                  </div>
                )}
                {h2h.h2DistTop2.length > 0 && (
                  <div className="mt-2 flex gap-1.5 flex-wrap">
                    {h2h.h2DistTop2.map(([score, count]) => (
                      <span
                        key={score}
                        className="rounded bg-white/[.06] px-2 py-0.5 text-[11px] text-white/60"
                      >
                        {score} ({count}x)
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-[11px] text-[#555]">Không đủ dữ liệu</div>
            )}
          </div>

          <div className="mt-3 mb-1 text-[11px] font-semibold text-[#888]">
            Tỉ số H2 phổ biến nhất:
          </div>
          <div className="flex flex-wrap gap-2">
            {outcome.h2DistTop5.slice(0, 3).map((d) => (
              <span
                key={d.score}
                className="rounded bg-[#1e1e1e] px-2.5 py-1 text-xs"
              >
                <b className="text-white">{d.score}</b>
                <span className="ml-1.5 text-[10px] text-[#666]">
                  {d.count} · {Math.round((d.count / outcome.total) * 100)}%
                </span>
              </span>
            ))}
          </div>
        </>
      )}

      {outcome && outcome.total === 0 && selected && (
        <div className="mt-3 text-xs text-[#666]">
          Không có trận nào với H1 {selected.label}
        </div>
      )}
    </div>
  );
}

function H2DecisionPanel({
  matches,
  t1,
  t2,
}: {
  matches: Match[];
  t1: string;
  t2: string;
}) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[#2a2a2a] bg-[#141414]">
      <div className="border-b border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3 text-[15px] font-bold text-white">
        🎯 Phân tích Hiệp 2: {t1} vs {t2}
      </div>
      <div className="flex flex-col gap-4 p-4">
        <H2CompareBar matches={matches} t1={t1} t2={t2} />
        <H1ScenarioPicker matches={matches} t1={t1} t2={t2} />
      </div>
    </div>
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
      <H2DecisionPanel matches={matches} t1={t1} t2={t2} />
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
