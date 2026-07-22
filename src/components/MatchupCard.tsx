'use client';

import { LoadingState, Spinner } from './Spinner';
import type { MatchupBlock, MatchupSummary, ScenarioBlock, Lean } from '../lib/teamForm';
import {
  levelSentence,
  leadSentence,
  overallH2Sentence,
  summaryLine,
} from '../lib/matchupNarrative';

const CARD = 'overflow-hidden rounded-[10px] border border-[#2a2a2a] bg-[#141414]';
const TITLE = 'bg-[#1a1a1a] px-4 py-3 text-[15px] font-bold text-white border-b border-[#2a2a2a]';

const ITEM = 'rounded-lg border border-[#2a2a2a] bg-[#181818] p-3';

// Lean descriptor — mirrors the single-team card (TeamFormReport).
const LEAN_LABEL: Record<Lean, string> = {
  h1: 'nghiêng Hiệp 1',
  h2: 'nghiêng Hiệp 2',
  balanced: 'cân bằng H1/H2',
};

/** Sample-size chip — every stat must show its n; thin/very-thin flagged amber. */
function Nflag({ n, thin, veryThin }: { n: number; thin?: boolean; veryThin?: boolean }) {
  if (veryThin) {
    return (
      <span className="rounded-md bg-[#fbbf24]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fbbf24]">
        n={n} · chỉ tham khảo
      </span>
    );
  }
  if (thin) {
    return (
      <span className="rounded-md bg-[#fbbf24]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fbbf24]">
        n={n} · mẫu mỏng
      </span>
    );
  }
  return (
    <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/60">
      n={n}
    </span>
  );
}

function Bullet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={ITEM}>
      <div className="mb-1 text-[12.5px] font-bold text-white">{title}</div>
      <div className="text-[12.5px] leading-relaxed text-[#ddd]">{children}</div>
    </div>
  );
}

/** "Chưa gặp tình huống này." when a scenario has zero meetings. */
function EmptyScenario() {
  return <span className="italic text-[#888]">Chưa gặp tình huống này.</span>;
}

export default function MatchupCard({
  matchup,
  loading,
  error,
}: {
  matchup: MatchupBlock | null;
  loading: boolean;
  error: string | null;
}) {
  // Lần đầu (chưa có data) → full loading. Reload (đã có matchup, đổi trận) →
  // giữ khung cũ + phủ mờ bên dưới, không blank trắng.
  if (loading && !matchup) return <LoadingState label="Đang tải đối đầu…" />;

  if (error) {
    return (
      <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
        <div className="text-3xl">⚠️</div>
        <div className="text-[13px] text-[#f87171]">{error}</div>
      </div>
    );
  }

  if (!matchup) return null;

  const { teamA, teamB, meetings, thinOverall, veryThinOverall, scenarios, overallH2 } = matchup;

  if (meetings === 0) {
    return (
      <div className={`${CARD} mt-4`}>
        <div className={`${TITLE} flex flex-wrap items-center gap-2`}>
          <span>{teamA}</span>
          <span className="text-[#666]">vs</span>
          <span>{teamB}</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 p-8">
          <div className="text-3xl">📭</div>
          <div className="text-[13px] text-[#888]">
            {teamA} và {teamB} chưa từng gặp nhau trong dữ liệu.
          </div>
        </div>
      </div>
    );
  }

  const { level, aLeadsH1, bLeadsH1 } = scenarios;
  const { summary, rows } = matchup;

  return (
    <div className="relative">
      {/* Reload (đổi trận) → phủ mờ data cũ + spinner nhỏ, không blank trắng */}
      {loading && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-[#141414]/80 px-2 py-1 text-[11px] font-semibold text-[#17a2b8]">
          <Spinner size={12} /> Đang tải…
        </div>
      )}
    <div className={`${CARD} mt-4 transition-opacity duration-200 ${loading ? 'pointer-events-none opacity-40' : ''}`}>
      <div className={`${TITLE} flex flex-wrap items-center gap-2`}>
        <span>{teamA}</span>
        <span className="text-[#666]">vs</span>
        <span>{teamB}</span>
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70">
          {meetings} lần gặp
        </span>
        {veryThinOverall ? (
          <span className="rounded-md bg-[#fbbf24]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fbbf24]">
            ⚠️ rất ít trận (n={meetings}) — chỉ tham khảo
          </span>
        ) : thinOverall ? (
          <span className="rounded-md bg-[#fbbf24]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fbbf24]">
            ⚠️ mẫu mỏng (n={meetings})
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* Summary card — A-perspective (mirrors the single-team summary grid) */}
        <SummaryGrid summary={summary} teamA={teamA} teamB={teamB} />

        {/* Bullet 1 — H1 dằng co (level) */}
        <Bullet title="1 · Hiệp 1 dằng co (hoà nhau)">
          {level.n === 0 ? (
            <EmptyScenario />
          ) : (
            <>
              {levelSentence(level, teamA, teamB)} <ScenarioFlag s={level} />
            </>
          )}
        </Bullet>

        {/* Bullet 2 — Team B dẫn trước H1 */}
        <Bullet title={`2 · ${teamB} dẫn trước Hiệp 1`}>
          {bLeadsH1.n === 0 ? (
            <EmptyScenario />
          ) : (
            <>
              {leadSentence(bLeadsH1, teamB)} <ScenarioFlag s={bLeadsH1} />
            </>
          )}
        </Bullet>

        {/* Bullet 3 — Team A dẫn trước H1 */}
        <Bullet title={`3 · ${teamA} dẫn trước Hiệp 1`}>
          {aLeadsH1.n === 0 ? (
            <EmptyScenario />
          ) : (
            <>
              {leadSentence(aLeadsH1, teamA)} <ScenarioFlag s={aLeadsH1} />
            </>
          )}
        </Bullet>

        {/* Bullet 4 — Diễn biến H2 tổng quát */}
        <Bullet title="4 · Diễn biến Hiệp 2 nhìn chung">
          {overallH2Sentence(overallH2, teamA, teamB, meetings)}{' '}
          <Nflag n={meetings} thin={thinOverall} veryThin={veryThinOverall} />
        </Bullet>

        {/* Always-on honesty footer */}
        <div className="text-[11px] italic leading-relaxed text-[#666]">
          Dữ liệu đối đầu rất mỏng (tối đa 36 trận/cặp). Mọi tỉ lệ chia theo tình huống H1 chỉ dựa trên
          vài trận — tham khảo, không phải tín hiệu cược chắc chắn.
        </div>

        {/* H2H match list — newest→oldest, team-oriented (A's goals first) */}
        <MatchupMatchList rows={rows} teamA={teamA} teamB={teamB} />
      </div>
    </div>
    </div>
  );
}

// ── Summary card (A-perspective) — mirrors the single-team summary grid ───────

function SummaryGrid({
  summary,
  teamA,
  teamB,
}: {
  summary: MatchupSummary;
  teamA: string;
  teamB: string;
}) {
  const { form, halves, record, meetings } = summary;
  return (
    <>
    <div className="rounded-lg border border-[#2a2a2a] bg-[#181818] px-3 py-2 text-[12.5px] font-semibold text-[#ddd]">
      {summaryLine(summary, teamA, teamB)}
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {/* Phong độ gần đây (A across the meetings) */}
      <div className="rounded-lg border border-[#2a2a2a] bg-[#181818] p-3">
        <div className="mb-2 text-[12px] font-bold text-white">📈 Phong độ gần đây</div>
        <FormSparkline form={form} />
        <div className="mt-2 text-[11px] italic text-[#666]">
          Kết quả của {teamA} qua {meetings} lần gặp (mới nhất bên phải). Chỉ mô tả.
        </div>
      </div>

      {/* W / D / L (A / hoà / B) */}
      <div className="rounded-lg border border-[#2a2a2a] bg-[#181818] p-3">
        <div className="mb-2 text-[12px] font-bold text-white">📊 W / D / L ({meetings} lần)</div>
        <BarRow label={`${teamA} thắng`} pct={record.aWinPct} color="#4ade80" count={record.aWin} />
        <BarRow label="Hoà" pct={record.drawPct} color="#fbbf24" count={record.draw} />
        <BarRow label={`${teamB} thắng`} pct={record.bWinPct} color="#f87171" count={record.bWin} />
      </div>

      {/* Hiệp 1 vs Hiệp 2 (A's goal-diff lean) */}
      <div className="rounded-lg border border-[#2a2a2a] bg-[#181818] p-3">
        <div className="mb-2 text-[12px] font-bold text-white">⏱ Hiệp 1 vs Hiệp 2</div>
        <div className="text-[11px] text-[#888]">
          Chênh bàn của {teamA}: H1 {fmtDiff(halves.h1GoalDiff)} · H2 {fmtDiff(halves.h2GoalDiff)}
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
      </div>
    </div>
    </>
  );
}

// ── H2H match list — reuses the single-team match-row style ───────────────────

function MatchupMatchList({
  rows,
  teamA,
  teamB,
}: {
  rows: MatchupBlock['rows'];
  teamA: string;
  teamB: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-[#2a2a2a]">
      <div className="flex items-center gap-2 bg-[#1a1a1a] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#666]">
        <span className="w-6">#</span>
        <span className="w-28">Thời gian</span>
        <span className="flex-1">Trận ({teamA} vs {teamB})</span>
        <span className="w-32">Giải</span>
        <span className="w-6 text-center">KQ</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {rows.map((m, i) => {
          const r = m.aFT > m.bFT ? 'W' : m.aFT < m.bFT ? 'L' : 'D';
          const dot = r === 'W' ? '#4ade80' : r === 'D' ? '#fbbf24' : '#f87171';
          return (
            <div
              key={`${m.time}-${i}`}
              className="flex items-center gap-2 border-b border-[#2a2a2a] px-3 py-1.5 text-[12px] last:border-b-0"
            >
              <span className="w-6 text-[#666]">{i + 1}</span>
              <span className="w-28 text-[#999]">{m.time}</span>
              <span className="flex-1 text-[#ddd]">
                <span className="text-[#aaa]">
                  {m.aH1}-{m.bH1}
                </span>{' '}
                <span className="text-[#666]">→</span>{' '}
                <span className="font-semibold text-white">
                  {m.aFT}-{m.bFT}
                </span>
              </span>
              <span className="w-32 truncate text-[11px] text-[#888]">{m.league || '—'}</span>
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
  );
}

// ── small view helpers (mirror the single-team card) ──────────────────────────

function fmtDiff(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function BarRow({
  label,
  pct,
  color,
  count,
}: {
  label: string;
  pct: number;
  color: string;
  count: number;
}) {
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="mb-0.5 flex items-baseline justify-between text-[11px]">
        <span className="truncate text-[#888]">{label}</span>
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

/** Recent-form dots: one square per meeting, oldest→newest (green W / amber D / red L). */
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
            title={s > 0 ? 'Thắng' : s < 0 ? 'Thua' : 'Hoà'}
          />
        );
      })}
    </div>
  );
}

/** Renders the Nflag for a scenario block (n + thin/very-thin state). */
function ScenarioFlag({ s }: { s: ScenarioBlock }) {
  return <Nflag n={s.n} thin={s.thin} veryThin={s.veryThin} />;
}
