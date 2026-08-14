'use client';

import { useEffect, useMemo, useState } from 'react';
import { LoadingState } from './Spinner';

type Market = 'h1' | 'ft';
type Tick = {
  recorded_at: string; minute: number | null; period: number; is_h2: boolean;
  score_home: number | null; score_away: number | null;
  home_team: string | null; away_team: string | null;
  betting_open: boolean | null; match_suspended: boolean | null;
  ft_line: number | null; ft_tai: number | null; ft_xiu: number | null; ft_susp: boolean | null;
  h1_line: number | null; h1_tai: number | null; h1_xiu: number | null; h1_susp: boolean | null;
};
type Event = { kind: 'start' | 'goal' | 'lock' | 'open'; text: string; at: string; x: number };

const fmt = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}`;
// Feed có đồng hồ riêng cho mỗi hiệp. Chuẩn hoá nó về đúng thanh trận 0′ → 90′:
// H1 = 0..45, H2 = 45..90. Không hiển thị giờ máy/giờ thực trong UI.
const matchMinuteNo = (t: Tick) => Math.min(90, (t.period === 8 || t.is_h2 ? 45 : 0) + Math.min(45, Math.max(0, Number(t.minute ?? 0))));
const minuteX = (t: Tick) => matchMinuteNo(t);
const matchMinute = (t: Tick) => `${matchMinuteNo(t)}′ · ${t.period === 8 || t.is_h2 ? 'H2' : 'H1'}`;

function marketOf(t: Tick, market: Market) {
  const h1 = market === 'h1';
  const locked = t.betting_open !== true || t.match_suspended === true || (h1 ? t.h1_susp : t.ft_susp) === true;
  return { line: h1 ? t.h1_line : t.ft_line, over: h1 ? t.h1_tai : t.ft_tai, under: h1 ? t.h1_xiu : t.ft_xiu, locked };
}

export default function LiveOddsTimeline({ eventId, activeMarket }: { eventId: number; activeMarket?: 'h1' | 'ft' | null }) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<Market>(activeMarket ?? 'ft');

  useEffect(() => { if (activeMarket) setMarket(activeMarket); }, [activeMarket]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/gs-live-odds?eventId=${eventId}`, { cache: 'no-store' });
        const j = await r.json() as { ok: boolean; ticks?: Tick[]; error?: string };
        if (!alive) return;
        if (!j.ok) setError(j.error ?? 'Không tải được tick odds');
        else { setTicks(j.ticks ?? []); setError(null); }
      } catch { if (alive) setError('Không tải được tick odds'); }
      finally { if (alive) setLoading(false); }
    };
    setLoading(true); setTicks([]); load();
    const id = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [eventId]);

  const events = useMemo<Event[]>(() => {
    const out: Event[] = [];
    let prev: Tick | null = null, prevLocked: boolean | null = null;
    for (const t of ticks) {
      const q = marketOf(t, market), x = minuteX(t), score = `${t.score_home ?? 0}-${t.score_away ?? 0}`;
      if (!prev) out.push({ kind: 'start', text: `Bắt đầu theo dõi · ${score} · line ${q.line ?? '—'} · Tài ${fmt(q.over)} / Xỉu ${fmt(q.under)}`, at: t.recorded_at, x });
      else if ((t.score_home ?? 0) !== (prev.score_home ?? 0) || (t.score_away ?? 0) !== (prev.score_away ?? 0)) {
        const homeScored = (t.score_home ?? 0) > (prev.score_home ?? 0);
        const awayScored = (t.score_away ?? 0) > (prev.score_away ?? 0);
        const scorer = homeScored && awayScored ? 'Có bàn thắng' : homeScored ? (t.home_team ?? 'Đội nhà') : awayScored ? (t.away_team ?? 'Đội khách') : 'Có bàn thắng';
        out.push({ kind: 'goal', text: `⚽ ${scorer} ghi bàn · ${score} · ${matchMinute(t)}`, at: t.recorded_at, x });
      }
      if (prevLocked !== null && q.locked !== prevLocked) out.push({ kind: q.locked ? 'lock' : 'open', text: `${q.locked ? '🔒 Nhà cái khoá kèo' : '🔓 Nhà cái mở kèo'} · ${matchMinute(t)} · line ${q.line ?? '—'} · Tài ${fmt(q.over)} / Xỉu ${fmt(q.under)}`, at: t.recorded_at, x });
      prev = t; prevLocked = q.locked;
    }
    return out.slice(-48).reverse();
  }, [ticks, market]);

  const chart = useMemo(() => {
    const data = ticks.map((t) => ({ t, q: marketOf(t, market), x: minuteX(t) })).filter(({ q }) => q.over != null || q.under != null);
    // Chỉ vẽ đường + tính thang từ tick KÈO MỞ — bỏ giá rác lúc nhà cái khoá (mấy cú gai ±0.9x làm rối chart).
    const open = data.filter((d) => !d.q.locked);
    const vals = open.flatMap(({ q }) => [q.over, q.under]).filter((x): x is number => x != null && Number.isFinite(x));
    const lo = Math.min(-1, ...(vals.length ? vals : [-1])); const hi = Math.max(1, ...(vals.length ? vals : [1]));
    const pad = .08, min = lo - pad, max = hi + pad, w = 600, h = 208, left = 42, top = 18, right = 12, bottom = 28;
    const maxX = 90;
    const px = (x: number) => left + (x / maxX) * (w - left - right);
    const py = (v: number) => top + ((max - v) / (max - min)) * (h - top - bottom);
    const path = (k: 'over' | 'under') => open.filter((d) => d.q[k] != null).map((d, i) => `${i ? 'L' : 'M'}${px(d.x).toFixed(1)},${py(d.q[k]!).toFixed(1)}`).join(' ');
    const locked = data.filter((d) => d.q.locked);
    // Chỉ gắn nhãn odds tại các MỐC chính: mở kèo · ghi bàn · cuối H1 · đầu H2 · hiện tại. Bỏ hết nhãn lặt vặt.
    const near = (x: number) => open.reduce<(typeof open)[number] | null>((best, d) => best == null || Math.abs(d.x - x) < Math.abs(best.x - x) ? d : best, null);
    type Key = { x: number; q: ReturnType<typeof marketOf>; label: string; kind: 'open' | 'goal' | 'ht' | 'now' };
    const key: Key[] = [];
    if (open.length) {
      key.push({ x: open[0].x, q: open[0].q, label: 'Mở kèo', kind: 'open' });
      for (const g of events.filter((e) => e.kind === 'goal')) { const d = near(g.x); if (d) key.push({ x: g.x, q: d.q, label: '⚽ Bàn', kind: 'goal' }); }
      const h1 = open.filter((d) => d.x <= 45), h2 = open.filter((d) => d.x > 45);
      if (h1.length && h2.length) { key.push({ x: h1.at(-1)!.x, q: h1.at(-1)!.q, label: 'Cuối H1', kind: 'ht' }); key.push({ x: h2[0].x, q: h2[0].q, label: 'Đầu H2', kind: 'ht' }); }
      key.push({ x: open.at(-1)!.x, q: open.at(-1)!.q, label: 'Nay', kind: 'now' });
    }
    // Gộp mốc trùng vị trí, ưu tiên bàn thắng > mở > HT > nay.
    const rank: Record<Key['kind'], number> = { goal: 0, open: 1, ht: 2, now: 3 };
    const byX = new Map<number, Key>();
    for (const p of key) { const rx = Math.round(p.x); const e = byX.get(rx); if (!e || rank[p.kind] < rank[e.kind]) byX.set(rx, p); }
    const keyPoints = [...byX.values()].sort((a, b) => a.x - b.x);
    return { w, h, left, top, right, bottom, min, max, px, py, path, locked, keyPoints, maxX, latest: open.at(-1)?.q ?? data.at(-1)?.q ?? null };
  }, [ticks, market, events]);

  if (loading && !ticks.length) return <LoadingState label="Đang tải diễn biến odds…" />;
  if (error) return <div className="m-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[12px] text-[#f87171]">{error}</div>;
  if (!ticks.length) return <div className="p-4 text-[12px] text-[#777]">Chưa có tick odds cho trận này.</div>;

  const latest = chart.latest;
  return <div className="px-3 py-3 md:px-4 md:py-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[#777]">📈 Diễn biến odds live</div>
      <div className="flex gap-1 rounded-md bg-[#191919] p-1">
        {(['h1', 'ft'] as const).map((m) => <button key={m} type="button" onClick={() => setMarket(m)} className={`rounded px-2.5 py-1 text-[11px] font-semibold ${market === m ? 'bg-[#17a2b8] text-white' : 'text-[#888] hover:text-white'}`}>{m === 'h1' ? 'Hiệp 1' : 'Cả trận'}</button>)}
      </div>
    </div>
    <div className="mb-3 grid grid-cols-3 gap-2 text-center">
      <div className="rounded-md border border-[#2a2a2a] bg-[#151515] p-2"><div className="text-[10px] text-[#777]">Line hiện tại</div><div className="mt-0.5 text-[15px] font-bold text-white">{latest?.line ?? '—'}</div></div>
      <div className="rounded-md border border-[#2a2a2a] bg-[#151515] p-2"><div className="text-[10px] text-[#f87171]">Tài</div><div className="mt-0.5 text-[15px] font-bold text-[#fecaca]">{fmt(latest?.over ?? null)}</div></div>
      <div className="rounded-md border border-[#2a2a2a] bg-[#151515] p-2"><div className="text-[10px] text-[#60a5fa]">Xỉu</div><div className="mt-0.5 text-[15px] font-bold text-[#bfdbfe]">{fmt(latest?.under ?? null)}</div></div>
    </div>
    <div className="overflow-x-auto rounded-lg border border-[#282828] bg-[#101010] p-2">
      <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="min-w-[570px] w-full" role="img" aria-label="Biểu đồ odds Tài và Xỉu theo diễn biến trận">
        {[0, .5, 1].map((f) => { const v = chart.min + (chart.max - chart.min) * f; const y = chart.py(v); return <g key={f}><line x1={chart.left} x2={chart.w-chart.right} y1={y} y2={y} stroke="#333" strokeWidth="1"/><text x="3" y={y+4} fill="#777" fontSize="10">{fmt(v)}</text></g>; })}
        <line x1={chart.px(45)} x2={chart.px(45)} y1={chart.top} y2={chart.h-chart.bottom} stroke="#666" strokeDasharray="3 3"/><text x={chart.px(45)+4} y="12" fill="#999" fontSize="10">HT · H2</text>
        {chart.locked.map((d, i) => <rect key={i} x={chart.px(d.x)-2} y={chart.top} width="4" height={chart.h-chart.top-chart.bottom} fill="#f59e0b" opacity=".28"/>)}
        {chart.path('over') && <path d={chart.path('over')} fill="none" stroke="#f87171" strokeWidth="2"/>}
        {chart.path('under') && <path d={chart.path('under')} fill="none" stroke="#60a5fa" strokeWidth="2"/>}
        {chart.keyPoints.map((p, i) => { const gx = chart.px(p.x); const goal = p.kind === 'goal'; return <g key={`${p.kind}-${p.x}-${i}`}>
          <line x1={gx} x2={gx} y1={chart.top} y2={chart.h-chart.bottom} stroke={goal ? '#4ade80' : '#3f3f46'} strokeWidth={goal ? 1.5 : 1} strokeDasharray={goal ? undefined : '2 3'} />
          <text x={gx} y={chart.top-6} fill={goal ? '#86efac' : '#8a8a8a'} fontSize="9" fontWeight="700" textAnchor="middle">{p.label}</text>
          {p.q.over != null && <><circle cx={gx} cy={chart.py(p.q.over)} r="3" fill="#f87171" /><text x={gx+4} y={chart.py(p.q.over)-4} fill="#fecaca" fontSize="10" fontWeight="700">{fmt(p.q.over)}</text></>}
          {p.q.under != null && <><circle cx={gx} cy={chart.py(p.q.under)} r="3" fill="#60a5fa" /><text x={gx+4} y={chart.py(p.q.under)+12} fill="#bfdbfe" fontSize="10" fontWeight="700">{fmt(p.q.under)}</text></>}
        </g>; })}
        <text x={chart.left} y={chart.h-7} fill="#777" fontSize="10">0′</text><text x={chart.px(45)-9} y={chart.h-7} fill="#777" fontSize="10">45′</text><text x={chart.w-chart.right-19} y={chart.h-7} fill="#777" fontSize="10">90′</text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#888]"><span><i className="inline-block h-0.5 w-4 bg-[#f87171] align-middle" /> Tài</span><span><i className="inline-block h-0.5 w-4 bg-[#60a5fa] align-middle" /> Xỉu</span><span><i className="inline-block h-3 w-1 bg-[#f59e0b]/70 align-middle" /> Khoá</span><span>⚽ Bàn thắng</span></div>
    </div>
    <div className="mt-4"><div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#777]">Mốc theo thời gian trận</div><div className="space-y-1.5">{events.map((e, i) => <div key={`${e.at}-${i}`} className="flex gap-2 text-[11px]"><span className="w-9 shrink-0 font-mono text-[#666]">{Math.round(e.x)}′</span><span className={e.kind === 'goal' ? 'text-[#86efac]' : e.kind === 'lock' ? 'text-[#fbbf24]' : e.kind === 'open' ? 'text-[#67e8f9]' : 'text-[#bbb]'}>{e.text}</span></div>)}</div></div>
  </div>;
}
