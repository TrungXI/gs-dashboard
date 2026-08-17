'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── SABA session-token bar (shared by SABA Live + SABA Video) ────────────────
// Cả 2 trang cần session SABA (collector auth + iframe player), nên dùng chung
// một thanh nhập token gọn ở đầu trang. User dán NGUYÊN link NewIndex (có S(...) trên
// thanh địa chỉ) từ SABA đang đăng nhập → POST /api/gs-saba-token { indexUrl }.
// Backend trích session + token, tự gia hạn. Trạng thái token đọc GET mỗi ~30s.
// See SPEC §4.2 (auth seam) + coordinator follow-up.

interface TokenStatus {
  ok: boolean;
  valid: boolean;            // true = còn hạn
  expiresInSec: number | null; // số giây còn lại (null nếu không rõ / hết hạn)
  masked: string | null;     // đuôi token đã che, e.g. '…a3f9'
  error?: string;
}

// Định dạng giây còn lại → "Xm" (phút) hoặc "Xs" khi <60s.
function fmtRemaining(sec: number): string {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m`;
  return `${Math.max(0, sec)}s`;
}

export default function SabaTokenBar() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Đồng hồ đếm ngược cục bộ: countdown giữa 2 lần GET (30s) cho mượt, không spam API.
  const [localSec, setLocalSec] = useState<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/gs-saba-token', { cache: 'no-store' });
      const json = (await res.json()) as TokenStatus;
      setStatus(json);
      setLocalSec(json.valid && json.expiresInSec != null ? json.expiresInSec : null);
    } catch (e) {
      setStatus({ ok: false, valid: false, expiresInSec: null, masked: null, error: String(e) });
      setLocalSec(null);
    }
  }, []);

  // Load + refresh trạng thái mỗi 30s. Ngừng khi tab ẩn.
  useEffect(() => {
    fetchStatus();
    const id = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) fetchStatus(); }, 30_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // Đồng hồ đếm ngược 1s (chỉ khi còn hạn) — làm badge "còn Xm" trôi mượt giữa các GET.
  useEffect(() => {
    if (localSec == null) return;
    const id = setInterval(() => setLocalSec((s) => (s == null ? null : Math.max(0, s - 1))), 1_000);
    return () => clearInterval(id);
  }, [localSec == null]);

  const saveMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSave = async () => {
    const indexUrl = input.trim();
    if (!indexUrl || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/gs-saba-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indexUrl }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (json.ok) {
        setSaveMsg({ ok: true, text: 'Đã lưu token' });
        setInput('');
        fetchStatus();
      } else {
        setSaveMsg({ ok: false, text: json.error ?? 'Lưu token thất bại' });
      }
    } catch (e) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
      if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
      saveMsgTimer.current = setTimeout(() => setSaveMsg(null), 4_000);
    }
  };
  useEffect(() => () => { if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current); }, []);

  const valid = !!status?.valid;
  const remaining = localSec ?? status?.expiresInSec ?? null;
  const expired = status != null && !valid;

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414]">
      {/* Hàng trạng thái (luôn hiện) — badge + đuôi token + nút thu gọn */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#666]">🔑 Token SABA</span>
        {status == null ? (
          <span className="rounded-full border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#888]">Đang kiểm tra…</span>
        ) : valid ? (
          <span
            className="rounded-full border border-[#22c55e]/40 bg-[#22c55e]/10 px-2 py-0.5 text-[11px] font-semibold text-[#4ade80]"
            title="Token còn hạn"
          >
            ● Token OK{remaining != null ? ` · còn ${fmtRemaining(remaining)}` : ''}
          </span>
        ) : (
          <span
            className="rounded-full border border-[#f59e0b]/50 bg-[#f59e0b]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fcd34d]"
            title="Token hết hạn hoặc chưa có"
          >
            ⚠ Token hết hạn — dán link mới
          </span>
        )}
        {status?.masked && (
          <span className="font-mono text-[10px] text-[#666]" title="Đuôi token hiện tại">{status.masked}</span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-[#888] hover:text-white"
          title={collapsed ? 'Mở ô nhập token' : 'Thu gọn'}
        >
          {collapsed ? 'Nhập token ▾' : 'Thu gọn ▴'}
        </button>
      </div>

      {/* Ô nhập (ẩn được) — input + nút Lưu + hint khi hết hạn */}
      {!collapsed && (
        <div className="border-t border-[#222] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }}
              placeholder="Dán link SABA (…/NewIndex?...) đang đăng nhập vào đây"
              className="min-w-0 flex-1 rounded-lg bg-white/[.07] px-2.5 py-1 text-xs text-white placeholder:text-[#666] outline-none border border-[#2a2a2a] focus:border-[#17a2b8]"
            />
            <button
              type="button"
              onClick={onSave}
              disabled={saving || input.trim() === ''}
              className="shrink-0 rounded-lg border border-[#17a2b8]/50 bg-[#17a2b8]/15 px-3 py-1 text-xs font-semibold text-[#8ee] transition-colors hover:bg-[#17a2b8]/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
            {saveMsg && (
              <span className={`text-[11px] font-semibold ${saveMsg.ok ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                {saveMsg.text}
              </span>
            )}
          </div>
          {expired && (
            <div className="mt-1.5 text-[10px] leading-snug text-[#888]">
              Mở SABA đang đăng nhập → copy nguyên link trên thanh địa chỉ (có S(...)) → dán vào đây. Token tự gia hạn, không cần dán lại trừ khi hết hạn hẳn.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
