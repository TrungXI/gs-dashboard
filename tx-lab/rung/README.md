# `tx-lab/rung/` — backtest "kèo rung" cuối hiệp

Đi tìm luật vào lệnh **Over** theo timing (hình dạng V.Bot 14) cho một giải bất kỳ,
đọc timing từ `gs_16p_ticks` và ladder từ `raw->'ouLines'` / `raw->'ouH1Lines'`.

**Read-only tuyệt đối.** Không có `INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/TRUNCATE`
ở bất kỳ file nào trong thư mục này. Không đụng bot, không đụng VPS, không đụng tiền thật.

## Chạy

```bash
npm run rung:test    # parity engine — PHẢI PASS trước khi tin bất kỳ số nào
npm run rung:run     # quét toàn lưới + in báo cáo (≈30s trên máy local)
```

Kết quả ghi vào `results/` (đã gitignore):

| file | nội dung |
| --- | --- |
| `report-<league>.md` | đúng nội dung in ra stdout — khối 0 + T1…T9 |
| `grid-<league>.json` | toàn bộ lưới: tham số + metrics + chuỗi 8 cổng của từng ô |
| `champion-<league>.json` | ứng viên, 8 cổng, verdict, bộ tham số paper |

### Knob (env)

| env | mặc định | ý nghĩa |
| --- | --- | --- |
| `RUNG_LEAGUE` | `1508` | league quét chính (1508 = 20p Club) |
| `RUNG_SHUFFLES` | `200` | số lần shuffle cho phân bố null của grid-max |
| `RUNG_SEED` | `42` | seed; hai lần chạy cùng seed cho output giống hệt |
| `RUNG_MINUTE_TOL` | `1` | dung sai phút khi lấy tick (mật độ chỉ ~1.1 tick/phút) |
| `RUNG_MIN_BETS` | `40` | n tối thiểu để một ô được coi là ứng viên |
| `RUNG_CROSS_LEAGUES` | `1485,2140` | giải chạy prior-check chéo |
| `RUNG_FAMILIES` | `A,B,C` | giới hạn họ khi debug |
| `RUNG_CROSS_CANDIDATES` | `8` | số ô top được chạy prior chéo |
| `RUNG_E3_REPS` | `200` | số lần lặp của baseline ngẫu nhiên E3 |

Kết nối DB qua `ANALYSIS_DATABASE_URL` (env hoặc `.env.local` ở gốc repo).

## Ba họ giả thuyết + họ baseline

| họ | hình dạng |
| --- | --- |
| **A** | V.Bot 14: cắm cờ ở phút `X` (giá Xỉu trong `[PMIN,PMAX]`), vào lệnh đúng phút `Y` nếu không có bàn nào từ `X` |
| **B** | như A nhưng vào ở **tick mở đầu tiên** trong `[Y0, Y0+D]` |
| **C** | bỏ phút cắm cờ, chỉ cần "đã tịt bàn `K` phút liên tiếp tính tới phút `Y`" |
| **E1** | đối chứng: bê nguyên tham số V.Bot 14 (X=29, Y=34, PMIN=0.70) sang giải này |
| **E1b** | như E1 nhưng dùng gate **nguyên văn của bot** (`hasUnderOK`, so thô, không chuẩn hoá giá âm) |
| **E2** | đối chứng **quan trọng nhất**: vào lệnh ở phút `Y` cho MỌI trận, không filter gì cả |
| **E3** | đối chứng: chọn ngẫu nhiên một tick mở trong `[30,42]`, lặp `RUNG_E3_REPS` lần |

E2 tồn tại để trả lời câu hỏi duy nhất đáng hỏi: **các điều kiện "kèo rung" có đóng góp gì
so với việc cứ đến phút đó là vào?** Cổng 7.7 đòi ứng viên phải hơn E2 ít nhất 5 điểm ROI.

## Ý nghĩa từng cột báo cáo

| cột | nghĩa |
| --- | --- |
| `n` | số lệnh |
| `pnl` | tổng lãi/lỗ, đơn vị = 1 stake (u) |
| `roi` | `pnl / n` — **ROI trên mỗi lệnh**, không phải ROI trên vốn |
| `winRate` | `(win + 0.5×halfWin) / (n − push)`; line quarter tính nửa thắng |
| `evLB` | cận dưới 95% của EV/lệnh = `mean − 1.96×sd/√n`. **Xếp hạng theo cái này, không theo win-rate** — giá Malay âm làm win-rate cao vẫn có thể lỗ |
| `mdd` | sụt đỉnh-đáy sâu nhất của đường PnL luỹ kế, sắp theo thời gian |
| `l/ngày` | số lệnh / số ngày có dữ liệu |
| `roiEarly` / `roiLate` | ROI hai nửa thời gian, cắt ở **median `startAt`** (không cắt theo ngày — 3 ngày lệch 73/130/48) |
| `GATES` | 8 ký tự `✓/✗` ứng với cổng 7.1…7.8; `?` = ô đó chưa được chạy prior chéo |

Bảng T4 sắp theo **số cổng đạt** rồi `evLB` — **không** sắp theo ROI. Sắp theo ROI chính là
cái bẫy mà toàn bộ harness này được dựng ra để tránh.

## Vì sao verdict mặc định là `INSUFFICIENT_DATA`

Lưới quét ~19 000 tổ hợp trên tối đa ~470 cơ hội nửa-trận — khoảng **40 tổ hợp cho mỗi
quan sát**. Ở mật độ đó, ô tốt nhất của lưới **chắc chắn** trông đẹp kể cả khi dữ liệu
hoàn toàn vô nghĩa. ROI cao của ô top vì thế **không phải bằng chứng gì cả**, và hiệu chỉnh
kiểu Bonferroni cũng vô nghĩa vì các ô tương quan mạnh với nhau.

Bằng chứng duy nhất được chấp nhận là **kiểm định grid-max shuffle** (T6): hoán vị vector
`remainingGoals` giữa các trận **trong cùng hiệp và cùng ngày** — giữ nguyên hiệu ứng phút và
hiệu ứng ngày, chỉ phá liên kết giữa điều kiện vào lệnh của một trận và kết cục của **chính
trận đó** — rồi chấm lại toàn bộ lưới và ghi lại ROI của ô tốt nhất. Lặp `RUNG_SHUFFLES` lần
ta có phân bố "ô tốt nhất mà lưới này đạt được khi KHÔNG có edge nào cả". Ứng viên phải vượt
**p95** của phân bố đó.

Vì vậy: **verdict khởi điểm là `INSUFFICIENT_DATA` và chỉ được nâng lên khi vượt đủ 8 cổng.**
Cổng 7.4 trượt ⇒ verdict là `INSUFFICIENT_DATA`, bất kể ROI đẹp cỡ nào. "Chưa đủ dữ liệu"
là một kết quả **hợp lệ**; bịa ra edge thì không.

| verdict | điều kiện |
| --- | --- |
| `EDGE_CANDIDATE` | đủ cả 8 cổng, `n ≥ 40`, không có cảnh báo `FRAGILE_TOL` |
| `WEAK_SUGGESTION` | 7.1–7.7 đạt nhưng 7.8 trượt; hoặc `20 ≤ n < 40`; hoặc `FRAGILE_TOL` |
| `INSUFFICIENT_DATA` | mọi trường hợp còn lại |

## Ghi chú kỹ thuật

- **Ladder phải đọc từ `raw`.** Cột phẳng `ft_line/h1_line` bằng đúng `raw->…->0` (harness
  assert ≥99% lúc khởi động, đo được 100%) nhưng **chỉ có một nấc** — nấc gap 0.75 chỉ tồn tại
  ở `raw->…->1`. Dùng cột là mất hẳn một nửa không gian giả thuyết.
- **`db.mjs` ở đây không tái dùng `tx-lab/db.mjs`**: file đó hardcode `FROM match_odds_log`
  (sai bảng) và ép `ssl: { rejectUnauthorized: false }` (`ANALYSIS_DATABASE_URL` hiện trỏ
  Postgres nội bộ không TLS). Chỉ chép lại 10 dòng parse env, không sửa file đang phục vụ bài GA.
- **`engine.mjs` là bản sao nguyên văn `gradeLeg` của bot — không sửa.** `test/engine.test.mjs`
  khoá nó bằng cách đối chiếu với `tx-lab/settle.mjs` (viết độc lập, mô hình 5-way) trên toàn
  bộ lưới oracle; khớp nhau là bằng chứng cả hai đúng. `pnlOf` là đường nhanh không cấp phát
  dùng trong vòng shuffle, cũng bị khoá bằng test parity với `gradeLeg`.
- **`xiuScore` (§3.6)**: giá Malay âm nghĩa là kèo Xỉu được ưa **mạnh hơn** mọi giá dương, nên
  so thô `xiu >= 0.70` sẽ loại nhầm đúng những tick ta muốn bắt. Harness map `m < 0` lên
  `2 − |m|`. Đây là quyết định của SPEC, **không** phải hành vi của bot — nên E1b chạy song song
  với gate nguyên văn của bot để đo chênh lệch, và T2b in số lệnh bị ảnh hưởng.
- **Chia đôi thời gian theo median `startAt`**, không theo ngày.
- **H1 và H2 quét riêng**, không gộp: line H1 là line hiệp, line H2 là line **cả trận**
  (chấm theo tổng bàn FT).
