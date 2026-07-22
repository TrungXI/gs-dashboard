'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import SearchDropdown from './SearchDropdown';
import { LoadingState, Spinner } from './Spinner';
import MatchupCard from './MatchupCard';
import type {
  GsTeamHistoryResponse,
  MatchupResponse,
  MatchupBlock,
  TeamFormBlock,
  Tier,
  Lean,
} from '../lib/teamForm';

const CARD = 'overflow-hidden rounded-[10px] border border-[#2a2a2a] bg-[#141414]';
const TITLE = 'bg-[#1a1a1a] px-4 py-3 text-[15px] font-bold text-white border-b border-[#2a2a2a]';

type N = 20 | 100;

const TIER_LABEL: Record<Tier, { vn: string; cls: string }> = {
  strong: { vn: 'MẠNH', cls: 'bg-[#4ade80]/15 text-[#4ade80]' },
  mid: { vn: 'TRUNG BÌNH', cls: 'bg-[#fbbf24]/15 text-[#fbbf24]' },
  weak: { vn: 'YẾU', cls: 'bg-[#f87171]/15 text-[#f87171]' },
};

const LEAN_LABEL: Record<Lean, string> = {
  h1: 'nghiêng Hiệp 1',
  h2: 'nghiêng Hiệp 2',
  balanced: 'cân bằng H1/H2',
};

export default function TeamFormReport() {
  const [teamFilter, setTeamFilter] = useState(''); // Đội A
  const [teamB, setTeamB] = useState('');           // Đội B (matchup)
  const [n, setN] = useState<N>(20);
  const [data, setData] = useState<TeamFormBlock[]>([]);
  const [matchup, setMatchup] = useState<MatchupBlock | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dropdown options: fetched once from the all-teams payload, cached.
  const [teamOptions, setTeamOptions] = useState<string[]>([]);
  const optionsLoaded = useRef(false);

  // Matchup mode is derived: both teams set (and distinct) → H2H narrative card.
  const isMatchup = !!teamFilter && !!teamB && teamB !== teamFilter;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    if (isMatchup) {
      const url = `/api/gs-team-history?v=2&mode=matchup&teamA=${encodeURIComponent(
        teamFilter,
      )}&teamB=${encodeURIComponent(teamB)}`;
      fetch(url)
        .then((r) => r.json())
        .then((json: MatchupResponse) => {
          if (!alive) return;
          if (!json.ok) {
            setError(json.error || 'Lỗi tải dữ liệu');
            setMatchup(null);
            return;
          }
          setMatchup(json.matchup ?? null);
        })
        .catch((e) => {
          if (alive) {
            setError(e instanceof Error ? e.message : String(e));
            setMatchup(null);
          }
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
      return () => {
        alive = false;
      };
    }

    const url = `/api/gs-team-history?v=2&team=${encodeURIComponent(teamFilter)}&n=${n}`;
    fetch(url)
      .then((r) => r.json())
      .then((json: GsTeamHistoryResponse) => {
        if (!alive) return;
        if (!json.ok) {
          setError(json.error || 'Lỗi tải dữ liệu');
          setData([]);
          return;
        }
        const teams = json.teams ?? [];
        setData(teams);
        // Populate the dropdown from the first all-teams payload we see.
        if (!optionsLoaded.current && !teamFilter) {
          optionsLoaded.current = true;
          setTeamOptions(teams.map((b) => b.team).sort((a, b) => a.localeCompare(b)));
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e));
          setData([]);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [teamFilter, teamB, n, isMatchup]);

  const options = useMemo(
    () => [
      { value: '', label: '-- Tất cả đội --' },
      ...teamOptions.map((t) => ({ value: t, label: t })),
    ],
    [teamOptions],
  );

  const optionsB = useMemo(
    () => [
      { value: '', label: '-- (so kèo với đội B) --' },
      ...teamOptions.map((t) => ({ value: t, label: t })),
    ],
    [teamOptions],
  );

  return (
    <>
      <div className="mb-5 flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">🔄 Quy luật phong độ</h1>
        <span className="text-[13px] text-[#666]">
          {isMatchup
            ? `${teamFilter} vs ${teamB} · ${matchup?.meetings ?? 0} lần gặp`
            : `${teamFilter ? teamFilter : `${data.length} đội`} · ${n} trận gần nhất`}
        </span>
      </div>

      {/* Filter bar */}
      <div className="mb-5 flex flex-wrap items-center gap-2.5 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] px-4 py-3 max-md:sticky max-md:top-0 max-md:z-30">
        <div className="w-52">
          <SearchDropdown
            options={options}
            value={teamFilter}
            onChange={setTeamFilter}
            placeholder="-- Tất cả đội --"
          />
        </div>
        <div className="w-52">
          <SearchDropdown
            options={optionsB}
            value={teamB}
            onChange={setTeamB}
            placeholder="-- (so kèo với đội B) --"
          />
        </div>
        {!isMatchup && (
          <div className="flex gap-1.5">
            {([20, 100] as N[]).map((v) => (
              <button
                key={v}
                onClick={() => setN(v)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  n === v
                    ? 'bg-[#17a2b8] text-white'
                    : 'bg-white/10 text-white/65 hover:bg-white/20 hover:text-white'
                }`}
              >
                {v} trận
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Overview honesty panel — the real rule */}
      <OverviewRulePanel />

      {isMatchup ? (
        <MatchupCard matchup={matchup} loading={loading} error={error} />
      ) : loading && data.length === 0 ? (
        // Lần đầu (chưa có data) → full loading.
        <LoadingState label="Đang tải phong độ đội…" />
      ) : error ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="text-3xl">⚠️</div>
          <div className="text-[13px] text-[#f87171]">{error}</div>
        </div>
      ) : data.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="mb-3 text-4xl">📭</div>
          <div className="text-[14px] text-[#888]">Không có dữ liệu phong độ</div>
        </div>
      ) : (
        // Reload (đổi đội / đổi 20↔100) → giữ danh sách cũ + phủ mờ, không blank trắng.
        <div className="relative">
          {loading && (
            <div className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-md bg-[#141414]/80 px-2 py-1 text-[11px] font-semibold text-[#17a2b8]">
              <Spinner size={12} /> Đang tải…
            </div>
          )}
          <div className={`mt-4 flex flex-col gap-4 transition-opacity duration-200 ${loading ? 'pointer-events-none opacity-40' : ''}`}>
            {data.map((block) => (
              <TeamBlock key={block.team} block={block} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Overview: the honest "quy luật thực tế" (data-supported) ────────────────

function OverviewRulePanel() {
  return (
    <div className={`${CARD} mb-4`}>
      <div className={TITLE}>📌 Quy luật thực tế (theo dữ liệu)</div>
      <div className="p-4 text-[12.5px] leading-relaxed text-[#bbb]">
        <ul className="flex flex-col gap-1.5">
          <li>
            • Sức mạnh đội = <span className="font-semibold text-white">tier cố định</span> (Mạnh /
            Trung bình / Yếu), <span className="text-[#fbbf24]">không</span> chạy theo chu kỳ &quot;cứ N
            trận&quot;.
          </li>
          <li>
            • Thắng/thua trận này <span className="font-semibold text-white">không dự báo</span> trận
            sau — kết quả gần như độc lập (đã kiểm định).
          </li>
          <li>
            • Hiệp 1 và Hiệp 2 <span className="font-semibold text-white">cùng chiều</span> (r≈+0.29);
            dẫn HT → thắng FT <span className="font-semibold text-[#4ade80]">~82%</span> ⇒{' '}
            <span className="text-[#4ade80]">không có &quot;gài hàng&quot;</span> hệ thống.
          </li>
          <li>
            • Sparkline &amp; &quot;lệch H1/H2&quot; bên dưới là <span className="text-[#fbbf24]">mô tả phong
            độ gần đây (nhiễu)</span>, không phải tín hiệu cược.
          </li>
        </ul>
      </div>
    </div>
  );
}

// ── One team block ──────────────────────────────────────────────────────────

function TeamBlock({ block }: { block: TeamFormBlock }) {
  const { team, n, record, tier, trend, halves, matches } = block;
  const tl = TIER_LABEL[tier.tier];

  return (
    <div className={CARD}>
      <div className={`${TITLE} flex flex-wrap items-center gap-2`}>
        <span>{team}</span>
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${tl.cls}`}>
          {tl.vn} · {tier.winPct}%
        </span>
        <span className="text-[12px] font-normal text-[#888]">
          {record.W}-{record.D}-{record.L} · thắng {record.ftWinPct}% · {n} trận
        </span>
      </div>

      <div className="p-4">
        {/* Summary grid */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Xu hướng / phong độ gần đây */}
          <div className="rounded-lg border border-[#2a2a2a] bg-[#181818] p-3">
            <div className="mb-2 text-[12px] font-bold text-white">📈 Phong độ gần đây</div>
            <FormSparkline form={trend.form} />
            <div className="mt-2 text-[11px] text-[#888]">
              {trend.strongest && (
                <div>
                  Mạnh nhất: trận{' '}
                  <span className="text-[#4ade80]">
                    {trend.strongest.fromDisplay + 1}–{trend.strongest.toDisplay + 1}
                  </span>{' '}
                  ({trend.strongest.wins}W)
                </div>
              )}
              {trend.weakest && (
                <div>
                  Yếu nhất: trận{' '}
                  <span className="text-[#f87171]">
                    {trend.weakest.fromDisplay + 1}–{trend.weakest.toDisplay + 1}
                  </span>{' '}
                  ({trend.weakest.wins}W)
                </div>
              )}
              <div className="mt-1 text-[10px] italic text-[#666]">Chỉ mô tả, không dự báo.</div>
            </div>
          </div>

          {/* W/D/L */}
          <div className="rounded-lg border border-[#2a2a2a] bg-[#181818] p-3">
            <div className="mb-2 text-[12px] font-bold text-white">📊 W / D / L ({n} trận)</div>
            <BarRow label="Thắng" pct={record.ftWinPct} color="#4ade80" count={record.W} />
            <BarRow label="Hòa" pct={record.drawPct} color="#fbbf24" count={record.D} />
            <BarRow label="Thua" pct={record.lossPct} color="#f87171" count={record.L} />
          </div>

          {/* H1 vs H2 */}
          <div className="rounded-lg border border-[#2a2a2a] bg-[#181818] p-3">
            <div className="mb-2 text-[12px] font-bold text-white">⏱ Hiệp 1 vs Hiệp 2</div>
            <div className="text-[12px] text-[#ddd]">
              H1 thắng <span className="font-semibold text-[#4ade80]">{halves.h1WinPct}%</span> · H2
              thắng <span className="font-semibold text-[#4ade80]">{halves.h2WinPct}%</span>
            </div>
            <div className="mt-1 text-[11px] text-[#888]">
              Chênh bàn: H1 {fmtDiff(halves.h1GoalDiff)} · H2 {fmtDiff(halves.h2GoalDiff)}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-[#17a2b8]/15 px-2 py-0.5 text-[11px] font-semibold text-[#22d3ee]">
                {LEAN_LABEL[halves.lean]}
              </span>
              {halves.lowConfidence && (
                <span
                  title="Chênh lệch nhỏ / mẫu mỏng — độ tin thấp, đừng dùng để cược."
                  className="rounded-md bg-[#fbbf24]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fbbf24]"
                >
                  ⚠ độ tin thấp
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[11px] text-[#888]">
              Dẫn HT → thắng FT:{' '}
              <span className="font-semibold text-white">
                {halves.htLeadFtWinPct == null ? '—' : `${halves.htLeadFtWinPct}%`}
              </span>{' '}
              <span className="text-[#666]">({halves.htLeadCount} trận dẫn HT)</span>
            </div>
          </div>
        </div>

        {/* Match list — newest first */}
        <div className="overflow-hidden rounded-lg border border-[#2a2a2a]">
          <div className="flex items-center gap-2 bg-[#1a1a1a] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#666]">
            <span className="w-6">#</span>
            <span className="w-28">Thời gian</span>
            <span className="w-6 text-center">S</span>
            <span className="flex-1">Đối thủ</span>
            <span className="w-14 text-center">H1</span>
            <span className="w-14 text-center">FT</span>
            <span className="w-6 text-center">KQ</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {matches.map((m, i) => {
              const r = m.ft[0] > m.ft[1] ? 'W' : m.ft[0] < m.ft[1] ? 'L' : 'D';
              const dot = r === 'W' ? '#4ade80' : r === 'D' ? '#fbbf24' : '#f87171';
              return (
                <div
                  key={`${m.time}-${i}`}
                  className="flex items-center gap-2 border-b border-[#2a2a2a] px-3 py-1.5 text-[12px] last:border-b-0"
                >
                  <span className="w-6 text-[#666]">{i + 1}</span>
                  <span className="w-28 text-[#999]">{m.time}</span>
                  <span className="w-6 text-center">
                    <span
                      className={`inline-block rounded px-1 text-[9px] font-bold ${
                        m.isHome ? 'bg-[#17a2b8]/25 text-[#22d3ee]' : 'bg-white/10 text-white/60'
                      }`}
                    >
                      {m.isHome ? 'H' : 'A'}
                    </span>
                  </span>
                  <span className="flex-1 truncate text-[#ddd]">{m.opponent}</span>
                  <span className="w-14 text-center text-[#aaa]">
                    {m.h1[0]}-{m.h1[1]}
                  </span>
                  <span className="w-14 text-center font-semibold text-white">
                    {m.ft[0]}-{m.ft[1]}
                  </span>
                  <span className="w-6 text-center">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: dot }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── small view helpers ──────────────────────────────────────────────────────

function fmtDiff(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function BarRow({ label, pct, color, count }: { label: string; pct: number; color: string; count: number }) {
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="mb-0.5 flex items-baseline justify-between text-[11px]">
        <span className="text-[#888]">{label}</span>
        <span className="font-semibold" style={{ color }}>
          {pct}% <span className="font-normal text-[#666]">({count})</span>
        </span>
      </div>
      <div className="h-[6px] w-full overflow-hidden rounded bg-[#2a2a2a]">
        <div className="h-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** Recent-form dots: one square per match, oldest→newest (green W / amber D / red L). */
function FormSparkline({ form }: { form: number[] }) {
  if (form.length === 0) return <div className="text-[11px] text-[#666]">—</div>;
  return (
    <div className="flex flex-wrap gap-0.5">
      {form.map((s, i) => {
        const c = s > 0 ? '#4ade80' : s < 0 ? '#f87171' : '#fbbf24';
        return (
          <span
            key={i}
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ background: c }}
            title={s > 0 ? 'Thắng' : s < 0 ? 'Thua' : 'Hòa'}
          />
        );
      })}
    </div>
  );
}
