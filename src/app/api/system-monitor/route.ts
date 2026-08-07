import { NextResponse } from 'next/server';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pool tái dùng (module-level) — chỉ health-check nhẹ.
let _pool: Pool | null = null;
function pool(): Pool | null {
  const url = process.env.ANALYSIS_DATABASE_URL;
  if (!url) return null;
  if (!_pool) _pool = new Pool({ connectionString: url, max: 2 });
  return _pool;
}

// Process tắt CÓ CHỦ ĐÍCH (hệ HT predict đã nghỉ) — không tính warning.
const IGNORED_PROCS = new Set(['gs-capture', 'gs-settle', 'gs-calibrate']);

type Level = 'ok' | 'warn' | 'crit';
const pick = (v: number, warn: number, crit: number): Level => (v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok');

function readProc(path: string): string { try { return fs.readFileSync(path, 'utf8'); } catch { return ''; } }
function sh(cmd: string): string { try { return execSync(cmd, { timeout: 6000, encoding: 'utf8' }); } catch { return ''; } }

function cpuInfo() {
  const cores = (readProc('/proc/cpuinfo').match(/^processor/gm) || []).length || 1;
  const la = readProc('/proc/loadavg').trim().split(/\s+/);
  const load1 = Number(la[0] || 0), load5 = Number(la[1] || 0), load15 = Number(la[2] || 0);
  const pctPerCore = cores ? (load1 / cores) * 100 : 0;
  return { cores, load1, load5, load15, pctPerCore: +pctPerCore.toFixed(0), level: pick(pctPerCore, 80, 120) };
}

function memInfo() {
  const m = readProc('/proc/meminfo');
  const g = (k: string) => Number((m.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1] || 0); // kB
  const total = g('MemTotal'), avail = g('MemAvailable');
  const used = total - avail;
  const pct = total ? (used / total) * 100 : 0;
  const swapTotal = g('SwapTotal'), swapFree = g('SwapFree');
  const swapUsed = swapTotal - swapFree;
  const swapPct = swapTotal ? (swapUsed / swapTotal) * 100 : 0;
  return {
    totalMB: Math.round(total / 1024), usedMB: Math.round(used / 1024), availMB: Math.round(avail / 1024),
    pct: +pct.toFixed(0), level: pick(pct, 82, 92),
    swapUsedMB: Math.round(swapUsed / 1024), swapTotalMB: Math.round(swapTotal / 1024), swapPct: +swapPct.toFixed(0),
  };
}

function diskInfo() {
  const out = sh('df -B1 --output=size,used,avail,pcent / | tail -1').trim().split(/\s+/);
  const size = Number(out[0] || 0), used = Number(out[1] || 0), avail = Number(out[2] || 0);
  const pct = Number((out[3] || '0').replace('%', ''));
  const gb = (b: number) => +(b / 1e9).toFixed(1);
  return { totalGB: gb(size), usedGB: gb(used), availGB: gb(avail), pct, level: pick(pct, 80, 90) };
}

function uptimeInfo() {
  const s = Number((readProc('/proc/uptime').trim().split(/\s+/)[0]) || 0);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return { seconds: s, label: `${d}d ${h}h ${m}m` };
}

function pm2Info() {
  const raw = sh('pm2 jlist 2>/dev/null');
  let list: unknown[] = [];
  try { list = JSON.parse(raw); } catch { /* pm2 not json */ }
  const procs = (list as Record<string, unknown>[]).map((p) => {
    const e = (p.pm2_env || {}) as Record<string, unknown>;
    const monit = (p.monit || {}) as Record<string, number>;
    return {
      name: p.name as string,
      status: (e.status as string) || '?',
      cpu: monit.cpu ?? 0,
      memMB: Math.round((monit.memory ?? 0) / 1e6),
      restarts: (e.restart_time as number) ?? 0,
      uptime: (e.pm_uptime as number) ?? 0,
      ignored: IGNORED_PROCS.has(p.name as string),
    };
  });
  // Con "tắt chủ đích" xuống cuối bảng.
  return procs.sort((a, b) => (a.ignored === b.ignored ? a.name.localeCompare(b.name) : a.ignored ? 1 : -1));
}

function errorLogs() {
  // tail dòng lỗi gần đây từ pm2 error logs + heartbeat (FAIL/ERR)
  const out = sh(`for f in /root/.pm2/logs/*-error.log; do tail -n 40 "$f" 2>/dev/null | grep -aiE "error|err |fail|exception|econn|timeout|throw" | sed "s#^#$(basename $f .-error.log): #"; done | tail -40`);
  const hb = sh(`for f in /opt/gs-collector/tx-paper/heartbeat-*.log; do tail -n 30 "$f" 2>/dev/null | grep -aiE "FAIL|ERR" | sed "s#^#$(basename $f .log): #"; done | tail -20`);
  const lines = (out + '\n' + hb).split('\n').map((l) => l.trim()).filter(Boolean);
  // Mới nhất LÊN ĐẦU: sort giảm dần theo timestamp ISO nhúng trong dòng.
  // Dòng không có timestamp (vd log pm2 thô) giữ nguyên thứ tự, xếp xuống dưới.
  const tsOf = (l: string) => { const m = l.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/); return m ? Date.parse(m[0]) : NaN; };
  const withTs = lines.filter((l) => !Number.isNaN(tsOf(l))).sort((a, b) => tsOf(b) - tsOf(a));
  const noTs = lines.filter((l) => Number.isNaN(tsOf(l)));
  return [...withTs, ...noTs].slice(0, 60);
}

async function dbInfo() {
  const p = pool();
  if (!p) return { ok: false, error: 'no DB url' };
  try {
    const r = await p.query(
      `SELECT (SELECT max(recorded_at) FROM match_odds_log) AS last_odds,
              (SELECT count(*) FROM match_odds_log WHERE recorded_at > now() - interval '10 minutes') AS odds_10m,
              (SELECT count(*) FROM gs_tx_paper WHERE result IS NULL) AS pending_bets,
              (SELECT count(DISTINCT calc_version) FROM gs_tx_paper) AS bot_versions`);
    const row = r.rows[0];
    const ageSec = row.last_odds ? Math.round((Date.now() - new Date(row.last_odds).getTime()) / 1000) : null;
    return {
      ok: true,
      lastOddsAgeSec: ageSec,
      odds10m: Number(row.odds_10m),
      pendingBets: Number(row.pending_bets),
      botVersions: Number(row.bot_versions),
      level: (ageSec == null || ageSec > 600) ? 'warn' as Level : 'ok' as Level,
    };
  } catch (e) { return { ok: false, error: String(e) }; }
}

// Trạng thái THU THẬP DATA — logic giống gs-data-watchdog: đỏ CHỈ khi có trận GS live
// mà match_odds_log ngừng ghi. Đếm trận live đọc từ feed local (:8899, đã cache — rẻ).
const STALE_SEC = 1800; // 30 phút (odds ghi theo mốc snapshot, thưa — tránh báo nhầm)
async function collectionInfo(dbAgeSec: number | null) {
  let liveGS: number | null = null;
  try {
    const r = await fetch('http://127.0.0.1:8899/api/gs-live', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { ok: boolean; matches?: { isLive?: boolean }[] };
    if (j.ok) liveGS = (j.matches || []).filter((m) => m.isLive === true).length;
  } catch { /* feed lỗi → không kết luận */ }
  const broken = liveGS != null && liveGS > 0 && dbAgeSec != null && dbAgeSec > STALE_SEC;
  return { liveGS, ageSec: dbAgeSec, staleSec: STALE_SEC, broken, level: (broken ? 'crit' : 'ok') as Level };
}

// Trạng thái backup Supabase — đọc log cron (không query remote mỗi 4s).
const BACKUP_LOG = '/opt/gs-collector/tx-paper/supabase-backup.log';
function backupInfo() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(BACKUP_LOG).mtimeMs; } catch { return { ok: false as const }; }
  const done = readProc(BACKUP_LOG).split('\n').filter((l) => l.includes('DONE'));
  const last = done[done.length - 1] || '';
  const m = last.match(/local=(\d+)\s+supabase=(\d+)/);
  const local = m ? Number(m[1]) : null;
  const supabase = m ? Number(m[2]) : null;
  const match = local != null && local === supabase;
  const ageHours = +((Date.now() - mtimeMs) / 3.6e6).toFixed(1);
  const level: Level = (!match || ageHours > 26) ? 'warn' : 'ok';
  return { ok: true as const, local, supabase, match, ageHours, level };
}

export async function GET() {
  const cpu = cpuInfo();
  const mem = memInfo();
  const disk = diskInfo();
  const uptime = uptimeInfo();
  const pm2 = pm2Info();
  const logs = errorLogs();
  const db = await dbInfo();
  const collection = await collectionInfo(db.ok ? (db.lastOddsAgeSec ?? null) : null);
  const backup = backupInfo();

  // ── Tự phân tích (audit) ───────────────────────────────────────────────
  const issues: { level: Level; msg: string }[] = [];
  if (cpu.level !== 'ok') issues.push({ level: cpu.level, msg: `CPU load ${cpu.load1} (${cpu.pctPerCore}%/core, ${cpu.cores} core)` });
  if (mem.level !== 'ok') issues.push({ level: mem.level, msg: `RAM ${mem.pct}% (${mem.usedMB}/${mem.totalMB}MB, còn ${mem.availMB}MB)` });
  if (mem.swapPct >= 50) issues.push({ level: 'warn', msg: `Swap dùng ${mem.swapPct}% (${mem.swapUsedMB}MB) — RAM căng` });
  if (disk.level !== 'ok') issues.push({ level: disk.level, msg: `Disk ${disk.pct}% (còn ${disk.availGB}GB)` });
  const stopped = pm2.filter((p) => p.status !== 'online' && !p.ignored);
  if (stopped.length) issues.push({ level: 'warn', msg: `${stopped.length} process không online: ${stopped.map((p) => p.name).join(', ')}` });
  const flapping = pm2.filter((p) => p.status === 'online' && p.restarts >= 15);
  if (flapping.length) issues.push({ level: 'warn', msg: `Restart nhiều: ${flapping.map((p) => `${p.name}(${p.restarts})`).join(', ')}` });
  if (collection.broken) issues.push({ level: 'crit', msg: `NGỪNG THU THẬP: ${collection.liveGS} trận GS live nhưng match_odds_log ${Math.round((collection.ageSec ?? 0) / 60)} phút chưa ghi → kiểm tra collector / /settoken` });
  if (backup.ok && backup.level === 'warn') issues.push({ level: 'warn', msg: !backup.match ? `Backup Supabase LỆCH: local ${backup.local} ≠ supabase ${backup.supabase}` : `Backup Supabase quá hạn (${backup.ageHours}h chưa chạy)` });
  if (!issues.length) issues.push({ level: 'ok', msg: 'Hệ thống ổn định — không phát hiện vấn đề.' });

  const overall: Level = issues.some((i) => i.level === 'crit') ? 'crit'
    : issues.some((i) => i.level === 'warn') ? 'warn' : 'ok';

  return NextResponse.json({
    ok: true, ts: Date.now(), overall,
    cpu, mem, disk, uptime, pm2, db, collection, backup, logs, issues,
  });
}
