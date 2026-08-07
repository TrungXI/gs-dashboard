'use client';

import { useCallback, useEffect, useState } from 'react';

interface Row { pair: string; n: number; roi: number; wr: number; avgLine: number }
interface Data { ok: boolean; updatedAt?: string; total?: number; minN?: number; minRoi?: number; whitelist?: Row[]; blacklist?: Row[]; gray?: Row[] }

const pnlColor = (roi: number) => (roi > 0 ? '#4ade80' : roi < 0 ? '#f87171' : '#9ca3af');

export default function FtPairs() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [curWl, setCurWl] = useState<Set<string>>(new Set());
  const [curBl, setCurBl] = useState<Set<string>>(new Set());
  const [selWl, setSelWl] = useState<Set<string>>(new Set());
  const [selBl, setSelBl] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadCurrent = useCallback(async () => {
    const [w, b] = await Promise.all([
      fetch('/api/gs-pair-whitelist', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/gs-pair-blacklist', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ]);
    if (w?.ok) setCurWl(new Set(w.pairs));
    if (b?.ok) setCurBl(new Set(b.pairs));
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const j: Data = await fetch('/api/gs-ft-backtest', { cache: 'no-store' }).then((r) => r.json());
        if (cancel) return;
        if (!j.ok) { setErr('Không tải được backtest'); setLoading(false); return; }
        setData(j);
        setSelWl(new Set((j.whitelist ?? []).map((r) => r.pair)));  // mặc định tick hết whitelist
        setSelBl(new Set((j.blacklist ?? []).map((r) => r.pair)));
        await loadCurrent();
      } catch (e) { if (!cancel) setErr(String(e)); }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [loadCurrent]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, pair: string) => {
    const n = new Set(set); if (n.has(pair)) n.delete(pair); else n.add(pair); setter(n);
  };

  const save = async (kind: 'wl' | 'bl') => {
    const pairs = [...(kind === 'wl' ? selWl : selBl)];
    const label = kind === 'wl' ? 'WHITELIST (4 con Real + Test WL CHỈ đánh)' : 'BLACKLIST (né cặp)';
    if (!window.confirm(`⚠️ TIỀN THẬT — Set ${label} = ${pairs.length} cặp?\nÁp ngay cho 4 con Real + Test Whitelist (reload ~5s).`)) return;
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

  const Table = ({ kind, rows }: { kind: 'wl' | 'bl'; rows: Row[] }) => {
    const sel = kind === 'wl' ? selWl : selBl;
    const setter = kind === 'wl' ? setSelWl : setSelBl;
    const cur = kind === 'wl' ? curWl : curBl;
    const accent = kind === 'wl' ? '#34d399' : '#fb7185';
    return (
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-bold" style={{ color: accent }}>
            {kind === 'wl' ? '🟢 WHITELIST — cặp Xỉu TỐT (nên đánh)' : '🔴 BLACKLIST — cặp hay NỔ TÀI (nên né)'}
            <span className="ml-2 text-[12px] font-normal text-[#888]">{rows.length} cặp · tick {sel.size}</span>
          </h3>
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          <button type="button" disabled={saving} onClick={() => save(kind)}
            className="rounded-md border px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-40"
            style={{ borderColor: accent + '66', background: accent + '1a', color: accent }}>
            💾 Set {kind === 'wl' ? 'whitelist' : 'blacklist'} ({sel.size} cặp) → 4 con Real + Test WL
          </button>
          <button type="button" onClick={() => copyCmd(kind)}
            className="rounded-md border border-[#38bdf8]/40 bg-[#38bdf8]/10 px-3 py-1.5 text-[12px] font-semibold text-[#7dd3fc]">
            📋 Copy lệnh {kind === 'wl' ? '/setpairwl' : '/setpairbl'}
          </button>
        </div>
        {/* Câu lệnh cập nhật live theo cặp đã tick — bôi đen để copy tay */}
        <div className="mb-2 select-all break-all rounded-md border border-[#2a2a2a] bg-[#0f0f0f] px-2 py-1.5 font-mono text-[11px] text-[#9ca3af]">
          {kind === 'wl' ? '/setpairwl' : '/setpairbl'} {[...sel].join(', ') || 'none'}
        </div>
        <div className="max-h-[62vh] overflow-y-auto rounded-lg border border-[#2a2a2a]">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-[#1a1a1a] text-[11px] uppercase text-[#888]">
              <tr>
                <th className="px-2 py-2 text-left"> </th>
                <th className="px-2 py-2 text-left">Cặp</th>
                <th className="px-2 py-2 text-right" title="Line FT mở kèo lúc 0-0, trung bình">Line mở</th>
                <th className="px-2 py-2 text-right">n</th>
                <th className="px-2 py-2 text-right">ROI</th>
                <th className="px-2 py-2 text-right">WR</th>
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
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#e5c893]">{r.avgLine}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#9ca3af]">{r.n}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold" style={{ color: pnlColor(r.roi) }}>
                      {r.roi > 0 ? '+' : ''}{r.roi}%
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#d4d4d4]">{r.wr}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden">
      <div className="mb-3 shrink-0">
        <h1 className="text-[20px] font-bold text-white">📈 Cặp Whitelist / Blacklist (backtest FT-Xỉu)</h1>
        <p className="mt-1 text-[12px] leading-snug text-[#9ca3af]">
          Chấm kèo XỈU FT: <b>tổng bàn THẬT</b> (gs_matches_history) vs <b>line mở kèo lúc 0-0</b> (odds_log). Cột <b>Line mở</b> = line FT đầu H1 trung bình dùng để chấm.
          {data?.total != null && <> · {data.total} trận · ngưỡng n≥{data.minN}, ROI≥±{data.minRoi}%</>}
        </p>
        <p className="mt-1 text-[11px] text-[#e5a13a]">⚠️ Line mở phút~0 cao hơn line bot vào phút~9 (~0.25) → ROI/WR hơi lạc quan; thứ hạng cặp thì đúng.</p>
        {msg && <div className="mt-2 rounded-md border border-[#2a2a2a] bg-[#141414] px-3 py-1.5 text-[12px] text-[#d4d4d4]">{msg}</div>}
      </div>
      {loading ? (
        <div className="flex h-40 items-center justify-center text-[#888]">Đang chạy backtest (~9s)…</div>
      ) : err ? (
        <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[#fca5a5]">{err}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto lg:flex-row">
          <Table kind="wl" rows={data?.whitelist ?? []} />
          <Table kind="bl" rows={data?.blacklist ?? []} />
        </div>
      )}
    </div>
  );
}
