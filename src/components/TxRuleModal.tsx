'use client';

import { useEffect, useState } from 'react';
import { getTxRule } from '../lib/txRules';
import type { ClbvAnalystRow } from '../app/api/clbv-analyst/route';

// Các con chạy model PAIR_WL (2026-08-07) — CHỈ đánh 4 CẶP whitelist (pair-whitelist-r4d.json, reload 5s).
// Gồm 4 con Real tiền thật + paper "V.Bot 12 Test Whitelist" (cùng gate PAIR_WL). Hiện live danh sách cặp ở box 🎯.
const PAIR_WL_VERSIONS = new Set(['V.Bot 12 Real', 'V.Bot 12 Kien', 'V.Bot 12 Trong', 'V.Bot 12 Nam', 'V.Bot 12 Test Whitelist']);
// Các con V.Bot 17 — đánh TÀI, CHỈ đánh cặp trong pair-blacklist (reload 5s). Hiện live danh sách cặp ở box 🎯.
const PAIR_BL_VERSIONS = new Set(['V.Bot 17 Real', 'V.Bot 17 Real Kien', 'V.Bot 17 Test BlackList']);

// ── Bot LỌC ĐỘI theo bảng CLBV Analyst / Asians Analyst — hiện danh sách đội đủ điều kiện LIVE
// (2026-08-22, user). Cả 2 bảng là cửa sổ trượt 7 ngày và CHỈ đổi khi bấm Sync, nên KHÔNG hardcode
// danh sách vào txRules.ts (sẽ lỗi thời âm thầm) — fetch đúng API rồi lọc lại đúng điều kiện của
// bot. `source` chọn bảng: 'clbv' = /api/clbv-analyst (giải Câu Lạc Bộ 20p), 'asians' =
// /api/asians-analyst (giải Giao hữu Châu Á 16p) — mặc định 'clbv' khi không khai báo.
// ⚠️ Điều kiện dưới đây phải khớp checkMatchEligible() trong engine tương ứng. Engine đổi thì sửa ở đây.
type TeamFilter = {
  cond: string;
  source?: 'clbv' | 'asians';
  test: (r: ClbvAnalystRow) => boolean;
  stat: (r: ClbvAnalystRow) => string;
};
const pct = (v: number | null) => (v == null ? '–' : `${v.toFixed(1)}%`);
const TEAM_FILTERS: Record<string, TeamFilter> = {
  // TNK Rung: rule 2026-08-22 00:57 đã BỎ điều kiện số mẫu, chỉ còn tỉ lệ.
  // 2026-08-22 (sau đó, cùng ngày): user yêu cầu nới ngưỡng tỉ lệ 60%→55% (cả 3 bot) để tăng số đội được chọn.
  'TNK - CLB - Top Rung H1': {
    cond: 'rung_h1_rate ≥ 55% — KHÔNG đòi số mẫu tối thiểu',
    test: (r) => (r.rungH1Rate ?? -1) >= 55,
    stat: (r) => `rung H1 ${pct(r.rungH1Rate)} · n${r.rungH1N ?? 0}`,
  },
  'TNK - CLB - Top Rung H2': {
    cond: 'rung_h2_rate ≥ 55% — KHÔNG đòi số mẫu tối thiểu',
    test: (r) => (r.rungH2Rate ?? -1) >= 55,
    stat: (r) => `rung H2 ${pct(r.rungH2Rate)} · n${r.rungH2N ?? 0}`,
  },
  'TNK - CLB - Top Tài H2': {
    cond: 'h2_tai_rate ≥ 55% VÀ h2_n ≥ 10',
    test: (r) => (r.h2TaiRate ?? -1) >= 55 && (r.h2N ?? 0) >= 10,
    stat: (r) => `tài H2 ${pct(r.h2TaiRate)} · n${r.h2N ?? 0}`,
  },
  // Bot MỚI (2026-08-22), đánh XỈU — KHÔNG đòi số mẫu tối thiểu, cùng quy ước 2 bot TNK Rung gốc.
  'TNK - CLB - Top Xỉu H1': {
    cond: 'h1_xiu_rate ≥ 55% — KHÔNG đòi số mẫu tối thiểu',
    test: (r) => (r.h1XiuRate ?? -1) >= 55,
    stat: (r) => `xỉu H1 ${pct(r.h1XiuRate)} · n${r.h1N ?? 0}`,
  },
  'TNK - CLB - Top Xỉu FT': {
    cond: 'full_xiu_rate ≥ 55% — KHÔNG đòi số mẫu tối thiểu',
    test: (r) => (r.fullXiuRate ?? -1) >= 55,
    stat: (r) => `xỉu FT ${pct(r.fullXiuRate)} · n${r.fullN ?? 0}`,
  },
  // "Goal Xỉu H1" (2026-08-22) KHÔNG có entry ở đây — điều kiện chọn trận là TỔNG (cộng) avg bàn
  // của CẢ HAI đội, không phải ngưỡng áp cho từng đội riêng lẻ, nên không khớp mẫu UI "danh sách
  // đội đủ điều kiện" (mỗi dòng 1 đội) của TEAM_FILTERS. Xem txRules.ts để biết rule đầy đủ.
  'TNK - CLB - Goal Xỉu FT': {
    cond: 'full_xiu_avg_goals ≤ 2 (và khác NULL) — KHÔNG đòi số mẫu tối thiểu',
    test: (r) => r.fullXiuAvgGoals != null && r.fullXiuAvgGoals <= 2,
    stat: (r) => `avg bàn khi thắng xỉu FT ${r.fullXiuAvgGoals?.toFixed(2) ?? '–'} · n${r.fullN ?? 0}`,
  },
  // Bot MỚI (2026-08-22), giải Giao hữu Châu Á 16p (gs_asians_analyst) — đánh XỈU, có thêm gate
  // kèo chấp (hiện riêng ở phần "VÀO KÈO" của rule, không phải điều kiện chọn đội nên không lặp
  // ở đây). "Top" chọn theo tỉ lệ thắng, "Goal" chọn theo trung bình bàn khi thắng.
  'TNK - AS16 - Top Xỉu H1': {
    cond: 'h1_xiu_rate ≥ 52% — KHÔNG đòi số mẫu tối thiểu',
    source: 'asians',
    test: (r) => (r.h1XiuRate ?? -1) >= 52,
    stat: (r) => `xỉu H1 ${pct(r.h1XiuRate)} · n${r.h1N ?? 0}`,
  },
  'TNK - AS16 - Top Xỉu FT': {
    cond: 'full_xiu_rate ≥ 52% — KHÔNG đòi số mẫu tối thiểu',
    source: 'asians',
    test: (r) => (r.fullXiuRate ?? -1) >= 52,
    stat: (r) => `xỉu FT ${pct(r.fullXiuRate)} · n${r.fullN ?? 0}`,
  },
  'TNK - AS16 - Goal Xỉu H1': {
    cond: 'h1_xiu_avg_goals ≤ 0.12 (và khác NULL) — KHÔNG đòi số mẫu tối thiểu',
    source: 'asians',
    test: (r) => r.h1XiuAvgGoals != null && r.h1XiuAvgGoals <= 0.12,
    stat: (r) => `avg bàn khi thắng xỉu H1 ${r.h1XiuAvgGoals?.toFixed(2) ?? '–'} · n${r.h1N ?? 0}`,
  },
  'TNK - AS16 - Goal Xỉu FT': {
    cond: 'full_xiu_avg_goals ≤ 0.8 (và khác NULL) — KHÔNG đòi số mẫu tối thiểu',
    source: 'asians',
    test: (r) => r.fullXiuAvgGoals != null && r.fullXiuAvgGoals <= 0.8,
    stat: (r) => `avg bàn khi thắng xỉu FT ${r.fullXiuAvgGoals?.toFixed(2) ?? '–'} · n${r.fullN ?? 0}`,
  },
  // Bot MỚI (2026-08-22), đánh TÀI hiệp 2 — điều kiện chọn đội GIỐNG hệt mẫu h2_tai_rate của
  // "TNK - CLB - Top Tài H2" gốc nhưng đọc bảng Asians Analyst, ngưỡng 54%.
  'TNK - AS16 - Top Tài H2': {
    cond: 'h2_tai_rate ≥ 54% — KHÔNG đòi số mẫu tối thiểu',
    source: 'asians',
    test: (r) => (r.h2TaiRate ?? -1) >= 54,
    stat: (r) => `tài H2 ${pct(r.h2TaiRate)} · n${r.h2N ?? 0}`,
  },
  // NVT-R giữ rule CŨ: còn đòi n ≥ 10, và H1 còn cần h1_tai_avg_goals để chạy gate avgGoals.
  'NVT-R-H1': {
    cond: 'rung_h1_rate ≥ 60% VÀ rung_h1_n ≥ 10 VÀ có h1_tai_avg_goals',
    test: (r) => (r.rungH1Rate ?? -1) >= 60 && (r.rungH1N ?? 0) >= 10 && r.h1TaiAvgGoals != null,
    stat: (r) => `rung H1 ${pct(r.rungH1Rate)} · n${r.rungH1N ?? 0} · avg bàn H1 ${r.h1TaiAvgGoals?.toFixed(2) ?? '–'}`,
  },
  'NVT-R-H2': {
    cond: 'rung_h2_rate ≥ 60% VÀ rung_h2_n ≥ 10',
    test: (r) => (r.rungH2Rate ?? -1) >= 60 && (r.rungH2N ?? 0) >= 10,
    stat: (r) => `rung H2 ${pct(r.rungH2Rate)} · n${r.rungH2N ?? 0}`,
  },
};

// Modal xem RULE của 1 bot (calc_version) hoặc 1 handicap model (key 'HCAP:A|B|C').
// Mở từ nút "📖 Rule" trong Báo cáo T/X. `title` (nếu truyền) hiện ở header thay cho `version`
// (handicap model dùng key 'HCAP:A' để tra rule nhưng header hiện "A · Trên tiếp H2 (16p)").
export default function TxRuleModal({ version, title, onClose }: { version: string; title?: string; onClose: () => void }) {
  const r = getTxRule(version);
  const headerTitle = title ?? version;
  const [wlPairs, setWlPairs] = useState<string[] | null>(null);
  const [blPairs, setBlPairs] = useState<string[] | null>(null);
  const [teamRows, setTeamRows] = useState<ClbvAnalystRow[] | null>(null);
  const [teamMeta, setTeamMeta] = useState<{ updatedAt: string | null; windowDays: number } | null>(null);
  const teamFilter = TEAM_FILTERS[version];
  const isPairWl = PAIR_WL_VERSIONS.has(version);
  const isPairBl = PAIR_BL_VERSIONS.has(version);

  // ESC để đóng.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Pairing-whitelist (con Xỉu) / pairing-blacklist (con Tài V.Bot 17) động — fetch đúng loại.
  useEffect(() => {
    let cancelled = false;
    if (PAIR_WL_VERSIONS.has(version)) {
      fetch('/api/gs-pair-whitelist', { cache: 'no-store' })
        .then((res) => res.json())
        .then((j) => { if (!cancelled && j.ok) setWlPairs(j.pairs); })
        .catch(() => { /* noop */ });
    } else if (PAIR_BL_VERSIONS.has(version)) {
      fetch('/api/gs-pair-blacklist', { cache: 'no-store' })
        .then((res) => res.json())
        .then((j) => { if (!cancelled && j.ok) setBlPairs(j.pairs); })
        .catch(() => { /* noop */ });
    }
    return () => { cancelled = true; };
  }, [version]);

  // Danh sách đội đủ điều kiện — LẤY LIVE mỗi lần mở modal, không hardcode. Endpoint phụ thuộc
  // `source` của TEAM_FILTERS entry (clbv-analyst mặc định, asians-analyst cho họ bot AS16).
  useEffect(() => {
    const filter = TEAM_FILTERS[version];
    if (!filter) { setTeamRows(null); setTeamMeta(null); return; }
    let cancelled = false;
    const endpoint = filter.source === 'asians' ? '/api/asians-analyst' : '/api/clbv-analyst';
    fetch(endpoint, { cache: 'no-store' })
      .then((res) => res.json())
      .then((j) => {
        if (cancelled || !j.ok) return;
        setTeamRows(j.rows as ClbvAnalystRow[]);
        setTeamMeta({ updatedAt: j.updatedAt ?? null, windowDays: j.windowDays ?? 7 });
      })
      .catch(() => { /* noop */ });
    return () => { cancelled = true; };
  }, [version]);

  const Section = ({ icon, title, items }: { icon: string; title: string; items: string[] }) => (
    <div className="mb-4">
      <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#fbbf24]">
        {icon} {title}
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#d4d4d4]">
            <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[#555]" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#141414] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#2a2a2a] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[15px] font-bold text-white">
              <span>{r.emoji}</span>
              <span className="truncate">{headerTitle}</span>
            </div>
            <div className="mt-0.5 text-[13px] text-[#9ca3af]">{r.headline}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="shrink-0 rounded-md px-2 py-1 text-[18px] leading-none text-[#888] transition hover:bg-white/[.08] hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-md border border-[#fb7185]/40 bg-[#fb7185]/10 px-2 py-1 text-[12px] font-semibold text-[#fda4af]">
              Cửa: {r.side}
            </span>
            <span className="rounded-md border border-[#38bdf8]/40 bg-[#38bdf8]/10 px-2 py-1 text-[12px] font-semibold text-[#7dd3fc]">
              ⏱ {r.when}
            </span>
          </div>

          {isPairWl && (
            /* 🎯 Pairing WHITELIST động — CHỈ đánh khi gặp đúng các cặp này (model PAIR_WL). */
            <div className="mb-4 rounded-lg border border-[#34d399]/30 bg-[#34d399]/[.08] px-3 py-2">
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[#6ee7b7]">🎯 CHỈ đánh các CẶP này (pairing-whitelist)</div>
              <div className="text-[13px] text-[#e5c893]">
                {wlPairs == null
                  ? 'Đang tải…'
                  : wlPairs.length
                    ? `${wlPairs.length} cặp: ${wlPairs.map((p) => p.replace('|', ' vs ')).join(', ')}`
                    : 'Chưa set cặp nào → KHÔNG đánh gì'}
              </div>
              <div className="mt-1 text-[11px] text-[#9ca3af]">Đã BỎ whitelist/blacklist/pairing per-đội — chỉ đánh đúng cặp trong list (file pair-whitelist-r4d.json, reload 5s, áp cả 4 con Real).</div>
            </div>
          )}

          {isPairBl && (
            /* 🎯 Pairing BLACKLIST động — con V.Bot 17 đánh TÀI CHỈ khi gặp cặp trong list này. */
            <div className="mb-4 rounded-lg border border-[#fb7185]/30 bg-[#fb7185]/[.08] px-3 py-2">
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[#fda4af]">🎯 CHỈ đánh TÀI các CẶP này (blacklist — nổ Tài)</div>
              <div className="text-[13px] text-[#e5c893]">
                {blPairs == null
                  ? 'Đang tải…'
                  : blPairs.length
                    ? `${blPairs.length} cặp: ${blPairs.map((p) => p.replace('|', ' vs ')).join(', ')}`
                    : 'Chưa set cặp nào → KHÔNG đánh gì'}
              </div>
              <div className="mt-1 text-[11px] text-[#9ca3af]">Cặp NỔ TÀI từ backtest FT — đổi qua /setpairbl hoặc nút "Set blacklist" trang 📈 (file pair-blacklist-r4d.json, reload 5s, áp V.Bot 17 Real + Kiên + Test).</div>
            </div>
          )}

          {teamFilter && (
            /* 🏷 Đội đủ điều kiện — LIVE từ bảng CLBV Analyst, lọc lại đúng điều kiện của bot này. */
            <div className="mb-4 rounded-lg border border-[#38bdf8]/30 bg-[#38bdf8]/[.08] px-3 py-2">
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[#7dd3fc]">
                🏷 CHỈ xét trận có đội đạt — {teamFilter.cond}
              </div>
              {teamRows == null ? (
                <div className="text-[13px] text-[#9ca3af]">Đang tải danh sách đội…</div>
              ) : (() => {
                const ok = teamRows.filter(teamFilter.test)
                  .sort((a, b) => a.teamName.localeCompare(b.teamName));
                if (!ok.length) {
                  return <div className="text-[13px] text-[#fda4af]">Hiện KHÔNG đội nào đạt → bot sẽ không vào lệnh nào.</div>;
                }
                return (
                  <>
                    <div className="mb-1 text-[13px] font-semibold text-[#e5c893]">
                      {ok.length}/{teamRows.length} đội đang đạt
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {ok.map((t) => (
                        <div key={t.teamId} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12.5px]">
                          <span className="text-[#e5e5e5]">{t.teamName}</span>
                          <span className="text-[11.5px] text-[#9ca3af]">{teamFilter.stat(t)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
              <div className="mt-1.5 text-[11px] text-[#9ca3af]">
                Lấy trực tiếp từ bảng CLBV Analyst lúc mở bảng này — cửa sổ {teamMeta?.windowDays ?? 7} ngày trượt.
                {teamMeta?.updatedAt ? ` Bảng cập nhật lần cuối ${new Date(teamMeta.updatedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.` : ''}
                {' '}Bảng CHỈ đổi khi bấm Sync ở trang CLBV Analyst.
              </div>
            </div>
          )}

          <Section icon="🧠" title="Chiến lược" items={r.strategy} />
          <Section icon="🗂" title="Lấy data gì" items={r.data} />
          <Section icon="✅" title="Điều kiện VÔ KÈO" items={r.entry} />

          {r.note && (
            <div className="mt-2 rounded-lg border border-[#fbbf24]/25 bg-[#fbbf24]/[.07] px-3 py-2 text-[12.5px] leading-snug text-[#e5c893]">
              💡 {r.note}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
