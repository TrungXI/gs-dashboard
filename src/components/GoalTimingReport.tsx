'use client';

import { useEffect, useRef, useState } from 'react';
import type { GoalTimingResponse, LeagueStat, GoalTimingWindow } from '../app/api/gs-goal-timing/route';

const T = {
  ground:  '#07101A',
  surface: '#0F1E2E',
  border:  '#162A3F',
  text:    '#C8D6E5',
  muted:   '#4A6175',
  dim:     '#263D52',
  h1:      '#F5C842',
  h2:      '#3BCFB4',
} as const;

const MONO: React.CSSProperties = { fontFamily: "'SF Mono','Fira Code',ui-monospace,monospace" };
const MAX_PCT = 25;
const CHART_H = 190;
const Y_STEPS = [20, 15, 10, 5];

function fmt(iso: string) {
  try { return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

// H2 windows từ API là "46–50", "51–55"... → hiển thị "1–5", "6–10"...
function h2Label(w: string): string {
  return w.replace(/(\d+)–(\d+)/, (_, a, b) => `${+a - 45}–${+b - 45}`);
}

// ── Bar ──────────────────────────────────────────────────────────────────────
function Bar({ d, animated }: { d: GoalTimingWindow; animated: boolean }) {
  const [hov, setHov] = useState(false);
  const isPeak = d.pct >= 18;
  const color = d.half === 1 ? T.h1 : T.h2;
  const glow = d.half === 1 ? 'rgba(245,200,66,0.22)' : 'rgba(59,207,180,0.22)';
  const heightPx = animated ? (d.pct / MAX_PCT) * CHART_H : 0;

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: CHART_H, position: 'relative', cursor: 'default' }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {hov && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          background: '#1A2D40', border: `1px solid ${T.border}`,
          borderRadius: 5, padding: '5px 8px', ...MONO,
          fontSize: 10, color: T.text, whiteSpace: 'nowrap', zIndex: 20, lineHeight: 1.6,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color, display: 'block' }}>{d.pct}%</span>
          {d.matchesScored}/{d.totalMatches} · {d.goals} bàn · {d.half === 2 ? h2Label(d.window) : d.window}&apos;
        </div>
      )}
      <div style={{
        width: '100%', borderRadius: '2px 2px 0 0',
        height: heightPx,
        transition: animated ? 'height 0.65s cubic-bezier(0.22,1,0.36,1)' : 'none',
        background: `linear-gradient(180deg,${color} 0%,${color}80 100%)`,
        boxShadow: isPeak ? `0 -4px 14px ${glow}` : 'none',
        filter: hov ? 'brightness(1.25)' : 'none',
      }} />
    </div>
  );
}

// ── Chart for one league ──────────────────────────────────────────────────────
function LeagueChart({ lg, animated }: { lg: LeagueStat; animated: boolean }) {
  const [src, setSrc] = useState<'ticks' | 'oddslog'>('ticks');
  const activeWindows = src === 'ticks' ? lg.windows : lg.windowsOddslog;
  const h1 = activeWindows.filter((w) => w.half === 1);
  const h2 = activeWindows.filter((w) => w.half === 2);
  const peakH1 = h1.reduce<GoalTimingWindow | null>((a, b) => (!a || b.pct > a.pct ? b : a), null);
  const peakH2 = h2.reduce<GoalTimingWindow | null>((a, b) => (!a || b.pct > a.pct ? b : a), null);
  const lowH1  = h1.reduce<GoalTimingWindow | null>((a, b) => (!a || b.pct < a.pct ? b : a), null);
  const lowH2  = h2.reduce<GoalTimingWindow | null>((a, b) => (!a || b.pct < a.pct ? b : a), null);

  const HtDivider = () => (
    <div style={{ flexShrink: 0, width: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4, position: 'relative' }}>
      <div style={{
        position: 'absolute', top: 0, bottom: 28, left: '50%', width: 1,
        background: 'repeating-linear-gradient(180deg,#1A4A2C 0px,#1A4A2C 4px,#0E2E1A 4px,#0E2E1A 8px)',
        opacity: 0.7,
      }} />
      <div style={{ ...MONO, fontSize: 8, fontWeight: 700, color: '#2A7A48', background: T.surface, padding: '1px 2px', borderRadius: 2, border: '1px solid #1A4A2C', position: 'relative', zIndex: 1 }}>HT</div>
    </div>
  );

  return (
    <div>
      {/* Data source info + toggle */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 12 }}>
        {([
          { key: 'ticks' as const,   label: 'gs_16p_ticks',      n: lg.ticksMatches,   color: '#3BCFB4' },
          { key: 'oddslog' as const, label: 'match_odds_log',    n: lg.oddslogMatches, color: '#F5C842' },
          { key: null,               label: 'gs_matches_history', n: lg.totalMatches,   color: '#7B8FA1' },
        ] as const).map(({ key, label, n, color }) => {
          const isActive = key === src;
          const isClickable = key !== null;
          return (
            <div
              key={label}
              onClick={() => isClickable && setSrc(key)}
              style={{
                background: isActive ? `${color}12` : T.surface,
                border: `1px solid ${isActive ? color : T.border}`,
                borderRadius: 6, padding: '8px 10px',
                display: 'flex', flexDirection: 'column', gap: 3,
                cursor: isClickable ? 'pointer' : 'default',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <div style={{ ...MONO, fontSize: 9, color: isActive ? color : T.muted, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 4 }}>
                {label}
                {isActive && <span style={{ background: color, color: '#07101A', fontSize: 7, fontWeight: 700, padding: '1px 4px', borderRadius: 3, letterSpacing: '0.05em' }}>CHART</span>}
              </div>
              <div style={{ ...MONO, fontSize: 17, fontWeight: 700, color: isActive ? color : T.muted, lineHeight: 1 }}>
                {n.toLocaleString()}
                <span style={{ fontSize: 10, fontWeight: 400, color: T.muted, marginLeft: 4 }}>trận</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: T.border, border: `1px solid ${T.border}`, borderRadius: 7, overflow: 'hidden', marginBottom: 16 }}>
        {[
          { v: String(lg.avgGoals), u: 'bàn', l: 'TB / trận', c: T.text },
          { v: String(lg.totalMatches), u: '', l: 'Trận (history)', c: T.text },
          { v: String(lg.avgH1), u: 'H1', l: 'Hiệp 1 TB', c: T.h1 },
          { v: String(lg.avgH2), u: 'H2', l: 'Hiệp 2 TB', c: T.h2 },
        ].map(({ v, u, l, c }) => (
          <div key={l} style={{ background: T.surface, padding: '13px 16px', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ ...MONO, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, color: c }}>
              {v}{u && <span style={{ fontSize: 13, fontWeight: 400, color: T.muted }}> {u}</span>}
            </div>
            <div style={{ fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{
        display: 'flex', alignItems: 'flex-end',
        border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden',
        backgroundImage: `repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(255,255,255,0.007) 3px,rgba(255,255,255,0.007) 4px),linear-gradient(180deg,${T.surface} 0%,#0C1929 100%)`,
      }}>
        {/* Y-axis */}
        <div style={{ flexShrink: 0, width: 34, padding: '14px 0 28px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', borderRight: `1px solid ${T.border}` }}>
          {[MAX_PCT, ...Y_STEPS, 0].map((v) => (
            <div key={v} style={{ ...MONO, fontSize: 8, color: T.dim, paddingRight: 6, lineHeight: 1 }}>{v}%</div>
          ))}
        </div>

        {/* Bars area */}
        <div style={{ flex: 1, padding: '14px 12px 0', position: 'relative', overflow: 'hidden' }}>
          {/* Gridlines */}
          {[...Y_STEPS, 0].map((v) => (
            <div key={v} style={{
              position: 'absolute', left: 12, right: 12,
              bottom: `calc(28px + ${(v / MAX_PCT) * CHART_H}px)`,
              height: 1, background: T.border, opacity: 0.55,
            }} />
          ))}

          {/* Bars row */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, flex: 1 }}>
              {h1.map((d) => <Bar key={d.window} d={d} animated={animated} />)}
            </div>
            <HtDivider />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, flex: 1 }}>
              {h2.map((d) => <Bar key={d.window} d={d} animated={animated} />)}
            </div>
          </div>

          {/* X labels */}
          <div style={{ display: 'flex', height: 28, alignItems: 'center' }}>
            <div style={{ flex: 1, display: 'flex', gap: 2 }}>
              {h1.map((d) => (
                <div key={d.window} style={{ flex: 1, ...MONO, fontSize: 7, color: T.dim, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>{d.window}&apos;</div>
              ))}
            </div>
            <div style={{ width: 20 }} />
            <div style={{ flex: 1, display: 'flex', gap: 2 }}>
              {h2.map((d) => (
                <div key={d.window} style={{ flex: 1, ...MONO, fontSize: 7, color: T.dim, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>{h2Label(d.window)}&apos;</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Half labels */}
      <div style={{ display: 'flex', padding: '6px 46px 0', gap: 0 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, ...MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', color: `${T.h1}C0` }}>
          H1 <div style={{ flex: 1, height: 1, background: T.h1, opacity: 0.25 }} /> 1–45&apos;
        </div>
        <div style={{ width: 20 }} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, ...MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', color: `${T.h2}C0`, justifyContent: 'flex-end' }}>
          46–90&apos; <div style={{ flex: 1, height: 1, background: T.h2, opacity: 0.25 }} /> H2
        </div>
      </div>

      {/* Insight cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
        {peakH1 && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderTop: `2px solid ${T.h1}`, borderRadius: 7, padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ ...MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted }}>Đỉnh H1</div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, color: T.h1 }}>
              {h1.filter((w) => w.pct === peakH1.pct).map((w) => w.window).join(' & ')}&apos;
              <span style={{ fontSize: 13, marginLeft: 6, opacity: 0.8 }}>{peakH1.pct}%</span>
            </div>
            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
              Tĩnh nhất: <strong style={{ color: T.text }}>{lowH1?.window}&apos;</strong> ({lowH1?.pct}%)
            </div>
          </div>
        )}
        {peakH2 && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderTop: `2px solid ${T.h2}`, borderRadius: 7, padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ ...MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted }}>Đỉnh H2</div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, color: T.h2 }}>
              {h2Label(peakH2.window)}&apos;
              <span style={{ fontSize: 13, marginLeft: 6, opacity: 0.8 }}>{peakH2.pct}%</span>
            </div>
            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
              Tĩnh nhất: <strong style={{ color: T.text }}>{lowH2 ? h2Label(lowH2.window) : '—'}&apos;</strong> ({lowH2?.pct}%)
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function GoalTimingReport() {
  const [data, setData] = useState<GoalTimingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [animated, setAnimated] = useState(false);
  const animDone = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/gs-goal-timing', { cache: 'no-store' })
      .then(async (r) => {
        if (!(r.headers.get('content-type') ?? '').includes('json')) throw new Error('Server đang khởi động, thử lại');
        const d = await r.json() as GoalTimingResponse;
        if (!d.ok) throw new Error(d.error ?? 'Lỗi API');
        return d;
      })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
        if (!animDone.current) {
          animDone.current = true;
          requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
        }
      })
      .catch((e) => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  // Re-animate when switching tabs
  const prevTab = useRef(tab);
  useEffect(() => {
    if (prevTab.current !== tab) {
      prevTab.current = tab;
      setAnimated(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
    }
  }, [tab]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 320, color: T.muted, ...MONO, fontSize: 13 }}>
      Đang tính toán...
    </div>
  );

  if (error || !data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 320, color: '#f87171', ...MONO, fontSize: 13 }}>
      {error ?? 'Không tải được dữ liệu'}
    </div>
  );

  const current = data.leagues[tab];

  return (
    <div style={{ padding: '24px 20px 48px', maxWidth: 880, margin: '0 auto', color: T.text, fontFamily: 'system-ui,-apple-system,sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 'clamp(19px,3.5vw,28px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 4 }}>
          Bàn thắng nổ vào phút nào?
        </h1>
        <p style={{ ...MONO, fontSize: 11, color: T.muted }}>
          Tỉ lệ % trận có bàn thắng theo khung 5 phút · cache 2h
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 4 }}>
        {data.leagues.map((lg, i) => (
          <button
            key={lg.matchType}
            onClick={() => setTab(i)}
            style={{
              flex: 1, padding: '8px 4px', borderRadius: 5, border: 'none', cursor: 'pointer',
              ...MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
              transition: 'background 0.15s, color 0.15s',
              background: tab === i ? T.border : 'transparent',
              color: tab === i ? T.text : T.muted,
            }}
          >
            {lg.label}
          </button>
        ))}
      </div>

      {/* League chart */}
      <LeagueChart key={tab} lg={current} animated={animated} />

      {/* Legend + footnote */}
      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          {[['Hiệp 1', T.h1], ['Hiệp 2', T.h2]].map(([label, color]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, ...MONO, fontSize: 10, color: T.muted }}>
              <div style={{ width: 7, height: 7, borderRadius: 1, background: color, flexShrink: 0 }} /> {label}
            </div>
          ))}
        </div>
        <div style={{ ...MONO, fontSize: 9, color: T.dim }}>
          16p_ticks ({current.ticksMatches}) · odds_log ({current.oddslogMatches}) · history ({current.totalMatches}) · {fmt(data.cachedAt)}
        </div>
      </div>
    </div>
  );
}
