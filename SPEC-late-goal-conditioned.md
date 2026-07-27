# SPEC — Bàn muộn ≥30/≥40 lọc theo tỉ số live (conditioned late-goal)

## Vấn đề hiện tại
Stat "⚽ Bàn muộn H1/H2 ≥30′ · ≥40′" hiện là **cố định per cặp đấu**: % TẤT CẢ trận đối đầu cũ có bàn ở phút ≥30/≥40. Không quan tâm tỉ số trận đang đá.

## Yêu cầu mới
Lọc stat đó **theo tỉ số trận live**, cập nhật **realtime** khi tỉ số thay đổi.

### Định nghĩa (ví dụ trận live đang 1-0)
- **Trạng thái live:** tổng bàn hiện tại T = 1 (1-0), đang đá hiệp H.
- **Pool điều kiện:** các trận đối đầu cũ CỦA ĐÚNG CẶP NÀY **từng đạt tổng bàn ≥ T** (tức "1-0 trở lên" = tổng ≥ 1). Loại các trận không bao giờ đạt tới tỉ số này.
- **Số hiển thị ≥30:** trong pool đó, **% trận có bàn TIẾP THEO** (trái nâng tổng từ T lên ≥ T+1) xuất hiện ở **phút ≥ 30** của hiệp đang đá.
- **Số hiển thị ≥40:** như trên, phút ≥ 40.

### Realtime
- Live 0-0 (T=0) → pool = mọi trận (tổng ≥ 0), đo bàn ĐẦU TIÊN ≥30/≥40.
- Live 1-0 hoặc 0-1 (T=1) → pool = trận từng có tổng ≥1, đo bàn THỨ 2 ≥30/≥40.
- Live 2-0 / 1-1 (T=2) → pool = trận từng có tổng ≥2, đo bàn THỨ 3 ≥30/≥40.
- Tỉ số live nhảy → n (cỡ pool) và % tự đổi ngay.

## Điểm ĐÃ CHỐT (user confirm 2026-07-27)
1. **Cách đếm bàn muộn = (A):** đúng trái NÂNG TỔNG vượt tỉ số hiện tại, ở phút ≥30/≥40 ("sút THÊM trái vào").
2. **Conditioning theo hiệp đang đá:**
   - **Đang H1** → T = tổng bàn H1 hiện tại. Pool = trận cũ có **tổng bàn H1 ≥ T**. %30/%40 = % pool mà trái nâng H1-total lên T+1 rơi vào phút ≥30/≥40 **của H1**.
   - **Đang H2** → T = **tổng bàn FT cả trận** hiện tại. Pool = trận cũ có **tổng FT ≥ T**. %30/%40 = % pool mà trái nâng FT-total lên T+1 rơi vào **H2** ở phút ≥30/≥40 **của H2**. (Trận nào đã đạt >T ngay trong H1 = front-load, KHÔNG tính là bàn-muộn-H2 → nằm mẫu số, không nằm tử số.)
3. **Dùng TỔNG bàn (home+away), KHÔNG phân biệt đội H hay A ghi.**
4. **n hiển thị = cỡ pool điều kiện** (số trận từng đạt tổng ≥ T theo hiệp tương ứng). → n giảm dần khi tỉ số live tăng.
5. Vẫn tách H1 / H2; chỉ hiện hiệp đang đá.

## Kỹ thuật (dự kiến)
- `gsMatchesDb.ts::fetchLateGoalFeatured`: đổi từ 1 con số/cặp → **breakdown theo ngưỡng tổng-bàn T** (0,1,2,3,…). Với mỗi cặp + mỗi T, tính: nPool(T) và %(có bàn thứ T+1 ở ≥30 / ≥40, theo hiệp). Dùng goal-events trong `match_odds_log` (mỗi bàn có minute + score cộng dồn + is_h2).
- API `/api/gs-late-goal-featured`: trả map `pair → { h1: [{T, pct30, pct40, n}], h2: [...] }` (vẫn cache ISR, KHÔNG cần param — FE tự tra theo tỉ số live).
- `RankingLive.tsx`: lấy T = tổng bàn live hiện tại, tra đúng bucket T, hiện %30/%40 + n; realtime theo mỗi poll.

## ⚠️ QUY TẮC PHÚT (user nhấn mạnh 2026-07-27)
- **≥30 / ≥40 = tính theo PHÚT GHI BÀN của trái đó** — lấy `minute` của chính goal-event nâng total lên T+1.
- KHÔNG dùng phút live hiện tại, KHÔNG dùng phút lúc đạt trạng thái tỉ số. Chỉ 1 con số: phút trái bóng vào lưới.
- 2 bucket: bàn ghi ở phút ≥30 (gồm 30→45+) và phút ≥40 (gồm 40→45+). ≥40 là tập con của ≥30.
- **PHÚT TÍNH THEO TỪNG HIỆP (per-half, 0–45), KHÔNG cộng dồn.** H1: phút trong H1. H2: phút trong H2 (bàn H2 phút 42 = ≥40, dù là ~87' cả trận). Data `match_odds_log.minute` vốn đã per-half → dùng thẳng.

## Nghi vấn / rủi ro
- Mẫu mỏng khi T cao (ít trận đạt 3-4 bàn) → n nhỏ, % nhiễu. Sẽ hiện n để user tự đánh giá.
- "Phút ≥30/≥40" của bàn thứ T+1: lấy minute của goal-event làm cho tổng đạt T+1 lần đầu.
