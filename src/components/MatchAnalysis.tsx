'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SearchDropdown from './SearchDropdown';
import { LoadingState, Spinner } from './Spinner';

interface Snapshot {
  snapshotType: string;
  period: number | null;
  minute: number | null;
  isH2: boolean;
  scoreHome: number;
  scoreAway: number;
  suspended: boolean;
  bettingOpen: boolean;
  oddsHome: string | null;
  oddsAway: string | null;
  oddsDraw: string | null;
  malayHome: string | null;
  malayAway: string | null;
  malayDraw: string | null;
  hcLine: string | null;
  hcHomeOdds: string | null;
  hcAwayOdds: string | null;
  hcHomeGives: boolean;
  hcH1Line: string | null;
  hcH1HomeOdds: string | null;
  hcH1AwayOdds: string | null;
  hcH1HomeGives: boolean;
  ouLine: string | null;
  ouOver: string | null;
  ouUnder: string | null;
  ouH1Line: string | null;
  ouH1Over: string | null;
  ouH1Under: string | null;
  yellowHome: number;
  yellowAway: number;
  redHome: number;
  redAway: number;
  cornersHome: number;
  cornersAway: number;
  recordedAt: string | null;
}

interface MatchGroup {
  eventId: number;
  matchDate: string | null;
  matchType: string | null;
  homeTeam: string;
  awayTeam: string;
  finalScore: { home: number; away: number };
  snapshots: Snapshot[];
}

const SNAPSHOT_LABEL: Record<string, string> = {
  first_seen: 'Bắt đầu',
  kickoff_h1: 'Kick off H1',
  kickoff_h2: 'Kick off H2',
  goal_h1: '⚽ Bàn H1',
  goal_h2: '⚽ Bàn H2',
};

function snapshotColor(type: string): string {
  if (type === 'first_seen') return 'text-white/50';
  if (type === 'goal_h1' || type === 'goal_h2') return 'text-[#4ade80]';
  if (type === 'kickoff_h1' || type === 'kickoff_h2') return 'text-[#60a5fa]';
  return 'text-white/60';
}

function isGoal(type: string): boolean {
  return type === 'goal_h1' || type === 'goal_h2';
}

function parseLine(v: string | null): number | null {
  if (v == null || v === '') return null;
  const parts = v.split('-').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** Compare two lines; +1 up, -1 down, 0 unchanged/unknown. */
function driftDir(cur: string | null, prev: string | null): number {
  const c = parseLine(cur);
  const p = parseLine(prev);
  if (c == null || p == null) return 0;
  if (c > p) return 1;
  if (c < p) return -1;
  return 0;
}

function DriftArrow({ dir }: { dir: number }) {
  if (dir > 0) return <span className="text-[#4ade80]"> ↑</span>;
  if (dir < 0) return <span className="text-[#f87171]"> ↓</span>;
  return null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  if (!m || !d) return iso;
  return `${d}/${m}`;
}

function avg(nums: number[]): number | null {
  const valid = nums.filter((n) => Number.isFinite(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function fmtNum(n: number | null, digits = 2): string {
  return n == null ? '—' : n.toFixed(digits);
}

function firstSnapshot(m: MatchGroup): Snapshot | undefined {
  return m.snapshots.find((s) => s.snapshotType === 'first_seen') ?? m.snapshots[0];
}

function lastSnapshot(m: MatchGroup): Snapshot | undefined {
  return m.snapshots[m.snapshots.length - 1];
}

/** H1 final score = score at kickoff_h2, or last non-H2 snapshot. */
function h1Score(m: MatchGroup): { home: number; away: number } | null {
  const ht = m.snapshots.find((s) => s.snapshotType === 'kickoff_h2');
  if (ht) return { home: ht.scoreHome, away: ht.scoreAway };
  const lastH1 = [...m.snapshots].reverse().find((s) => !s.isH2);
  if (lastH1) return { home: lastH1.scoreHome, away: lastH1.scoreAway };
  return null;
}

function Summary({ matches }: { matches: MatchGroup[] }) {
  const hcAvg = avg(
    matches
      .map((m) => parseLine(firstSnapshot(m)?.hcLine ?? null))
      .filter((n): n is number => n != null),
  );
  const ouAvg = avg(
    matches
      .map((m) => parseLine(firstSnapshot(m)?.ouLine ?? null))
      .filter((n): n is number => n != null),
  );
  const goalsAvg = avg(
    matches.map((m) => m.finalScore.home + m.finalScore.away),
  );

  const cards: [string, string][] = [
    ['Số trận', String(matches.length)],
    ['HC TB', fmtNum(hcAvg)],
    ['OU TB', fmtNum(ouAvg)],
    ['Bàn/trận TB', fmtNum(goalsAvg)],
  ];

  return (
    <div className="mb-3 grid grid-cols-4 gap-1.5">
      {cards.map(([label, val]) => (
        <div
          key={label}
          className="rounded-md border border-[#2a2a2a] bg-[#141414] px-2 py-1.5 text-center"
        >
          <div className="text-[9px] text-white/35 leading-tight">{label}</div>
          <div className="mt-0.5 text-xs font-bold text-white">{val}</div>
        </div>
      ))}
    </div>
  );
}

function HcCell({
  line, homeGives, homeTeam, awayTeam, prev, prevLine,
}: {
  line: string | null; homeGives: boolean; homeTeam: string; awayTeam: string;
  prev?: Snapshot | null; prevLine: string | null;
}) {
  if (!line) return <span className="text-white/30">-</span>;
  const giver = homeGives ? homeTeam : awayTeam;
  return (
    <span className="tabular-nums">
      <span className="text-white/45 text-[11px]">{giver}</span>
      {' '}
      <span className="text-white/80">-{line}</span>
      <DriftArrow dir={driftDir(line, prevLine)} />
    </span>
  );
}

function Timeline({ snapshots, homeTeam, awayTeam }: { snapshots: Snapshot[]; homeTeam: string; awayTeam: string }) {
  return (
    <div className="border-t border-[#2a2a2a] bg-[#0f0f0f]">
      {/* ── Mobile: card per snapshot ── */}
      <div className="md:hidden divide-y divide-[#1a1a1a]">
        {snapshots.map((s, i) => {
          const prev = i > 0 ? snapshots[i - 1] : null;
          const goal = isGoal(s.snapshotType);
          let scorer: string | null = null;
          if (goal && prev) {
            if (s.scoreHome > prev.scoreHome) scorer = homeTeam;
            else if (s.scoreAway > prev.scoreAway) scorer = awayTeam;
          }
          const displayMinute = s.minute == null ? null : s.isH2 ? 45 + s.minute : s.minute;
          return (
            <div key={i} className={`px-3 py-2 ${goal ? 'bg-[#4ade80]/[0.06]' : ''}`}>
              {/* Row 1: minute · event · score */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/45 tabular-nums w-8 shrink-0">
                  {displayMinute == null ? '-' : `${displayMinute}'`}
                </span>
                <span className={`text-[12px] flex-1 ${snapshotColor(s.snapshotType)}`}>
                  {SNAPSHOT_LABEL[s.snapshotType] ?? s.snapshotType}
                  {scorer && <span className="ml-1 text-[11px] text-[#aaa]">· {scorer}</span>}
                </span>
                <span className="text-[13px] font-bold text-white tabular-nums shrink-0">
                  {s.scoreHome}-{s.scoreAway}
                </span>
              </div>
              {/* Row 2: HC TT + OU TT */}
              <div className="mt-1 grid grid-cols-2 gap-x-2 text-[11px]">
                <div>
                  <span className="text-white/30">HC TT </span>
                  <HcCell line={s.hcLine} homeGives={s.hcHomeGives} homeTeam={homeTeam} awayTeam={awayTeam} prev={prev} prevLine={prev?.hcLine ?? null} />
                </div>
                <div className="text-white/65 tabular-nums">
                  <span className="text-white/30">OU TT </span>
                  {s.ouLine ?? '-'}
                  <DriftArrow dir={driftDir(s.ouLine, prev?.ouLine ?? null)} />
                </div>
              </div>
              {/* Row 3: HC H1 + OU H1 */}
              <div className="mt-0.5 grid grid-cols-2 gap-x-2 text-[11px]">
                <div>
                  <span className="text-white/30">HC H1 </span>
                  <HcCell line={s.hcH1Line} homeGives={s.hcH1HomeGives} homeTeam={homeTeam} awayTeam={awayTeam} prev={prev} prevLine={prev?.hcH1Line ?? null} />
                </div>
                <div className="text-white/65 tabular-nums">
                  <span className="text-white/30">OU H1 </span>
                  {s.ouH1Line ?? '-'}
                  <DriftArrow dir={driftDir(s.ouH1Line, prev?.ouH1Line ?? null)} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Desktop: table ── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full table-fixed min-w-[640px] text-left">
          <colgroup>
            <col className="w-[52px]" />
            <col className="w-[168px]" />
            <col className="w-[64px]" />
            <col />
            <col className="w-[72px]" />
            <col />
            <col className="w-[72px]" />
          </colgroup>
          <thead>
            <tr className="text-xs text-white/40 bg-[#111]">
              <th className="px-3 py-2 font-medium">Phút</th>
              <th className="px-3 py-2 font-medium">Sự kiện</th>
              <th className="px-3 py-2 font-medium">Tỉ số</th>
              <th className="px-3 py-2 font-medium">HC TT (chấp)</th>
              <th className="px-3 py-2 font-medium">OU TT</th>
              <th className="px-3 py-2 font-medium">HC H1 (chấp)</th>
              <th className="px-3 py-2 font-medium">OU H1</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s, i) => {
              const prev = i > 0 ? snapshots[i - 1] : null;
              const goal = isGoal(s.snapshotType);
              let scorer: string | null = null;
              if (goal && prev) {
                if (s.scoreHome > prev.scoreHome) scorer = homeTeam;
                else if (s.scoreAway > prev.scoreAway) scorer = awayTeam;
              }
              const displayMinute = s.minute == null ? null : s.isH2 ? 45 + s.minute : s.minute;
              return (
                <tr key={i} className={`border-t border-[#1e1e1e] text-[13px] ${goal ? 'bg-[#4ade80]/[0.07]' : ''}`}>
                  <td className="px-3 py-2 text-white/55">{displayMinute == null ? '-' : `${displayMinute}'`}</td>
                  <td className={`px-3 py-2 ${snapshotColor(s.snapshotType)}`}>
                    <span className="truncate block">
                      {SNAPSHOT_LABEL[s.snapshotType] ?? s.snapshotType}
                      {scorer && <span className="ml-1.5 text-[11px] text-[#aaa]">· {scorer}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold text-white tabular-nums">{s.scoreHome}-{s.scoreAway}</td>
                  <td className="px-3 py-2">
                    <HcCell line={s.hcLine} homeGives={s.hcHomeGives} homeTeam={homeTeam} awayTeam={awayTeam} prev={prev} prevLine={prev?.hcLine ?? null} />
                  </td>
                  <td className="px-3 py-2 text-white/80 tabular-nums">
                    {s.ouLine ?? '-'}<DriftArrow dir={driftDir(s.ouLine, prev?.ouLine ?? null)} />
                  </td>
                  <td className="px-3 py-2">
                    <HcCell line={s.hcH1Line} homeGives={s.hcH1HomeGives} homeTeam={homeTeam} awayTeam={awayTeam} prev={prev} prevLine={prev?.hcH1Line ?? null} />
                  </td>
                  <td className="px-3 py-2 text-white/80 tabular-nums">
                    {s.ouH1Line ?? '-'}<DriftArrow dir={driftDir(s.ouH1Line, prev?.ouH1Line ?? null)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchRow({ match }: { match: MatchGroup }) {
  const [open, setOpen] = useState(false);
  const first = firstSnapshot(match);
  const last = lastSnapshot(match);
  const h1 = h1Score(match);

  // Đội thắng (theo tỉ số cuối) → tên màu vàng; hoà → giữ trắng bình thường
  const winner: 'home' | 'away' | null =
    match.finalScore.home > match.finalScore.away ? 'home'
    : match.finalScore.away > match.finalScore.home ? 'away'
    : null;
  const homeNameCls = winner === 'home' ? 'text-[#fbbf24]' : 'text-white';
  const awayNameCls = winner === 'away' ? 'text-[#fbbf24]' : 'text-white';

  // Đội thắng hiệp 1 (H1: a–b) → gạch chân đỏ; hoà H1 hoặc thiếu H1 → không gạch
  const h1Winner: 'home' | 'away' | null =
    h1 == null ? null
    : h1.home > h1.away ? 'home'
    : h1.away > h1.home ? 'away'
    : null;
  const h1Underline = 'border-b-2 border-red-500';
  const homeH1Cls = h1Winner === 'home' ? h1Underline : '';
  const awayH1Cls = h1Winner === 'away' ? h1Underline : '';

  return (
    <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#141414]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        {/* ── Mobile layout ── */}
        <div className="md:hidden">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-white/30 shrink-0">{fmtDate(match.matchDate)}</span>
            <span className={`text-[13px] font-semibold ${homeNameCls} ${homeH1Cls} flex-1 truncate text-right`}>{match.homeTeam}</span>
            <span className="text-[13px] font-bold text-[#fbbf24] tabular-nums shrink-0 px-1">
              {match.finalScore.home}–{match.finalScore.away}
            </span>
            <span className={`text-[13px] font-semibold ${awayNameCls} ${awayH1Cls} flex-1 truncate`}>{match.awayTeam}</span>
            <span className="text-[11px] text-white/30 shrink-0 ml-1">{open ? '▲' : '▼'}</span>
          </div>
          <div className="mt-1 flex gap-3 text-[11px] text-white/40 tabular-nums">
            <span>H1: <span className="text-[#93c5fd]">{h1 ? `${h1.home}–${h1.away}` : '-'}</span></span>
            <span>HC: <span className="text-white/60">{first ? (first.hcHomeGives ? match.homeTeam : match.awayTeam) : '-'}</span> -{first?.hcLine ?? '-'}→{last?.hcLine ?? '-'}</span>
            <span>OU: {first?.ouLine ?? '-'}→{last?.ouLine ?? '-'}</span>
          </div>
        </div>

        {/* ── Desktop layout: 8-column grid ── */}
        <div
          className="hidden md:grid items-center gap-x-2"
          style={{ gridTemplateColumns: '52px 1fr 56px 1fr 64px 100px 100px 18px' }}
        >
          <span className="text-[11px] text-white/35 truncate">{fmtDate(match.matchDate)}</span>
          <span className={`text-[13px] font-semibold ${homeNameCls} ${homeH1Cls} truncate text-right`}>{match.homeTeam}</span>
          <span className="text-[13px] font-bold text-[#fbbf24] text-center tabular-nums">
            {match.finalScore.home}–{match.finalScore.away}
          </span>
          <span className={`text-[13px] font-semibold ${awayNameCls} ${awayH1Cls} truncate`}>{match.awayTeam}</span>
          <span className="text-[11px] text-white/40 tabular-nums">
            H1: <span className="text-[#93c5fd]">{h1 ? `${h1.home}–${h1.away}` : '-'}</span>
          </span>
          <span className="text-[11px] text-white/40 tabular-nums">
            HC: <span className="text-white/55">{first ? (first.hcHomeGives ? match.homeTeam : match.awayTeam) : ''}</span> {first?.hcLine ?? '-'} → {last?.hcLine ?? '-'}
          </span>
          <span className="text-[11px] text-white/40 tabular-nums">
            OU: {first?.ouLine ?? '-'} → {last?.ouLine ?? '-'}
          </span>
          <span className="text-[11px] text-white/30 text-right">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && <Timeline snapshots={match.snapshots} homeTeam={match.homeTeam} awayTeam={match.awayTeam} />}
    </div>
  );
}

function MatchList({ matches }: { matches: MatchGroup[] }) {
  const sorted = useMemo(
    () =>
      [...matches].sort((a, b) =>
        (b.matchDate ?? '').localeCompare(a.matchDate ?? ''),
      ),
    [matches],
  );

  if (!matches.length) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-lg border border-[#2a2a2a] bg-[#141414] text-[13px] text-white/40">
        Chưa có dữ liệu
      </div>
    );
  }

  return (
    <>
      <Summary matches={matches} />
      <div className="flex flex-col gap-2">
        {sorted.map((m) => (
          <MatchRow key={m.eventId} match={m} />
        ))}
      </div>
    </>
  );
}

export default function MatchAnalysis({
  initialTeamA,
  initialTeamB,
  embedded = false,
}: {
  initialTeamA?: string;
  initialTeamB?: string;
  embedded?: boolean;
} = {}) {
  const [teams, setTeams] = useState<string[]>([]);
  const [teamA, setTeamA] = useState(initialTeamA ?? '');
  const [teamB, setTeamB] = useState(initialTeamB ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentMatches, setRecentMatches] = useState<MatchGroup[]>([]);
  const [recentLoading, setRecentLoading] = useState(!embedded);
  const [aMatches, setAMatches] = useState<MatchGroup[]>([]);
  const [bMatches, setBMatches] = useState<MatchGroup[]>([]);
  const [tab, setTab] = useState<'all' | 'a' | 'b'>('all');
  const [analyzedA, setAnalyzedA] = useState('');
  const [analyzedB, setAnalyzedB] = useState('');

  // Auto-fetch when embedded with pre-filled teams. Refetch khi đổi trận qua ◀▶
  // (initialTeamA/initialTeamB đổi) — giữ data cũ + phủ mờ, không blank trắng.
  useEffect(() => {
    if (!embedded || !initialTeamA || !initialTeamB) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/match-analysis?homeTeam=${encodeURIComponent(initialTeamA)}&awayTeam=${encodeURIComponent(initialTeamB)}`)
      .then(r => r.json())
      .then((json: { ok: boolean; aMatches?: MatchGroup[]; bMatches?: MatchGroup[] }) => {
        if (!alive) return;
        setAMatches(json.aMatches ?? []);
        setBMatches(json.bMatches ?? []);
        setAnalyzedA(initialTeamA);
        setAnalyzedB(initialTeamB);
        setTab('all');
      }).catch(e => { if (alive) setError(String(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [embedded, initialTeamA, initialTeamB]);

  useEffect(() => {
    if (embedded) return; // skip teams + recent fetch when embedded
    let alive = true;
    (async () => {
      try {
        const [teamsRes, recentRes] = await Promise.all([
          fetch('/api/match-analysis?action=teams'),
          fetch('/api/match-analysis?action=recent'),
        ]);
        const teamsJson = (await teamsRes.json()) as { ok: boolean; teams?: string[] };
        const recentJson = (await recentRes.json()) as { ok: boolean; matches?: MatchGroup[] };
        if (alive && teamsJson.ok && teamsJson.teams) setTeams(teamsJson.teams);
        if (alive && recentJson.ok && recentJson.matches) setRecentMatches(recentJson.matches);
      } catch {
        /* ignore */
      } finally {
        if (alive) setRecentLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const reset = useCallback(() => {
    setTeamA('');
    setTeamB('');
    setAMatches([]);
    setBMatches([]);
    setAnalyzedA('');
    setAnalyzedB('');
    setError(null);
  }, []);

  const teamOptions = useMemo(
    () => [
      { value: '', label: 'Chọn đội...' },
      ...teams.map((t) => ({ value: t, label: t })),
    ],
    [teams],
  );

  const analyze = useCallback(async () => {
    if (!teamA || !teamB) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/match-analysis?homeTeam=${encodeURIComponent(teamA)}&awayTeam=${encodeURIComponent(teamB)}`,
      );
      const json = (await res.json()) as {
        ok: boolean;
        aMatches?: MatchGroup[];
        bMatches?: MatchGroup[];
        error?: string;
      };
      if (!json.ok) throw new Error(json.error ?? 'Lỗi truy vấn');
      setAMatches(json.aMatches ?? []);
      setBMatches(json.bMatches ?? []);
      setAnalyzedA(teamA);
      setAnalyzedB(teamB);
      setTab('all');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setAMatches([]);
      setBMatches([]);
    } finally {
      setLoading(false);
    }
  }, [teamA, teamB]);

  const allMatches = useMemo(() => {
    const seen = new Set<number>();
    const merged: MatchGroup[] = [];
    for (const m of [...aMatches, ...bMatches]) {
      if (!seen.has(m.eventId)) {
        seen.add(m.eventId);
        merged.push(m);
      }
    }
    return merged.sort((a, b) => (b.matchDate ?? '').localeCompare(a.matchDate ?? ''));
  }, [aMatches, bMatches]);

  const swapTeams = useCallback(() => {
    const tmp = teamA;
    setTeamA(teamB);
    setTeamB(tmp);
  }, [teamA, teamB]);

  const analyzed = analyzedA !== '' && analyzedB !== '';

  return (
    <div className={embedded ? 'text-white' : 'text-white pt-[160px] md:pt-0'}>
      {/* Selector card — only shown in standalone (non-embedded) mode */}
      {!embedded && (
        <div className="fixed top-0 left-0 right-0 z-40 rounded-none border-b border-[#2a2a2a] bg-[#141414] p-4 md:relative md:mb-5 md:rounded-lg md:border md:border-[#2a2a2a]">
          <h1 className="mb-3 text-sm font-bold text-white">📊 Phân Tích Đối Kháng</h1>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <div className="mb-1 text-[10px] text-white/45">Đội A</div>
              <SearchDropdown
                options={teamOptions}
                value={teamA}
                onChange={setTeamA}
                placeholder="Chọn đội..."
              />
            </div>
            <button
              type="button"
              onClick={swapTeams}
              className="pb-2 text-xs text-white/40 hover:text-white transition-colors"
              title="Đổi 2 đội"
            >⇄</button>
            <div className="min-w-[180px] flex-1">
              <div className="mb-1 text-[10px] text-white/45">Đội B</div>
              <SearchDropdown
                options={teamOptions}
                value={teamB}
                onChange={setTeamB}
                placeholder="Chọn đội..."
              />
            </div>
            <button
              type="button"
              onClick={analyze}
              disabled={!teamA || !teamB || teamA === teamB || loading}
              className="rounded-lg bg-[#17a2b8] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#17a2b8]/80 disabled:opacity-40"
            >
              {loading ? '…' : 'Phân tích'}
            </button>
            {(teamA || teamB || analyzed) && (
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-[#2a2a2a] px-3 py-2 text-xs text-white/50 transition-colors hover:border-[#444] hover:text-white/80"
              >
                ✕ Reset
              </button>
            )}
          </div>
          {error && (
            <div className="mt-3 rounded-md bg-[#f87171]/10 px-3 py-2 text-[11px] text-[#f87171]">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Loading state for embedded mode — lần đầu (chưa analyzed) → full loader;
          refetch khi đổi trận (đã analyzed) → giữ khung + phủ mờ ở block dưới. */}
      {embedded && loading && !analyzed && (
        <LoadingState label="Đang tải đối đầu…" />
      )}
      {embedded && error && (
        <div className="mx-3 mt-3 rounded-md bg-[#f87171]/10 px-3 py-2 text-[11px] text-[#f87171]">{error}</div>
      )}

      {analyzed ? (
        <div className="relative">
          {/* Reload (đổi trận) → spinner nhỏ + phủ mờ data cũ, không blank trắng */}
          {embedded && loading && (
            <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-[#141414]/80 px-2 py-1 text-[11px] font-semibold text-[#17a2b8]">
              <Spinner size={12} /> Đang tải…
            </div>
          )}
          <div className={`transition-opacity duration-200 ${embedded && loading ? 'pointer-events-none opacity-40' : ''}`}>
            {/* Tabs */}
            <div className={`flex gap-1.5 overflow-x-auto scrollbar-none ${embedded ? 'px-3 pt-2.5 pb-2' : 'mb-3'}`}>
              {([
                ['all', '🔀 Tất cả', allMatches.length],
                ['a', analyzedA, aMatches.length],
                ['b', analyzedB, bMatches.length],
              ] as [typeof tab, string, number][]).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`flex-shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    tab === key
                      ? 'bg-[#17a2b8] text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  {label} <span className="opacity-70">({count})</span>
                </button>
              ))}
            </div>

            <div className={embedded ? 'px-3 pb-4' : ''}>
              <MatchList matches={tab === 'all' ? allMatches : tab === 'a' ? aMatches : bMatches} />
            </div>
          </div>
        </div>
      ) : !embedded ? (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wide">Tất cả trận gần đây</span>
            <span className="text-[10px] text-white/30">{recentMatches.length} trận</span>
          </div>
          {recentLoading ? (
            <div className="flex h-[160px] items-center justify-center rounded-lg border border-[#2a2a2a] bg-[#141414] text-[13px] text-white/40">
              Đang tải…
            </div>
          ) : recentMatches.length === 0 ? (
            <div className="flex h-[160px] items-center justify-center rounded-lg border border-[#2a2a2a] bg-[#141414] text-[13px] text-white/40">
              Chưa có dữ liệu — đang thu thập…
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {recentMatches.map((m) => (
                <MatchRow key={m.eventId} match={m} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
