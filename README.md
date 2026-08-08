# GS Asian Friendlies — Hệ thống Bot cược Tài/Xỉu + Dashboard

Hệ thống phân tích & đặt cược tự động cho giải bóng đá ảo **GS Asian Friendlies** (sb21.net):
thu thập feed trận đấu live → phân tích → ~50 con bot đặt kèo Tài/Xỉu (paper + tiền thật) →
điều khiển qua Telegram → hiển thị trên web dashboard.

> **Tài** = Over (Trên) · **Xỉu** = Under (Dưới) · trận có 2 biến thể: **16p (S)** và **20p (V)**.

---

## 1. Tổng quan — 2 codebase

| Codebase | Vai trò | Ngôn ngữ / Stack | Chạy ở đâu |
|---|---|---|---|
| **`gs-dashboard`** | Giao diện web (xem live, báo cáo, rule…) | TypeScript · **Next.js 16** · React 19 · Tailwind 4 · `pg` | VPS `/opt/gs-dashboard` |
| **`gs-collector`** | Backend: collector + bot + Telegram | **Node.js 20** (132 file JS/MJS) + **Python 3.10** (4 script) · `pg` | VPS `/opt/gs-collector` |

- **Repo GitHub**: `TrungXI/gs-dashboard` (public). `gs-collector` là **source-of-truth trên VPS** (edit trực tiếp, chưa lên GitHub).
- Cả hệ thống chạy trên **1 con VPS duy nhất**.

---

## 2. Hạ tầng (Infrastructure)

```
VPS 103.82.23.48  (Ubuntu 22.04, SSH ~/.ssh/id_rsa_cloudfly, timezone +07)
│
├── Node.js 20  +  Python 3.10
├── PostgreSQL 14   →  DB "gs_db" (local, port 5432)          ← nguồn dữ liệu chính
├── pm2             →  quản lý ~60 process
├── nginx 1.18 + Let's Encrypt  →  https://gs.corelab.group   ← dashboard public
│
├── /opt/gs-dashboard   (Next.js — pm2 "gs-dashboard")
└── /opt/gs-collector   (backend/bot — ~59 process pm2)
        ├── collector.js, collector-gs-matches.js   (hút feed sb21 → DB)
        ├── gs-live-server.mjs                       (feed nội bộ, port 8899)
        ├── bot.js                                   (router lệnh Telegram, pm2 "gs-bot")
        ├── predict*.js, calibrate.js, settle        (phân tích + chấm kèo)
        └── tx-paper/                                (31 con bot + 44 ecosystem config)

Ngoài VPS:
├── Supabase (free)   →  mirror backup gs_db mỗi đêm 3h VN (phòng VPS chết)
├── Telegram          →  điều khiển bot + báo kèo/ghi bàn
└── sb21.net          →  nguồn feed trận đấu live (Tài/Xỉu, tỉ số, odds)
```

### Luồng dữ liệu
```
sb21.net feed ─► collector.js ─► PostgreSQL gs_db ─► ┌─► gs-live-server.mjs (:8899) ─► bot cược
                                                     ├─► dashboard (Next.js API) ─► web
                                                     └─► Supabase mirror (backup đêm)
```

---

## 3. `gs-dashboard` — cấu trúc

Next.js App Router. 1 trang chính (`src/app/page.tsx`) render `Dashboard.tsx`, đổi view qua sidebar.

```
src/
├── app/
│   ├── page.tsx                  # entry — render Dashboard
│   └── api/                      # ~34 API route (Node runtime, đọc gs_db qua pg)
│       ├── gs-live/              # feed trận live (parse sb21) — RankingLive/GSLive dùng
│       ├── gs-live-goals/        # phút ghi bàn realtime (suy từ match_odds_log)
│       ├── gs-tx-report/         # báo cáo PnL bot theo calc_version
│       ├── gs-ft-backtest/       # backtest cặp WL/BL (cache DB, job đêm)
│       ├── gs-pair-whitelist|blacklist/  # đọc list cặp bot đang áp (GET-only)
│       ├── gs-bot-report/, gs-bot-status/, gs-h2h-*/, gs-matches/ …
│       └── …
├── components/
│   ├── Dashboard.tsx             # khung + sidebar + view router
│   ├── RankingLive.tsx           # "Tài Xỉu Live" — xếp hạng + timeline ghi bàn + H2H
│   ├── GSLive.tsx                # bảng odds live chi tiết (ẩn khỏi nav)
│   ├── TxReport.tsx              # "Báo cáo TX" — PnL bot, gom section theo chủ ví
│   ├── FtPairs.tsx               # "Cặp WL/BL" — backtest FT, filter 7/14/21/28, compare
│   ├── BotReport.tsx             # ma trận bot
│   ├── SystemMonitor.tsx         # "Monitor" — health hạ tầng
│   └── TxRuleModal / TxDetailDrawer / …
└── lib/
    ├── gsMatchesDb.ts            # query DB trận đấu (lớn nhất)
    ├── txRules.ts                # định nghĩa rule/chiến lược từng bot (hiển thị "Xem Rule")
    ├── teamForm.ts, h2Stats.ts, gsPatterns.ts …  # thống kê/phân tích
```

**Chạy local (dev):**
```bash
npm install
# tạo .env.local:
#   ANALYSIS_DATABASE_URL="postgresql://gs_user:<pass>@103.82.23.48:5432/gs_db"
#   NEXT_PUBLIC_GS_TOKEN=69-<feed-token>
npm run dev            # http://localhost:3000
```

**Deploy lên VPS:**
```bash
rsync -az --exclude node_modules --exclude .next ./ root@103.82.23.48:/opt/gs-dashboard/
ssh root@103.82.23.48 'cd /opt/gs-dashboard && npm run build && pm2 restart gs-dashboard'
# live: https://gs.corelab.group
```

---

## 4. `gs-collector` — cấu trúc

Node script thuần (không framework), mỗi chức năng 1 process pm2.

```
/opt/gs-collector/
├── collector.js              # hút odds/feed live sb21 → match_odds_log
├── collector-gs-matches.js   # ghi kết quả trận → gs_matches_history
├── gs-live-server.mjs        # feed nội bộ :8899 (bot cược đọc trận từ đây)
├── bot.js                    # router lệnh Telegram (/settoken /start /list /setpairwl …)
├── predict.js / predict-thuanso.js   # engine dự đoán
├── calibrate.js, settle      # hiệu chỉnh + chấm thắng/thua
├── impute-ouline.js, backfill*.js    # vá dữ liệu
└── tx-paper/
    ├── tx-paper-bot-*.mjs             # 31 con bot (V.Bot 12/14/16/17…, paper + real)
    ├── ecosystem.*.config.cjs         # 44 config pm2 (env: CALC_VERSION, MONEY_CFG, PAIR_WL…)
    ├── money-config-*.json            # ⚠️ stake + token cược THẬT (KHÔNG commit)
    ├── pair-whitelist-r4d.json        # cặp Xỉu bot 12 đánh (include_pairs)
    ├── pair-blacklist-r4d.json        # cặp Tài bot 17 đánh (exclude_pairs)
    └── .env, .supabase.pgpass         # ⚠️ secrets (KHÔNG commit)
```

**Đặc điểm quan trọng:**
- VPS là **source-of-truth** (repo git nếu có thường lỗi thời) → **deploy = sửa file trên VPS + `pm2 restart <bot>`**.
- Mỗi con real money có **token/ví/stake RIÊNG** qua `money-config-*.json` (`BET_TOKEN_MODE=config`) — không dùng chung token gốc.
- Bot đọc list cặp **động** (`pair-*-r4d.json`, reload ~5s, không cần restart). Set qua Telegram `/setpairwl` `/setpairbl` (chỉ admin trong group).

---

## 5. Database (PostgreSQL `gs_db`)

| Bảng | Nội dung |
|---|---|
| `match_odds_log` | Log odds + tỉ số theo phút mỗi trận (nguồn suy phút ghi bàn, line mở) |
| `gs_matches_history` | Kết quả trận FT (tổng bàn thật) |
| `gs_teams` | Danh sách đội (map tên) |
| `gs_tx_paper` | Mọi lệnh bot đặt (versioned theo `calc_version`) — nguồn báo cáo PnL |
| `gs_ft_backtest_hist` | Snapshot backtest cặp WL/BL mỗi ngày (job đêm) |
| `gs_claude_predictions`, `gs_arm_timeline`, `gs_ht_*`, `gs_thuanso_picks` … | phân tích/dự đoán khác |

- **Join** `match_odds_log` ↔ `gs_matches_history`: neo qua **team + thời gian** (`event_id` không đáng tin).
- Odds lưu dạng **Malay** (`ou_over`/`ou_under`).

---

## 6. Backup & Disaster Recovery

- **Supabase (free tier 500MB)**: cron 3h sáng VN mirror `gs_db` → off-site. Hiện ~38MB, tăng ~1.5MB/ngày.
- **Code**: `gs-dashboard` trên GitHub; `gs-collector` = dump từ VPS.
- VPS chết → dựng lại theo quy trình restore (code GitHub + data Supabase).

---

## 7. Điều khiển qua Telegram (bot.js)

Mỗi group tiền thật có token/ví riêng. Lệnh chính:
- `/settoken 69-<token>` — cập nhật token đặt lệnh (không đụng group khác)
- `/start` `/stop` — bật/tắt bot đặt lệnh · `/sethour N` — hẹn giờ tự tắt
- `/list` — bot đang chạy + stake + số dư · `/balance`
- `/setpairwl` `/setpairbl` — set cặp whitelist/blacklist (admin)

---

## 8. Ghi chú vận hành

- **Bot tiền thật**: thao tác cẩn thận, restart TỪNG con cách nhau (tránh miss kèo đồng loạt); bot mới mặc định `enabled=false` chờ `/settoken` + `/start`.
- **Không commit secrets**: `money-config-*.json`, `.env*`, `*.pgpass` chứa token thật/mật khẩu.
- **VPS không có IPv6** → Node dùng `--dns-result-order=ipv4first` (tránh "fetch failed").
- Model bot phần lớn **kén** (chỉ vào 0-0, đúng cặp trong list, book phải mở) → volume thấp là bình thường.
