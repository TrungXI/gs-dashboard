'use client';

import { useEffect, useRef, useState } from 'react';

type Level = 'ok' | 'warn' | 'crit';
interface Proc { name: string; status: string; cpu: number; memMB: number; restarts: number; uptime: number; }
interface Mon {
  ok: boolean; ts: number; overall: Level;
  cpu: { cores: number; load1: number; load5: number; load15: number; pctPerCore: number; level: Level };
  mem: { totalMB: number; usedMB: number; availMB: number; pct: number; level: Level; swapUsedMB: number; swapTotalMB: number; swapPct: number };
  disk: { totalGB: number; usedGB: number; availGB: number; pct: number; level: Level };
  uptime: { label: string };
  pm2: Proc[];
  db: { ok: boolean; lastOddsAgeSec?: number | null; odds10m?: number; pendingBets?: number; botVersions?: number; level?: Level; error?: string };
  collection: { liveGS: number | null; ageSec: number | null; staleSec: number; broken: boolean; level: Level };
  backup: { ok: boolean; local?: number | null; supabase?: number | null; match?: boolean; ageHours?: number; level?: Level };
  logs: string[];
  issues: { level: Level; msg: string }[];
}

const LC: Record<Level, string> = { ok: '#4ade80', warn: '#fbbf24', crit: '#f87171' };
const LBG: Record<Level, string> = { ok: 'rgba(74,222,128,.12)', warn: 'rgba(251,191,36,.12)', crit: 'rgba(248,113,113,.12)' };

function Bar({ pct, level }: { pct: number; level: Level }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[.06]">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: LC[level] }} />
    </div>
  );
}

function Spark({ data, color }: { data: number[]; color: string }) {
  const W = 220, H = 40, n = data.length;
  if (n < 2) return <svg width={W} height={H} />;
  const max = Math.max(100, ...data), min = 0;
  const pts = data.map((v, i) => `${(i / (n - 1)) * W},${H - ((v - min) / (max - min)) * H}`).join(' ');
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Card({ title, value, sub, pct, level, hist, histColor }: {
  title: string; value: string; sub?: string; pct?: number; level: Level; hist?: number[]; histColor?: string;
}) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: LC[level] + '55', background: LBG[level] }}>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-[#9ca3af]">{title}</span>
        <span className="text-lg font-bold tabular-nums" style={{ color: LC[level] }}>{value}</span>
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-[#777] tabular-nums">{sub}</div>}
      {pct != null && <div className="mt-2"><Bar pct={pct} level={level} /></div>}
      {hist && hist.length > 1 && <div className="mt-1"><Spark data={hist} color={histColor || LC[level]} /></div>}
    </div>
  );
}

const HMAX = 60; // giữ 60 điểm gần nhất (~4 phút @4s)

export default function SystemMonitor() {
  const [m, setM] = useState<Mon | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cpuH = useRef<number[]>([]);
  const memH = useRef<number[]>([]);
  const [, force] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/system-monitor', { cache: 'no-store' });
        const j = (await r.json()) as Mon & { error?: string };
        if (!alive) return;
        if (!j.ok) { setErr(j.error || 'lỗi'); return; }
        setErr(null); setM(j);
        cpuH.current = [...cpuH.current, j.cpu.pctPerCore].slice(-HMAX);
        memH.current = [...memH.current, j.mem.pct].slice(-HMAX);
        force((x) => x + 1);
      } catch (e) { if (alive) setErr(String(e)); }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (err && !m) return <div className="p-6 text-[#f87171]">Lỗi tải monitor: {err}</div>;
  if (!m) return <div className="flex h-40 items-center justify-center text-[#888]">Đang tải hệ thống…</div>;

  const overallLabel = m.overall === 'ok' ? '🟢 Ổn định' : m.overall === 'warn' ? '🟡 Cần chú ý' : '🔴 Cảnh báo';

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white">🖥️ Monitor hệ thống VPS</h1>
        <span className="rounded-full px-3 py-1 text-[13px] font-semibold" style={{ color: LC[m.overall], background: LBG[m.overall] }}>{overallLabel}</span>
        <span className="ml-auto text-[11px] text-[#666]">uptime {m.uptime.label} · refresh 4s</span>
      </div>

      {/* Thu thập data — logic đồng bộ với watchdog (đỏ = watchdog cũng đang bắn Telegram) */}
      {(() => {
        const c = m.collection;
        const age = c.ageSec;
        const ageStr = age == null ? '?' : age < 90 ? `${age}s` : `${Math.round(age / 60)} phút`;
        const lvl: Level = c.broken ? 'crit' : 'ok';
        const status = c.broken ? '🔴 NGỪNG THU THẬP' : '🟢 Bình thường';
        const sub = c.broken
          ? `Đang có ${c.liveGS} trận GS live nhưng match_odds_log ${ageStr} chưa ghi`
          : (c.liveGS ?? 0) === 0
            ? `Không có trận GS live (nghỉ) · match_odds_log ghi cuối ${ageStr} trước`
            : `Trận GS live: ${c.liveGS} · match_odds_log ghi cuối ${ageStr} trước`;
        return (
          <div className="rounded-xl border p-3" style={{ borderColor: LC[lvl] + '66', background: LBG[lvl] }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-semibold text-white">📡 Thu thập data</span>
              <span className="text-[14px] font-bold" style={{ color: LC[lvl] }}>{status}</span>
            </div>
            <div className="mt-1 text-[12px] text-white/80">{sub}</div>
            {c.broken && <div className="mt-1 text-[12px] font-medium" style={{ color: LC.crit }}>→ Kiểm tra collector (gs-collector) / gõ /settoken @GS_HD_bot</div>}
          </div>
        );
      })()}

      {/* Metric cards + chart */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card title="CPU load" value={`${m.cpu.pctPerCore}%`} sub={`load ${m.cpu.load1} / ${m.cpu.load5} / ${m.cpu.load15} · ${m.cpu.cores} core`} pct={m.cpu.pctPerCore} level={m.cpu.level} hist={cpuH.current} histColor="#38bdf8" />
        <Card title="RAM" value={`${m.mem.pct}%`} sub={`${m.mem.usedMB} / ${m.mem.totalMB} MB · còn ${m.mem.availMB}`} pct={m.mem.pct} level={m.mem.level} hist={memH.current} histColor="#c084fc" />
        <Card title="Disk /" value={`${m.disk.pct}%`} sub={`${m.disk.usedGB} / ${m.disk.totalGB} GB · còn ${m.disk.availGB}`} pct={m.disk.pct} level={m.disk.level} />
        <Card title="Swap" value={`${m.mem.swapPct}%`} sub={`${m.mem.swapUsedMB} / ${m.mem.swapTotalMB} MB`} pct={m.mem.swapPct} level={m.mem.swapPct >= 50 ? 'warn' : 'ok'} />
      </div>

      {/* Audit tự phân tích */}
      <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-3">
        <div className="mb-2 text-[13px] font-semibold text-[#fbbf24]">🔎 Tự phân tích</div>
        <div className="flex flex-col gap-1.5">
          {m.issues.map((it, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px]" style={{ color: LC[it.level] }}>
              <span>{it.level === 'ok' ? '✓' : it.level === 'warn' ? '⚠️' : '🔴'}</span>
              <span className="text-white/90">{it.msg}</span>
            </div>
          ))}
        </div>
      </div>

      {/* DB health */}
      <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-3">
        <div className="mb-2 text-[13px] font-semibold text-[#38bdf8]">🗄️ Database (gs_db)</div>
        {m.db.ok ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-white/85 tabular-nums">
            <span>match_odds_log ghi cuối: <b style={{ color: (m.db.lastOddsAgeSec ?? 999) > 600 ? LC.warn : LC.ok }}>{m.db.lastOddsAgeSec ?? '?'}s trước</b></span>
            <span>odds 10m: <b>{m.db.odds10m}</b></span>
            <span>kèo pending: <b>{m.db.pendingBets}</b></span>
            <span>bot versions: <b>{m.db.botVersions}</b></span>
          </div>
        ) : <div className="text-[13px] text-[#f87171]">DB lỗi: {m.db.error}</div>}
      </div>

      {/* Backup Supabase */}
      {(() => {
        const b = m.backup;
        if (!b.ok) {
          return (
            <div className="rounded-xl border p-3" style={{ borderColor: LC.warn + '66', background: LBG.warn }}>
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-white">📦 Backup Supabase</span>
                <span className="text-[14px] font-bold" style={{ color: LC.warn }}>🟡 Chưa có log</span>
              </div>
              <div className="mt-1 text-[12px] text-white/70">Chưa chạy backup lần nào (cron 3h sáng hằng đêm)</div>
            </div>
          );
        }
        const lvl: Level = b.level ?? 'ok';
        const status = !b.match ? '🔴 LỆCH số liệu' : (b.ageHours ?? 0) > 26 ? '🟡 Quá hạn' : '🟢 OK';
        return (
          <div className="rounded-xl border p-3" style={{ borderColor: LC[lvl] + '66', background: LBG[lvl] }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-semibold text-white">📦 Backup Supabase</span>
              <span className="text-[14px] font-bold" style={{ color: LC[lvl] }}>{status}</span>
            </div>
            <div className="mt-1 text-[12px] text-white/80 tabular-nums">
              Lần cuối: <b>{b.ageHours}h trước</b> · match_odds_log local <b>{b.local}</b> {b.match ? '=' : '≠'} supabase <b>{b.supabase}</b>
            </div>
            {!b.match && <div className="mt-1 text-[12px] font-medium" style={{ color: LC.crit }}>→ Số liệu lệch — xem log supabase-backup.log</div>}
          </div>
        );
      })()}

      {/* pm2 process table */}
      <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-3">
        <div className="mb-2 text-[13px] font-semibold text-white">⚙️ Process (pm2) — {m.pm2.filter((p) => p.status === 'online').length}/{m.pm2.length} online</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] tabular-nums">
            <thead><tr className="text-left text-[#777]">
              <th className="py-1 pr-2 font-medium">Name</th><th className="px-2 font-medium">Status</th>
              <th className="px-2 font-medium">CPU</th><th className="px-2 font-medium">RAM</th><th className="px-2 font-medium">Restarts</th>
            </tr></thead>
            <tbody>
              {m.pm2.map((p) => (
                <tr key={p.name} className="border-t border-[#222]">
                  <td className="py-1 pr-2 text-white/90">{p.name}</td>
                  <td className="px-2"><span style={{ color: p.status === 'online' ? LC.ok : LC.warn }}>{p.status === 'online' ? '● online' : `○ ${p.status}`}</span></td>
                  <td className="px-2 text-white/70">{p.cpu}%</td>
                  <td className="px-2 text-white/70">{p.memMB}MB</td>
                  <td className="px-2" style={{ color: p.restarts >= 15 ? LC.warn : '#777' }}>{p.restarts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Error logs */}
      <div className="rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] p-3">
        <div className="mb-2 text-[13px] font-semibold text-[#f87171]">🐞 Log lỗi gần đây ({m.logs.length})</div>
        {m.logs.length === 0 ? (
          <div className="text-[13px] text-[#4ade80]">Không có lỗi gần đây ✓</div>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-[#f0a0a0]">
            {m.logs.map((l, i) => <div key={i} className="whitespace-pre-wrap break-all">{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
