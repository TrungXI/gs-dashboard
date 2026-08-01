'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from './Spinner';

// ── Response shape (mirror /api/gs-tx-timeline) ──────────────────────────────
interface TxTimelineBucket {
  i: number;
  dateVn: string; // 'YYYY-MM-DD'
  hourVn: number; // 0..23
  pnl: number; // delta PnL giờ này
  cumulative: number; // luỹ kế
  bets: number;
}
interface TxTimelineResponse {
  ok: boolean;
  error?: string;
  version: string | null;
  date: string;
  days: number;
  buckets: TxTimelineBucket[];
  totalPnl: number;
  totalBets: number;
}

// ── Range options ────────────────────────────────────────────────────────────
const RANGES: { days: number; label: string }[] = [
  { days: 1, label: '1 ngày' },
  { days: 3, label: '3 ngày' },
  { days: 7, label: '7 ngày' },
  { days: 30, label: '1 tháng' },
];

// Ngày hôm nay theo giờ VN (UTC+7) — pattern +7h như phần còn lại của dashboard.
function todayVn(): string {
  const v = new Date(Date.now() + 7 * 3600_000);
  return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
}

const GREEN = '#4ade80';
const RED = '#fb7185';
const pnlColor = (v: number): string => (v > 0 ? GREEN : v < 0 ? RED : '#8a8a8a');
const pnlStr = (v: number): string => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
// 'YYYY-MM-DD' → 'DD/MM'
const shortDate = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const hh = (h: number): string => `${String(h).padStart(2, '0')}:00`;

// Padding (px) — cố định; W/H đo động theo container để chữ luôn nét, không co theo tỉ lệ.
const PAD_L = 48;
const PAD_R = 14;
const PAD_T = 12;
const PAD_B = 26;

// version: bám theo ô chọn ở bảng "So sánh version". 'all'/trống → server dùng version active (latest).
export default function TxTimelineChart({ version = 'all' }: { version?: string }) {
  const [days, setDays] = useState(7); // default filter 7 ngày
  const [endDate, setEndDate] = useState(todayVn());
  const [data, setData] = useState<TxTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: 700, h: 300 });

  // Đo kích thước khung vẽ theo pixel thật → SVG vẽ 1:1, chữ/số không bị teo trên màn hẹp.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setDims({ w: Math.max(280, Math.round(cr.width)), h: Math.max(200, Math.round(cr.height)) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(async (d: number, end: string, ver: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gs-tx-timeline?days=${d}&date=${end}&version=${encodeURIComponent(ver)}`, { cache: 'no-store' });
      const json = (await res.json()) as TxTimelineResponse;
      if (!json.ok) throw new Error(json.error || 'Lỗi tải biểu đồ');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days, endDate, version);
  }, [days, endDate, version, load]);

  const buckets = useMemo(() => data?.buckets ?? [], [data]);
  const n = buckets.length;

  const W = dims.w;
  const H = dims.h;
  const PLOT_W = W - PAD_L - PAD_R;
  const PLOT_H = H - PAD_T - PAD_B;

  // Thang Y bao gồm 0 để đường luỹ kế luôn tham chiếu mốc 0.
  const { minY, maxY } = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const b of buckets) {
      if (b.cumulative < lo) lo = b.cumulative;
      if (b.cumulative > hi) hi = b.cumulative;
    }
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    return { minY: lo, maxY: hi };
  }, [buckets]);

  const xAt = (i: number): number => PAD_L + (n <= 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const yAt = (v: number): number => PAD_T + (1 - (v - minY) / (maxY - minY)) * PLOT_H;

  // Line tô 2 màu theo VẠCH 0: TRÊN vạch 0 = xanh, DƯỚI = đỏ; đoạn cắt 0 chẻ tại giao điểm.
  const { aboveD, belowD } = useMemo(() => {
    let above = '';
    let below = '';
    const seg = (x0: number, y0: number, x1: number, y1: number) =>
      `M${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} `;
    const yZero = yAt(0);
    for (let i = 1; i < n; i++) {
      const v0 = buckets[i - 1].cumulative;
      const v1 = buckets[i].cumulative;
      const x0 = xAt(i - 1);
      const x1 = xAt(i);
      const y0 = yAt(v0);
      const y1 = yAt(v1);
      const straddles = (v0 > 0 && v1 < 0) || (v0 < 0 && v1 > 0);
      if (straddles) {
        const xc = x0 + (v0 / (v0 - v1)) * (x1 - x0);
        if (v0 > 0) { above += seg(x0, y0, xc, yZero); below += seg(xc, yZero, x1, y1); }
        else { below += seg(x0, y0, xc, yZero); above += seg(xc, yZero, x1, y1); }
      } else if (v0 < 0 || v1 < 0) {
        below += seg(x0, y0, x1, y1);
      } else {
        above += seg(x0, y0, x1, y1);
      }
    }
    return { aboveD: above, belowD: below };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, minY, maxY, n, W, H]);

  const areaPath = useMemo(() => {
    if (n === 0) return '';
    const yZero = yAt(0);
    const top = buckets.map((b, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(b.cumulative).toFixed(1)}`).join(' ');
    return `${top} L${xAt(n - 1).toFixed(1)},${yZero.toFixed(1)} L${xAt(0).toFixed(1)},${yZero.toFixed(1)} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, minY, maxY, n, W, H]);

  const total = data?.totalPnl ?? 0;
  const lineColor = pnlColor(total);

  // ── Nhãn trục X (thưa dần theo bề rộng để không chồng chữ) ──
  const xTicks = useMemo(() => {
    if (n === 0) return [] as { i: number; label: string }[];
    if (days === 1) {
      const step = W < 460 ? 6 : 3;
      return buckets.filter((b) => b.hourVn % step === 0).map((b) => ({ i: b.i, label: `${b.hourVn}h` }));
    }
    const dayStarts = buckets.filter((b) => b.hourVn === 0);
    const target = W < 460 ? 4 : 8;
    const step = Math.ceil(dayStarts.length / target) || 1;
    return dayStarts.filter((_, k) => k % step === 0).map((b) => ({ i: b.i, label: shortDate(b.dateVn) }));
  }, [buckets, days, n, W]);

  // ── Hover: map con trỏ → bucket gần nhất ──
  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || n === 0) return;
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const frac = (px - PAD_L) / PLOT_W;
      const idx = Math.min(Math.max(Math.round(frac * (n - 1)), 0), n - 1);
      setHover(idx);
    },
    [n, W, PLOT_W],
  );

  const hb = hover != null ? buckets[hover] : null;
  const focus = hb ?? buckets[n - 1] ?? null; // đang hover, hoặc mốc mới nhất
  const hasData = (data?.totalBets ?? 0) > 0;

  return (
    <div className="flex h-full flex-col rounded-lg border border-[#2a2a2a] bg-[#141414] p-3">
      {/* Header + controls */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[13px] font-semibold text-[#fbbf24]">📈 PnL cộng dồn theo giờ</span>
        {data?.version && <span className="text-[11px] text-[#888]">{data.version}</span>}
        <span className="text-[13px] font-semibold tabular-nums" style={{ color: lineColor }}>
          {pnlStr(total)}u
        </span>
        {data && <span className="text-[11px] text-[#666]">· {data.totalBets} kèo</span>}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-[#2a2a2a]">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`px-2.5 py-1 text-[11px] ${days === r.days ? 'bg-[#38bdf8]/20 text-white' : 'bg-white/[.04] text-[#aaa] hover:bg-white/[.08]'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={endDate}
            max={todayVn()}
            onChange={(e) => e.target.value && setEndDate(e.target.value)}
            title="Ngày cuối của khoảng xem"
            className="rounded-lg bg-white/[.07] px-2 py-1 text-[11px] text-white outline-none [color-scheme:dark]"
          />
          {loading && <Spinner size={12} />}
        </div>
      </div>

      {/* Dòng đọc số — luôn hiển thị mốc đang hover (hoặc mốc mới nhất): ngày · giờ · PnL */}
      {!error && hasData && focus && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md bg-white/[.03] px-2.5 py-1.5 text-[12px] tabular-nums">
          <span className="font-semibold text-white">
            {shortDate(focus.dateVn)} · {hh(focus.hourVn)}
          </span>
          <span className="text-[#888]">
            giờ này{' '}
            <span className="font-semibold" style={{ color: pnlColor(focus.pnl) }}>
              {pnlStr(focus.pnl)}u
            </span>
            <span className="text-[#666]"> ({focus.bets} kèo)</span>
          </span>
          <span className="text-[#888]">
            cộng dồn{' '}
            <span className="font-semibold" style={{ color: pnlColor(focus.cumulative) }}>
              {pnlStr(focus.cumulative)}u
            </span>
          </span>
          {hb == null && <span className="text-[#555]">· rê chuột/chạm để xem từng mốc</span>}
        </div>
      )}

      {error ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[13px] text-[#f87171]">{error}</div>
      ) : !loading && !hasData ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-[#888]">Chưa có kèo đã chấm trong khoảng này</div>
      ) : (
        <div ref={wrapRef} className="relative min-h-0 w-full flex-1">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="block select-none"
            style={{ touchAction: 'none' }}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {/* Grid: max / 0 / min */}
            {[maxY, 0, minY].map((v, k) => (
              <g key={k}>
                <line
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={yAt(v)}
                  y2={yAt(v)}
                  stroke={v === 0 ? '#3a3a3a' : '#242424'}
                  strokeWidth={1}
                  strokeDasharray={v === 0 ? '0' : '3 4'}
                />
                <text x={PAD_L - 8} y={yAt(v) + 4} textAnchor="end" fontSize={12} fill="#888" className="tabular-nums">
                  {v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)}
                </text>
              </g>
            ))}

            {/* Area (nền mờ) + line 2 màu theo vạch 0: >0 = xanh, ≤0 = đỏ */}
            <path d={areaPath} fill="#6b7280" opacity={0.06} />
            <path d={belowD} fill="none" stroke={RED} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            <path d={aboveD} fill="none" stroke={GREEN} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

            {/* X ticks */}
            {xTicks.map((t) => (
              <text key={t.i} x={xAt(t.i)} y={H - 8} textAnchor="middle" fontSize={12} fill="#888" className="tabular-nums">
                {t.label}
              </text>
            ))}

            {/* Hover guide + point (số hiển thị ở dòng đọc phía trên) */}
            {hb && (
              <g>
                <line x1={xAt(hb.i)} x2={xAt(hb.i)} y1={PAD_T} y2={PAD_T + PLOT_H} stroke="#666" strokeWidth={1} strokeDasharray="3 3" />
                <circle cx={xAt(hb.i)} cy={yAt(hb.cumulative)} r={4.5} fill={hb.cumulative > 0 ? GREEN : RED} stroke="#111" strokeWidth={2} />
              </g>
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
