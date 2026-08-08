'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Row { pair: string; n: number; avgLine: number; xiuRoi: number; xiuWr: number; taiRoi: number; taiWr: number }
interface Data { ok: boolean; updatedAt?: string; total?: number; minN?: number; minRoi?: number; whitelist?: Row[]; blacklist?: Row[]; gray?: Row[] }

const FILTERS: [string, string][] = [['7', '7 ngày'], ['14', '14 ngày'], ['21', '21 ngày']];
const pnlColor = (roi: number) => (roi > 0 ? '#4ade80' : roi < 0 ? '#f87171' : '#9ca3af');

export default function FtPairs() {
  const [store, setStore] = useState<Record<string, Data>>({}); // data theo từng mốc 7/14/21
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [curWl, setCurWl] = useState<Set<string>>(new Set());
  const [curBl, setCurBl] = useState<Set<string>>(new Set());
  const [selWl, setSelWl] = useState<Set<string>>(new Set());
  const [selBl, setSelBl] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState<Set<string>>(new Set(['7'])); // filter đang bật; ≥2 → chế độ so sánh

  const loadCurrent = useCallback(async () => {
    const [w, b] = await Promise.all([
      fetch('/api/gs-pair-whitelist', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/gs-pair-blacklist', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ]);
    if (w?.ok) setCurWl(new Set(w.pairs));
    if (b?.ok) setCurBl(new Set(b.pairs));
  }, []);

  // Nạp cả 3 mốc 1 lần (cache DB, nhẹ) → toggle filter chỉ tính lại client, không refetch.
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const entries = await Promise.all(FILTERS.map(async ([v]) => {
          const j: Data = await fetch(`/api/gs-ft-backtest?days=${v}`, { cache: 'no-store' }).then((r) => r.json());
          return [v, j] as const;
        }));
        if (cancel) return;
        const map: Record<string, Data> = {};
        for (const [v, j] of entries) map[v] = j;
        setStore(map);
        await loadCurrent();
      } catch (e) { if (!cancel) setErr(String(e)); }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [loadCurrent]);

  const activeList = useMemo(() => FILTERS.map(([v]) => v).filter((v) => active.has(v)), [active]);
  const compareMode = activeList.length >= 2;

  // Với mỗi cửa: nếu 1 filter → list của filter đó; nếu ≥2 → GIAO các filter (cặp có ở TẤT CẢ).
  // rows trả kèm ROI theo từng filter (perRoi) để hiển thị cột so sánh.
  const build = useCallback((kind: 'wl' | 'bl') => {
    const key = kind === 'wl' ? 'whitelist' : 'blacklist';
    const roiKey = kind === 'wl' ? 'xiuRoi' : 'taiRoi';
    const wrKey = kind === 'wl' ? 'xiuWr' : 'taiWr';
    const lists = activeList.map((v) => ({ v, rows: (store[v]?.[key] ?? []) as Row[] }));
    if (lists.length === 0) return [] as { pair: string; perRoi: Record<string, number>; perWr: Record<string, number>; minRoi: number; n: number }[];
    // đếm cặp xuất hiện ở bao nhiêu filter
    const seen = new Map<string, { perRoi: Record<string, number>; perWr: Record<string, number>; count: number; n: number }>();
    for (const { v, rows } of lists) {
      for (const r of rows) {
        const e = seen.get(r.pair) || { perRoi: {}, perWr: {}, count: 0, n: 0 };
        e.perRoi[v] = r[roiKey]; e.perWr[v] = r[wrKey]; e.count++; e.n = Math.max(e.n, r.n);
        seen.set(r.pair, e);
      }
    }
    const need = lists.length; // giao = phải có ở HẾT filter đang bật
    return [...seen.entries()]
      .filter(([, e]) => e.count === need)
      .map(([pair, e]) => ({ pair, perRoi: e.perRoi, perWr: e.perWr, minRoi: Math.min(...activeList.map((v) => e.perRoi[v] ?? 999)), n: e.n }))
      .sort((a, b) => b.minRoi - a.minRoi);
  }, [activeList, store]);

  const wlRows = useMemo(() => build('wl'), [build]);
  const blRows = useMemo(() => build('bl'), [build]);

  // đổi filter → mặc định tick lại theo list đang hiện
  useEffect(() => {
    setSelWl(new Set(wlRows.map((r) => r.pair)));
    setSelBl(new Set(blRows.map((r) => r.pair)));
  }, [wlRows, blRows]);

  const toggleFilter = (v: string) => {
    const n = new Set(active);
    if (n.has(v)) { if (n.size > 1) n.delete(v); } else n.add(v); // luôn giữ ≥1
    setActive(n);
  };

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, pair: string) => {
    const n = new Set(set); if (n.has(pair)) n.delete(pair); else n.add(pair); setter(n);
  };

  const save = async (kind: 'wl' | 'bl') => {
    const pairs = [...(kind === 'wl' ? selWl : selBl)];
    const label = kind === 'wl' ? 'WHITELIST (4 con Real + Test WL CHỈ đánh Xỉu)' : 'BLACKLIST (V.Bot 17 đánh Tài)';
    if (!window.confirm(`⚠️ TIỀN THẬT — Set ${label} = ${pairs.length} cặp?${compareMode ? '\n(đang ở chế độ SO SÁNH — chỉ set cặp GIAO ' + activeList.join('∩') + ')' : ''}\nÁp ngay cho bot (reload ~5s).`)) return;
    setSaving(true); setMsg(null);
    try {
      const url = kind === 'wl' ? '/api/gs-pair-whitelist' : '/api/gs-pair-blacklist';
      const j = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairs }) }).then((r) => r.json());
      if (j.ok) { setMsg(`✅ Đã set ${kind === 'wl' ? 'whitelist' : 'blacklist'} ${j.pairs.length} cặp — bot đọc ~5s.`); await loadCurrent(); }
      else setMsg(`❌ Lỗi: ${j.error || 'unknown'}`);
    } catch (e) { setMsg(`❌ ${e}`); }
    setSaving(false);
  };

  const copyCmd = (kind: 'wl' | 'bl') => {
    const pairs = [...(kind === 'wl' ? selWl : selBl)];
    const cmd = `${kind === 'wl' ? '/setpairwl' : '/setpairbl'} ${pairs.join(', ') || 'none'}`;
    navigator.clipboard?.writeText(cmd).then(() => setMsg('📋 Đã copy lệnh Telegram'), () => { /* noop */ });
  };

  const Table = ({ kind, rows }: { kind: 'wl' | 'bl'; rows: ReturnType<typeof build> }) => {
    const sel = kind === 'wl' ? selWl : selBl;
    const setter = kind === 'wl' ? setSelWl : setSelBl;
    const cur = kind === 'wl' ? curWl : curBl;
    const accent = kind === 'wl' ? '#34d399' : '#fb7185';
    return (
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-bold" style={{ color: accent }}>
            {kind === 'wl' ? '🟢 WHITELIST — đánh XỈU có lời' : '🔴 BLACKLIST — đánh TÀI có lời'}
            <span className="ml-2 text-[12px] font-normal text-[#888]">
              {compareMode ? `GIAO ${activeList.join('∩')} = ` : ''}{rows.length} cặp · tick {sel.size}
            </span>
          </h3>
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          <button type="button" disabled={saving} onClick={() => save(kind)}
            className="rounded-md border px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-40"
            style={{ borderColor: accent + '66', background: accent + '1a', color: accent }}>
            💾 Set {kind === 'wl' ? 'whitelist' : 'blacklist'} ({sel.size} cặp) → {kind === 'wl' ? '4 con V.Bot 12 Real + Test WL' : 'V.Bot 17 Real + Kiên + Test'}
          </button>
          <button type="button" onClick={() => copyCmd(kind)}
            className="rounded-md border border-[#38bdf8]/40 bg-[#38bdf8]/10 px-3 py-1.5 text-[12px] font-semibold text-[#7dd3fc]">
            📋 Copy lệnh {kind === 'wl' ? '/setpairwl' : '/setpairbl'}
          </button>
        </div>
        <div className="mb-2 select-all break-all rounded-md border border-[#2a2a2a] bg-[#0f0f0f] px-2 py-1.5 font-mono text-[11px] text-[#9ca3af]">
          {kind === 'wl' ? '/setpairwl' : '/setpairbl'} {[...sel].join(', ') || 'none'}
        </div>
        <div className="max-h-[62vh] overflow-y-auto rounded-lg border border-[#2a2a2a]">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-[#1a1a1a] text-[11px] uppercase text-[#888]">
              <tr>
                <th className="px-2 py-2 text-left">
                  <input type="checkbox" title="Chọn / bỏ chọn tất cả"
                    checked={rows.length > 0 && rows.every((r) => sel.has(r.pair))}
                    onChange={() => {
                      const allOn = rows.length > 0 && rows.every((r) => sel.has(r.pair));
                      setter(allOn ? new Set() : new Set(rows.map((r) => r.pair)));
                    }} />
                </th>
                <th className="px-2 py-2 text-left">Cặp</th>
                {activeList.map((v) => (
                  <th key={v} className="px-2 py-2 text-right" title={`ROI ${kind === 'wl' ? 'Xỉu' : 'Tài'} — ${v} ngày`}>ROI {v}d</th>
                ))}
                <th className="px-2 py-2 text-right">n</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = sel.has(r.pair);
                const isCur = cur.has(r.pair);
                return (
                  <tr key={r.pair} className={`border-t border-[#222] ${isCur ? 'bg-white/[.04]' : ''}`}>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={on} onChange={() => toggle(sel, setter, r.pair)} />
                    </td>
                    <td className="px-2 py-1.5 text-white">
                      {r.pair.replace('|', ' vs ')}
                      {isCur && <span className="ml-1.5 rounded bg-[#38bdf8]/20 px-1 text-[10px] text-[#7dd3fc]">đang áp</span>}
                    </td>
                    {activeList.map((v) => {
                      const val = r.perRoi[v];
                      return (
                        <td key={v} className="px-2 py-1.5 text-right tabular-nums font-semibold" style={{ color: val == null ? '#555' : pnlColor(val) }}>
                          {val == null ? '—' : `${val > 0 ? '+' : ''}${val}%`}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#9ca3af]">{r.n}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={activeList.length + 3} className="px-2 py-6 text-center text-[#666]">
                  {compareMode ? `Không cặp nào có mặt ở CẢ ${activeList.join(' + ')} ngày` : 'Chưa đủ data (n≥25)'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden">
      <div className="mb-3 shrink-0">
        <h1 className="text-[20px] font-bold text-white">📈 Cặp Whitelist / Blacklist (backtest FT)</h1>
        <p className="mt-1 text-[12px] leading-snug text-[#9ca3af]">
          Chấm <b>tổng bàn THẬT</b> (gs_matches_history) vs <b>line mở kèo lúc 0-0</b> (odds_log). 🟢 = cặp <b>đánh XỈU có lời</b>, 🔴 = cặp <b>đánh TÀI có lời</b> — lọc theo ROI CHÍNH cửa đó nên <b>không có ROI âm</b>. Cột <b>Line mở</b> = line FT đầu H1 trung bình.
        </p>
        <p className="mt-1 text-[11px] text-[#e5a13a]">⚠️ Line mở phút~0 cao hơn line bot vào phút~9 (~0.25) → ROI/WR hơi lạc quan; thứ hạng cặp thì đúng.</p>
        {/* Multi-select filter: bật ≥2 mốc → SO SÁNH, chỉ hiện cặp có ở TẤT CẢ mốc đang bật (bền vững). */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[#888]">Data (bật ≥2 để so sánh):</span>
          {FILTERS.map(([v, label]) => (
            <button key={v} type="button" onClick={() => toggleFilter(v)} disabled={loading}
              className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold transition disabled:opacity-40 ${active.has(v) ? 'border-[#38bdf8]/60 bg-[#38bdf8]/20 text-[#7dd3fc]' : 'border-[#2a2a2a] bg-[#141414] text-[#9ca3af] hover:bg-white/[.05]'}`}>
              {active.has(v) ? '✓ ' : ''}{label}
            </button>
          ))}
          {compareMode && (
            <span className="ml-1 rounded bg-[#a855f7]/20 px-2 py-0.5 text-[11px] font-semibold text-[#c4b5fd]">
              🔀 SO SÁNH · giao {activeList.join(' ∩ ')} = cặp mốc nào cũng nằm list
            </span>
          )}
        </div>
        {msg && <div className="mt-2 rounded-md border border-[#2a2a2a] bg-[#141414] px-3 py-1.5 text-[12px] text-[#d4d4d4]">{msg}</div>}
      </div>
      {loading ? (
        <div className="flex h-40 items-center justify-center text-[#888]">Đang tải backtest…</div>
      ) : err ? (
        <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[#fca5a5]">{err}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto lg:flex-row">
          <Table kind="wl" rows={wlRows} />
          <Table kind="bl" rows={blRows} />
        </div>
      )}
    </div>
  );
}
