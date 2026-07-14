'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SearchDropdown from './SearchDropdown';

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
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map(([label, val]) => (
        <div
          key={label}
          className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2.5"
        >
          <div className="text-[10px] text-white/40">{label}</div>
          <div className="mt-0.5 text-sm font-bold text-white">{val}</div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ snapshots, homeTeam, awayTeam }: { snapshots: Snapshot[]; homeTeam: string; awayTeam: string }) {
  return (
    <div className="overflow-x-auto border-t border-[#2a2a2a] bg-[#0f0f0f]">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="text-[10px] text-white/40">
            <th className="px-2 py-1.5 font-medium">Phút</th>
            <th className="px-2 py-1.5 font-medium">Sự kiện</th>
            <th className="px-2 py-1.5 font-medium">Tỉ số</th>
            <th className="px-2 py-1.5 font-medium">HC TT</th>
            <th className="px-2 py-1.5 font-medium">OU TT</th>
            <th className="px-2 py-1.5 font-medium">HC H1</th>
            <th className="px-2 py-1.5 font-medium">OU H1</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s, i) => {
            const prev = i > 0 ? snapshots[i - 1] : null;
            const goal = isGoal(s.snapshotType);
            // Determine which team scored by comparing scores with previous snapshot
            let scorer: string | null = null;
            if (goal && prev) {
              if (s.scoreHome > prev.scoreHome) scorer = homeTeam;
              else if (s.scoreAway > prev.scoreAway) scorer = awayTeam;
            }
            // H2 minutes are within-half; display on 90' scale by adding 45
            const displayMinute = s.minute == null ? null : s.isH2 ? 45 + s.minute : s.minute;
            return (
              <tr
                key={i}
                className={`border-t border-[#1e1e1e] text-xs ${
                  goal ? 'bg-[#4ade80]/[0.07]' : ''
                }`}
              >
                <td className="px-2 py-1.5 text-white/60">
                  {displayMinute == null ? '—' : `${displayMinute}'`}
                </td>
                <td className={`px-2 py-1.5 ${snapshotColor(s.snapshotType)}`}>
                  {SNAPSHOT_LABEL[s.snapshotType] ?? s.snapshotType}
                  {scorer && <span className="ml-1.5 text-[10px] text-[#aaa]">· {scorer}</span>}
                </td>
                <td className="px-2 py-1.5 font-semibold text-white">
                  {s.scoreHome}-{s.scoreAway}
                </td>
                <td className="px-2 py-1.5 text-white/80">
                  {s.hcLine ?? '—'}
                  <DriftArrow dir={driftDir(s.hcLine, prev?.hcLine ?? null)} />
                </td>
                <td className="px-2 py-1.5 text-white/80">
                  {s.ouLine ?? '—'}
                  <DriftArrow dir={driftDir(s.ouLine, prev?.ouLine ?? null)} />
                </td>
                <td className="px-2 py-1.5 text-white/80">
                  {s.hcH1Line ?? '—'}
                  <DriftArrow dir={driftDir(s.hcH1Line, prev?.hcH1Line ?? null)} />
                </td>
                <td className="px-2 py-1.5 text-white/80">
                  {s.ouH1Line ?? '—'}
                  <DriftArrow dir={driftDir(s.ouH1Line, prev?.ouH1Line ?? null)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MatchRow({ match }: { match: MatchGroup }) {
  const [open, setOpen] = useState(false);
  const first = firstSnapshot(match);
  const last = lastSnapshot(match);
  const h1 = h1Score(match);

  return (
    <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#141414]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="text-[10px] text-white/40">
          📅 {fmtDate(match.matchDate)}
        </span>
        <span className="text-xs font-semibold text-white">
          {match.homeTeam}{' '}
          <span className="mx-1 text-[#fbbf24]">
            {match.finalScore.home}–{match.finalScore.away}
          </span>{' '}
          {match.awayTeam}
        </span>
        {h1 && (
          <span className="text-[10px] text-white/45">
            H1: <span className="text-[#93c5fd]">{h1.home}–{h1.away}</span>
          </span>
        )}
        <span className="text-[10px] text-white/50">
          HC: {first?.hcLine ?? '—'} → {last?.hcLine ?? '—'}
        </span>
        <span className="text-[10px] text-white/50">
          OU: {first?.ouLine ?? '—'} → {last?.ouLine ?? '—'}
        </span>
        <span className="ml-auto text-[10px] text-white/40">
          {open ? '▲' : '▼'}
        </span>
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
  const [aMatches, setAMatches] = useState<MatchGroup[]>([]);
  const [bMatches, setBMatches] = useState<MatchGroup[]>([]);
  const [tab, setTab] = useState<'a' | 'b'>('a');
  const [analyzedA, setAnalyzedA] = useState('');
  const [analyzedB, setAnalyzedB] = useState('');

  // Auto-fetch when embedded with pre-filled teams
  useEffect(() => {
    if (!embedded || !initialTeamA || !initialTeamB) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      fetch(`/api/match-analysis?homeTeam=${encodeURIComponent(initialTeamA)}&awayTeam=${encodeURIComponent(initialTeamB)}`).then(r => r.json()),
      fetch(`/api/match-analysis?homeTeam=${encodeURIComponent(initialTeamB)}&awayTeam=${encodeURIComponent(initialTeamA)}`).then(r => r.json()),
    ]).then(([aJson, bJson]: [{ ok: boolean; matches?: MatchGroup[] }, { ok: boolean; matches?: MatchGroup[] }]) => {
      if (!alive) return;
      setAMatches(aJson.matches ?? []);
      setBMatches(bJson.matches ?? []);
      setAnalyzedA(initialTeamA);
      setAnalyzedB(initialTeamB);
      setTab('a');
    }).catch(e => { if (alive) setError(String(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const [aRes, bRes] = await Promise.all([
        fetch(
          `/api/match-analysis?homeTeam=${encodeURIComponent(teamA)}&awayTeam=${encodeURIComponent(teamB)}`,
        ),
        fetch(
          `/api/match-analysis?homeTeam=${encodeURIComponent(teamB)}&awayTeam=${encodeURIComponent(teamA)}`,
        ),
      ]);
      const aJson = (await aRes.json()) as {
        ok: boolean;
        matches?: MatchGroup[];
        error?: string;
      };
      const bJson = (await bRes.json()) as {
        ok: boolean;
        matches?: MatchGroup[];
        error?: string;
      };
      if (!aJson.ok) throw new Error(aJson.error ?? 'Lỗi truy vấn');
      if (!bJson.ok) throw new Error(bJson.error ?? 'Lỗi truy vấn');
      setAMatches(aJson.matches ?? []);
      setBMatches(bJson.matches ?? []);
      setAnalyzedA(teamA);
      setAnalyzedB(teamB);
      setTab('a');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setAMatches([]);
      setBMatches([]);
    } finally {
      setLoading(false);
    }
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
            <span className="pb-2 text-xs text-white/40">vs</span>
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

      {/* Loading state for embedded mode */}
      {embedded && loading && (
        <div className="flex h-[120px] items-center justify-center text-[13px] text-white/40">
          Đang tải…
        </div>
      )}
      {embedded && error && (
        <div className="mx-3 mt-3 rounded-md bg-[#f87171]/10 px-3 py-2 text-[11px] text-[#f87171]">{error}</div>
      )}

      {analyzed ? (
        <>
          {/* Tabs */}
          <div className={`flex gap-2 flex-wrap ${embedded ? 'px-3 pt-3 pb-2' : 'mb-4'}`}>
            <button
              type="button"
              onClick={() => setTab('a')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === 'a'
                  ? 'bg-[#17a2b8] text-white'
                  : 'bg-white/10 text-white/65 hover:bg-white/20 hover:text-white'
              }`}
            >
              🏠 {analyzedA} ({aMatches.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('b')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === 'b'
                  ? 'bg-[#17a2b8] text-white'
                  : 'bg-white/10 text-white/65 hover:bg-white/20 hover:text-white'
              }`}
            >
              🏠 {analyzedB} ({bMatches.length})
            </button>
          </div>

          <div className={embedded ? 'px-3 pb-4' : ''}>
            <MatchList matches={tab === 'a' ? aMatches : bMatches} />
          </div>
        </>
      ) : !embedded ? (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wide">Tất cả trận gần đây</span>
            <span className="text-[10px] text-white/30">{recentMatches.length} trận</span>
          </div>
          {recentMatches.length === 0 ? (
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
