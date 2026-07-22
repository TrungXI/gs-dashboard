'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { H2HCell, H2HLeader, H2HMatrix as H2HMatrixData } from '../lib/gsMatchesDb';
import { LoadingState, Spinner } from './Spinner';

type League = '20p' | '16p';
type Market = 'ft' | 'h1';

// A deep-link handler: jump to the bet-table view pre-filtered to this pair.
export type OpenPairFn = (p: { type: League; team: string; team2: string }) => void;

interface H2HResponse extends Partial<H2HMatrixData> {
  ok: boolean;
  error?: string;
}

// Short team label — strip the " (S)" / " (V)" suffix (redundant once a league is chosen).
function shortName(name: string): string {
  return name.replace(/\s*\([SV]\)\s*$/, '');
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// Over% → cell background. High Tài = green, ≈50% = gray, low Tài (Xỉu-heavy) = red.
function cellStyle(overPct: number): React.CSSProperties {
  const t = Math.max(0, Math.min(1, overPct)); // 0..1
  // Diverge from a neutral gray at 0.5.
  if (t >= 0.5) {
    const k = (t - 0.5) / 0.5; // 0..1 toward green
    return { background: `rgba(34, 197, 94, ${0.12 + 0.55 * k})`, color: '#e6ffe9' };
  }
  const k = (0.5 - t) / 0.5; // 0..1 toward red
  return { background: `rgba(239, 68, 68, ${0.12 + 0.55 * k})`, color: '#ffecec' };
}

function LeaderList({
  title,
  accent,
  rows,
  metric,
  type,
  onOpenPair,
}: {
  title: string;
  accent: string;
  rows: H2HLeader[];
  metric: 'tai' | 'xiu';
  type: League;
  onOpenPair: OpenPairFn;
}) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414]">
      <div className="border-b border-[#222] px-3 py-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: accent }}>
        {title}
      </div>
      <div className="flex flex-col">
        {rows.length === 0 && (
          <div className="px-3 py-4 text-center text-[12px] text-[#666]">Chưa đủ dữ liệu</div>
        )}
        {rows.map((r) => {
          const value = metric === 'tai' ? r.overPct : r.underPct;
          const marginSign = r.avgMargin > 0 ? '+' : '';
          return (
            <button
              key={`${r.t1}|${r.t2}`}
              type="button"
              onClick={() => onOpenPair({ type, team: r.t1, team2: r.t2 })}
              className="flex items-center gap-2 border-b border-[#1a1a1a]/70 px-3 py-2 text-left transition-colors last:border-0 hover:bg-white/[.03]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-[#ddd]">
                  {shortName(r.t1)} <span className="text-[#555]">vs</span> {shortName(r.t2)}
                </div>
                <div className="mt-0.5 text-[10px] tabular-nums text-[#6f6f6f]">
                  {r.n} trận · TB <span className="text-[#9a9a9a]">{r.avgTotal.toFixed(1)}</span> bàn · chênh{' '}
                  <span style={{ color: r.avgMargin >= 0 ? '#4ade80' : '#f87171' }}>
                    {marginSign}{r.avgMargin.toFixed(2)}
                  </span>
                </div>
              </div>
              <span className="w-12 text-right text-[13px] font-bold tabular-nums" style={{ color: accent }}>
                {pct(value)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Head-to-head verdict card — shown when exactly two teams are picked. Answers
// "cặp này ra Tài hay Xỉu nhiều hơn?" for that single matchup.
function PairVerdict({
  cell,
  a,
  b,
  type,
  onOpenPair,
}: {
  cell: H2HCell | undefined;
  a: string;
  b: string;
  type: League;
  onOpenPair: OpenPairFn;
}) {
  if (!cell) {
    return (
      <div className="rounded-lg border border-dashed border-[#3a3a3a] bg-[#141414] p-5 text-center text-[13px] text-[#888]">
        <div className="mb-1 text-[15px] font-bold text-[#ddd]">
          {shortName(a)} <span className="text-[#555]">vs</span> {shortName(b)}
        </div>
        Chưa đủ dữ liệu — cặp này &lt; 5 trận đối đầu.
      </div>
    );
  }
  const taiPct = cell.overPct;
  const xiuPct = cell.n > 0 ? cell.under / cell.n : 0;
  const leanTai = cell.over > cell.under;
  const leanXiu = cell.under > cell.over;
  const verdict = leanTai ? 'NGHIÊNG TÀI' : leanXiu ? 'NGHIÊNG XỈU' : 'CÂN BẰNG';
  const vColor = leanTai ? '#4ade80' : leanXiu ? '#f87171' : '#9a9a9a';
  const marginSign = cell.avgMargin > 0 ? '+' : '';
  return (
    <button
      type="button"
      onClick={() => onOpenPair({ type, team: cell.t1, team2: cell.t2 })}
      className="w-full rounded-lg border border-[#2a2a2a] bg-[#141414] p-4 text-left transition-colors hover:bg-white/[.03]"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[15px] font-bold text-[#eee]">
          {shortName(a)} <span className="text-[#555]">vs</span> {shortName(b)}
        </div>
        <span
          className="whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-bold"
          style={{ background: `${vColor}22`, color: vColor }}
        >
          {verdict}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-[#22c55e]/[.08] px-3 py-2.5 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#4ade80]">Tài</div>
          <div className="text-[22px] font-extrabold tabular-nums text-[#4ade80]">{pct(taiPct)}</div>
          <div className="text-[10px] tabular-nums text-[#6f6f6f]">{cell.over}/{cell.n} trận</div>
        </div>
        <div className="rounded-md bg-[#ef4444]/[.08] px-3 py-2.5 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f87171]">Xỉu</div>
          <div className="text-[22px] font-extrabold tabular-nums text-[#f87171]">{pct(xiuPct)}</div>
          <div className="text-[10px] tabular-nums text-[#6f6f6f]">{cell.under}/{cell.n} trận</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#888]">
        <span>{cell.n} trận đối đầu</span>
        <span>· TB <span className="text-[#bbb] tabular-nums">{cell.avgTotal.toFixed(1)}</span> bàn</span>
        <span>
          · chênh{' '}
          <span className="tabular-nums" style={{ color: cell.avgMargin >= 0 ? '#4ade80' : '#f87171' }}>
            {marginSign}{cell.avgMargin.toFixed(2)}
          </span>
        </span>
        <span className="ml-auto font-semibold text-[#17a2b8]">Xem chi tiết kèo →</span>
      </div>
    </button>
  );
}

export default function H2HMatrix({ onOpenPair }: { onOpenPair: OpenPairFn }) {
  const [league, setLeague] = useState<League>('20p');
  const [market, setMarket] = useState<Market>('ft');
  const [data, setData] = useState<H2HMatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cross-highlight: two selected teams. They only highlight (row+column), never
  // filter the matrix down. '' = none.
  const [hi1, setHi1] = useState('');
  const [hi2, setHi2] = useState('');
  // Ref to the head-to-head intersection cell, so we can scroll it into view.
  const pairCellRef = useRef<HTMLTableCellElement | null>(null);

  const load = useCallback(async (lg: League, mk: Market) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gs-h2h-matrix?type=${lg}&market=${mk}`, { cache: 'no-store' });
      const json = (await res.json()) as H2HResponse;
      if (!json.ok) {
        setError(json.error || 'Lỗi tải dữ liệu');
        setData(null);
        return;
      }
      setData({
        teams: json.teams ?? [],
        cells: json.cells ?? [],
        leadersTai: json.leadersTai ?? [],
        leadersXiu: json.leadersXiu ?? [],
      });
    } catch (e) {
      setError(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(league, market);
  }, [league, market, load]);

  // When the team list changes (league/market toggle), drop any highlighted team
  // that no longer exists in the new league — reset it gracefully to '—'.
  useEffect(() => {
    const set = new Set(data?.teams ?? []);
    if (hi1 && !set.has(hi1)) setHi1('');
    if (hi2 && !set.has(hi2)) setHi2('');
  }, [data, hi1, hi2]);

  // Scroll the head-to-head intersection cell into view once both are selected.
  useEffect(() => {
    if (hi1 && hi2 && hi1 !== hi2 && pairCellRef.current) {
      pairCellRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [hi1, hi2, data]);

  // Fast lookup: unordered pair → cell.
  const cellMap = useMemo(() => {
    const m = new Map<string, H2HCell>();
    for (const c of data?.cells ?? []) {
      m.set(`${c.t1}|${c.t2}`, c);
    }
    return m;
  }, [data]);

  const teams = data?.teams ?? [];
  const lookup = (a: string, b: string): H2HCell | undefined => {
    const [t1, t2] = a < b ? [a, b] : [b, a];
    return cellMap.get(`${t1}|${t2}`);
  };

  // Cross-highlight helpers.
  const anyHi = !!(hi1 || hi2);
  const isHiTeam = (t: string) => t === hi1 || t === hi2;
  // A cell (rowT, colT) is on a cross if either endpoint is a highlighted team.
  const onCross = (rowT: string, colT: string) => isHiTeam(rowT) || isHiTeam(colT);
  // The head-to-head intersection of the two picked teams (both orientations).
  const isPairCell = (rowT: string, colT: string) =>
    !!(hi1 && hi2 && hi1 !== hi2 &&
      ((rowT === hi1 && colT === hi2) || (rowT === hi2 && colT === hi1)));

  // Exactly two teams picked → show their single head-to-head verdict instead
  // of the leader lists (the "cặp này ra Tài hay Xỉu nhiều hơn" question).
  const bothPicked = !!(hi1 && hi2 && hi1 !== hi2);
  const pairCell = bothPicked ? lookup(hi1, hi2) : undefined;

  // Bottom "cặp lệch nhất" lists — computed CLIENT-SIDE from the full `cells`
  // set (not the server's pre-sliced top-10) so the "Soi đội" picker can filter
  // them: when a team is highlighted, show only pairs that involve it.
  const filteredLeaders = useMemo(() => {
    const anySel = !!(hi1 || hi2);
    const involves = (c: H2HCell) =>
      c.t1 === hi1 || c.t2 === hi1 || c.t1 === hi2 || c.t2 === hi2;
    const leaders: H2HLeader[] = (data?.cells ?? [])
      .filter((c) => !anySel || involves(c))
      .map((c) => ({
        t1: c.t1,
        t2: c.t2,
        n: c.n,
        over: c.over,
        under: c.under,
        overPct: c.overPct,
        underPct: c.n > 0 ? c.under / c.n : 0,
        avgTotal: c.avgTotal,
        avgMargin: c.avgMargin,
      }));
    const cap = anySel ? 50 : 10;
    const tai = [...leaders].sort((a, b) => b.overPct - a.overPct || b.n - a.n).slice(0, cap);
    const xiu = [...leaders].sort((a, b) => b.underPct - a.underPct || b.n - a.n).slice(0, cap);
    return { tai, xiu };
  }, [data, hi1, hi2]);

  const leagueChips: [League, string][] = [
    ['20p', '20p (V)'],
    ['16p', '16p (S)'],
  ];
  const marketChips: [Market, string][] = [
    ['ft', 'FT (cả trận)'],
    ['h1', 'H1 (hiệp 1)'],
  ];

  return (
    <>
      <h1 className="mb-1 text-[18px] font-extrabold">🔥 Ma trận Tài/Xỉu</h1>
      <p className="mb-4 text-[12px] text-[#888]">
        Tỉ lệ ra <span className="font-semibold text-[#4ade80]">Tài</span> của từng cặp đối đầu trong
        cùng giải, theo hiệp đang chọn. Xanh = nghiêng Tài, đỏ = nghiêng Xỉu. Ô trống khi &lt; 5 trận.
        Bảng dưới có <span className="text-[#9a9a9a]">TB</span> = trung bình tổng bàn của hiệp đó và{' '}
        <span className="text-[#4ade80]">chênh</span> = TB (tổng bàn − line kèo); chênh dương = vượt line
        (Tài), âm = dưới line (Xỉu). Bấm để xem chi tiết kèo.
      </p>

      {/* Toggles */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex gap-1.5">
          {leagueChips.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setLeague(v)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                league === v
                  ? 'bg-[#17a2b8] text-white'
                  : 'bg-white/10 text-white/65 hover:bg-white/20 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-white/30">·</span>
        <div className="flex gap-1.5">
          {marketChips.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setMarket(v)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                market === v
                  ? 'bg-[#7c3aed] text-white'
                  : 'bg-white/10 text-white/65 hover:bg-white/20 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {loading && data && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-[#17a2b8]">
            <Spinner size={12} /> Đang tải…
          </span>
        )}
        {data && !loading && (
          <span className="ml-auto text-[11px] text-[#666]">
            {data.cells.length} cặp · {teams.length} đội
          </span>
        )}
      </div>

      {/* Cross-highlight team pickers — highlight only, don't filter the matrix. */}
      {data && teams.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-[#777]">Soi đội:</span>
          <select
            value={hi1}
            onChange={(e) => setHi1(e.target.value)}
            className="rounded-md bg-white/[.07] px-2.5 py-1.5 text-[12px] text-white outline-none focus:bg-white/10"
          >
            <option value="" className="bg-[#111] text-white">— Đội 1 —</option>
            {teams.map((t) => (
              <option key={t} value={t} className="bg-[#111] text-white">{shortName(t)}</option>
            ))}
          </select>
          <span className="text-[11px] text-white/30">×</span>
          <select
            value={hi2}
            onChange={(e) => setHi2(e.target.value)}
            className="rounded-md bg-white/[.07] px-2.5 py-1.5 text-[12px] text-white outline-none focus:bg-white/10"
          >
            <option value="" className="bg-[#111] text-white">— Đội 2 —</option>
            {teams.map((t) => (
              <option key={t} value={t} className="bg-[#111] text-white">{shortName(t)}</option>
            ))}
          </select>
          {(hi1 || hi2) && (
            <button
              onClick={() => { setHi1(''); setHi2(''); }}
              className="rounded-md bg-white/[.07] px-2 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/15 hover:text-white"
            >
              Bỏ soi
            </button>
          )}
        </div>
      )}

      {error !== null ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
          <div className="text-3xl">⚠️</div>
          <div className="text-[13px] text-[#f87171]">{error}</div>
          <button
            onClick={() => load(league, market)}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20 hover:text-white"
          >
            Thử lại
          </button>
        </div>
      ) : loading && data === null ? (
        <LoadingState label="Đang tải ma trận…" className="py-24" />
      ) : (
        <div className={`transition-opacity duration-200 ${loading ? 'pointer-events-none opacity-40' : ''}`}>
          {/* Heatmap matrix — desktop / tablet only (too wide for phones). */}
          <div className="hidden sm:block overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#141414]">
            <table className="border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 bg-[#141414] p-1.5" />
                  {teams.map((t) => {
                    const hiT = isHiTeam(t);
                    return (
                      <th
                        key={t}
                        className={`h-[86px] whitespace-nowrap p-1 align-bottom transition-colors ${
                          hiT ? 'text-amber-300' : anyHi ? 'text-[#666]' : 'text-[#999]'
                        }`}
                        title={t}
                      >
                        <div
                          className={`mx-auto w-[16px] origin-bottom-left translate-x-[10px] rotate-[-60deg] text-left font-semibold ${
                            hiT ? 'rounded-sm bg-amber-400/15 px-1' : ''
                          }`}
                        >
                          {shortName(t)}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {teams.map((rowT) => (
                  <tr key={rowT}>
                    <th
                      className={`sticky left-0 z-10 whitespace-nowrap bg-[#141414] px-2 py-1 text-right font-semibold transition-colors ${
                        isHiTeam(rowT) ? 'text-amber-300' : anyHi ? 'text-[#666]' : 'text-[#ccc]'
                      }`}
                    >
                      {isHiTeam(rowT) ? (
                        <span className="rounded-sm bg-amber-400/15 px-1">{shortName(rowT)}</span>
                      ) : (
                        shortName(rowT)
                      )}
                    </th>
                    {teams.map((colT) => {
                      const cross = onCross(rowT, colT);
                      const dim = anyHi && !cross;
                      if (rowT === colT) {
                        return (
                          <td
                            key={colT}
                            className={`h-7 w-7 bg-[#1c1c1c] ${dim ? 'opacity-30' : ''}`}
                          />
                        );
                      }
                      const cell = lookup(rowT, colT);
                      if (!cell) {
                        return (
                          <td
                            key={colT}
                            className={`h-7 w-7 border border-[#0d0d0d] bg-white/[.02] ${
                              dim ? 'opacity-30' : ''
                            }`}
                          />
                        );
                      }
                      const pair = isPairCell(rowT, colT);
                      return (
                        <td
                          key={colT}
                          ref={pair ? pairCellRef : undefined}
                          onClick={() =>
                            onOpenPair({ type: league, team: cell.t1, team2: cell.t2 })
                          }
                          title={`${shortName(cell.t1)} vs ${shortName(cell.t2)} — ${cell.n} trận · Tài ${pct(
                            cell.overPct,
                          )} · Xỉu ${pct(cell.n > 0 ? cell.under / cell.n : 0)} · TB ${cell.avgTotal.toFixed(
                            1,
                          )} bàn · chênh ${cell.avgMargin >= 0 ? '+' : ''}${cell.avgMargin.toFixed(2)}`}
                          className={`h-7 w-7 cursor-pointer border text-center font-bold tabular-nums transition-all hover:scale-110 ${
                            pair
                              ? 'relative z-10 ring-2 ring-amber-400 ring-inset'
                              : 'border-[#0d0d0d]'
                          } ${dim ? 'opacity-30' : cross ? 'brightness-125' : ''}`}
                          style={cellStyle(cell.overPct)}
                        >
                          {Math.round(cell.overPct * 100)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="mt-2 mb-5 hidden items-center gap-2 text-[11px] text-[#888] sm:flex">
            <span>Xỉu-heavy</span>
            <span className="inline-block h-3 w-6 rounded-sm" style={cellStyle(0)} />
            <span className="inline-block h-3 w-6 rounded-sm" style={cellStyle(0.5)} />
            <span className="inline-block h-3 w-6 rounded-sm" style={cellStyle(1)} />
            <span>Tài-heavy</span>
            <span className="ml-2 text-[#555]">· số trong ô = Tài%</span>
          </div>

          {/* Mobile note */}
          <div className="mb-4 rounded-lg border border-dashed border-[#3a3a3a] bg-[#141414] p-3 text-[12px] text-[#888] sm:hidden">
            Ma trận quá rộng cho điện thoại — xem 2 bảng xếp hạng &quot;cặp lệch nhất&quot; bên dưới.
          </div>

          {/* 2 đội → kết quả đối đầu; 1/0 đội → danh sách cặp lệch nhất */}
          {bothPicked ? (
            <PairVerdict cell={pairCell} a={hi1} b={hi2} type={league} onOpenPair={onOpenPair} />
          ) : (
            <>
              {anyHi && (
                <p className="mb-2 text-[11px] text-[#777]">
                  Đang lọc cặp có{' '}
                  <span className="font-semibold text-amber-300">
                    {[hi1, hi2].filter(Boolean).map(shortName).join(' / ')}
                  </span>
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <LeaderList
                  title="🟢 Cặp nghiêng Tài nhất"
                  accent="#4ade80"
                  rows={filteredLeaders.tai}
                  metric="tai"
                  type={league}
                  onOpenPair={onOpenPair}
                />
                <LeaderList
                  title="🔴 Cặp nghiêng Xỉu nhất"
                  accent="#f87171"
                  rows={filteredLeaders.xiu}
                  metric="xiu"
                  type={league}
                  onOpenPair={onOpenPair}
                />
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
