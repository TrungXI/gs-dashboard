// txRules.ts — Rule/chiến lược của TỪNG bot (calc_version) để hiển thị trong Báo cáo T/X.
// Nội dung tóm tắt TRUNG THỰC từ source bot trên VPS (/opt/gs-collector/tx-paper/*.mjs).
// Khi đổi rule bot → cập nhật ở đây cho khớp.

export interface TxRule {
  emoji: string;
  headline: string; // 1 dòng: bot làm gì
  side: string; // cửa đánh
  when: string; // thời điểm vào kèo
  strategy: string[]; // chiến lược
  data: string[]; // lấy data gì
  entry: string[]; // điều kiện VÔ KÈO
  note?: string;
}

// Data chung cho mọi bot (feed + chấm kèo) — tránh lặp.
const FEED = 'Feed gs-live nội bộ (VPS :8899) — mirror sb21 getEvent (endpoint PUBLIC, không cần token để đọc), poll ~1.5s.';
const GRADE = 'Chấm kèo theo TỔNG BÀN cuối trận, payout kiểu Malay; tự settle khi trận rời live.';
const PRIOR = 'Prior H1→H2 dựng LIVE từ toàn bộ match_odds_log lịch sử trong gs_db (leak-free), tối thiểu N mỗi bucket.';

export const TX_RULES: Record<string, TxRule> = {
  'V.Bot 12 Real': {
    emoji: '💰',
    headline: 'Pre-match XỈU line mở kèo (20p) — ĐẶT TIỀN THẬT.',
    side: 'Xỉu (Under) · biến thể 20p (V)',
    when: 'Ngay khi nhà cái MỞ KÈO ở Hiệp 1 (line mở kèo đầu tiên).',
    strategy: [
      'Backtest: kèo 20p, market đặt line hơi CAO so với số bàn thực (avg line 3.69 vs 3.56 bàn) → cửa XỈU +EV.',
      'R1 = đánh TẤT CẢ đội (không né đội nào). 1 lệnh/trận.',
      'Đặt lệnh THẬT qua sb21 placeBets (agentId 69). Retry khi book khoá/odds nhảy, KHÔNG bao giờ đặt 2 lệnh/trận (check server trước).',
    ],
    data: [
      FEED,
      'Lấy line + giá XỈU của ouLines[0] (line mở kèo toàn trận), kèm selectionId + offerId để đặt lệnh.',
      'Token đặt lệnh = GS_TOKEN trong .env (chính là token anh /settoken).',
      GRADE,
    ],
    entry: [
      'Trận đang live · matchType = 20p · còn Hiệp 1 (chưa sang H2).',
      'Nhà cái MỞ KÈO thật: bettingOpen = true, line không suspended, có line + giá Xỉu hợp lệ.',
      'Vào bất kể tỉ số (0-0/1-0/2-1…) và bất kể phút, miễn còn H1 + book mở.',
      'Chưa đặt lệnh trận này (local + server) → đặt 1 lệnh rồi chốt.',
    ],
    note: 'Tiền mỗi lệnh = /setmoney trong group Real Money. Token lỗi/hết hạn → bot báo group để /settoken lại.',
  },
  'V.Bot 12 R1': {
    emoji: '🧪',
    headline: 'Pre-match XỈU line mở kèo (20p) — bản GIẤY (không tiền thật).',
    side: 'Xỉu (Under) · biến thể 20p (V)',
    when: 'Ngay khi nhà cái mở kèo ở Hiệp 1.',
    strategy: [
      'Y HỆT V.Bot 12 Real nhưng KHÔNG đặt tiền thật (paper) — dùng để đối chiếu.',
      'R1 = đánh tất cả đội, không né. 1 lệnh/trận.',
    ],
    data: [FEED, 'Line + giá Xỉu ouLines[0] (line mở kèo).', GRADE],
    entry: [
      'Trận live · 20p · còn H1 · nhà cái mở kèo (bettingOpen, line không suspended).',
      'Vào bất kể tỉ số/phút miễn còn H1 + book mở.',
    ],
  },
  'V.Bot 12': {
    emoji: '🤖',
    headline: 'Pre-match XỈU line mở kèo (20p) — R2 (né 3 đội ghi bàn nhiều).',
    side: 'Xỉu (Under) · biến thể 20p (V)',
    when: 'Ngay khi nhà cái mở kèo ở Hiệp 1.',
    strategy: [
      'Như R1 nhưng NÉ 3 đội ghi bàn nhiều nhất (Indonesia/Korea/Japan) vì market hay underprice → nghiêng Tài.',
      'Backtest R2: n=522, win 60.7%, PnL +55.6u, ROI +10.6%.',
    ],
    data: [FEED, 'Line + giá Xỉu ouLines[0].', GRADE],
    entry: [
      'Trận live · 20p · còn H1 · book mở.',
      'Đội nhà HOẶC đội khách KHÔNG nằm trong danh sách né → mới vào.',
    ],
  },
  'V.Bot 1': {
    emoji: '📈',
    headline: 'G1 h1ContinuationOU — nối đà H1 sang H2.',
    side: 'Tài hoặc Xỉu (theo model)',
    when: 'Đúng lúc kickoff Hiệp 2 (betting_open), 1 lần/trận.',
    strategy: [
      'E = h1Total + bàn kỳ vọng H2 theo bucket (expFinal).',
      'E − line ≥ 0.35 → Tài; line − E ≥ 0.35 → Xỉu; còn lại PASS.',
    ],
    data: [FEED, PRIOR, 'h1Total = tỉ số cuối H1; line = OU toàn trận (ft).', GRADE],
    entry: ['Vào kèo H2 vừa mở · có đủ prior bucket · |E − line| ≥ 0.35.'],
  },
  'V.Bot 2': {
    emoji: '📊',
    headline: 'G3 kickoffH2LineValue — so P thực với giá de-vig.',
    side: 'Tài hoặc Xỉu (theo model)',
    when: 'Đúng lúc kickoff Hiệp 2 (betting_open), 1 lần/trận.',
    strategy: [
      'pTai = P(final > line | bucket H1) tính empirical.',
      'implied = P(Tài) de-vig từ giá thị trường.',
      'pTai − implied ≥ 0.06 → Tài; implied − pTai ≥ 0.06 → Xỉu; còn lại PASS.',
    ],
    data: [FEED, PRIOR, 'Giá over/under để de-vig; line OU toàn trận.', GRADE],
    entry: ['Vào kèo H2 vừa mở · lệch P vs giá ≥ 0.06.'],
  },
  'V.Bot 5': {
    emoji: '⬇️',
    headline: 'G1 Xỉu-only (edge 0.35) + price-gate.',
    side: 'Xỉu (Under) only',
    when: 'Đúng lúc kickoff Hiệp 2, 1 lần/trận.',
    strategy: [
      'Chỉ nhận tín hiệu XỈU của G1: line − E ≥ 0.35.',
      'Price-gate: chỉ vào khi giá Malay Xỉu > 0.70 hoặc âm (né kèo bị juice).',
    ],
    data: [FEED, PRIOR, GRADE],
    entry: ['Kèo H2 mở · G1 báo Xỉu (edge ≥ 0.35) · giá Xỉu qua price-gate.'],
    note: 'Vào ÍT kèo vì gate chặt (không phải chạy chậm) — càng chọn lọc, càng ít nhưng chất.',
  },
  'V.Bot 7': {
    emoji: '🎯',
    headline: 'G1 Xỉu conviction cao (edge 0.50) — ít kèo nhất.',
    side: 'Xỉu (Under) only',
    when: 'Đúng lúc kickoff Hiệp 2, 1 lần/trận.',
    strategy: [
      'Như V.Bot 5 nhưng NGƯỠNG edge cao nhất = 0.50 → chỉ vào kèo cực chắc.',
      'Price-gate giá Xỉu > 0.70 hoặc âm.',
    ],
    data: [FEED, PRIOR, GRADE],
    entry: ['Kèo H2 mở · G1 báo Xỉu với edge ≥ 0.50 · qua price-gate.'],
    note: 'Vào ÍT kèo NHẤT hệ thống (conviction 0.50) — đây là lý do "chạy chậm", không phải lỗi.',
  },
  'V.Bot 8': {
    emoji: '🔒',
    headline: 'G1 + G2 Consensus Xỉu — cả hai model phải đồng thuận.',
    side: 'Xỉu (Under) only',
    when: 'Đúng lúc kickoff Hiệp 2, 1 lần/trận.',
    strategy: [
      'Chỉ vào khi CẢ HAI: G1 (line − E ≥ 0.35) VÀ G2 (line − adjE ≥ 0.4) đều báo Xỉu.',
      'Conviction cao nhất, ít bets nhất, chất lượng cao.',
    ],
    data: [FEED, PRIOR, GRADE],
    entry: ['Kèo H2 mở · G1 AND G2 cùng báo Xỉu.'],
  },
  'V.Bot 9': {
    emoji: '⚙️',
    headline: 'V.Bot 5 tinh chỉnh: edge 0.45 + bỏ line 2.25–2.5 + price-gate.',
    side: 'Xỉu (Under) only',
    when: 'Đúng lúc kickoff Hiệp 2, 1 lần/trận.',
    strategy: [
      'G1 Xỉu-only, edge nâng 0.35 → 0.45.',
      'BỎ dải line 2.25–2.5 (ổ lỗ toàn hệ). Chỉ giữ [1.75, 2.0] ∪ [>2.5].',
      'Price-gate giá Xỉu > 0.70 hoặc âm.',
    ],
    data: [FEED, PRIOR, GRADE],
    entry: ['Kèo H2 mở · G1 Xỉu edge ≥ 0.45 · line ngoài dải 2.25–2.5 · qua price-gate.'],
  },
  'V.Bot 10': {
    emoji: '🇻',
    headline: 'V.Bot 9 nhưng CHỈ đánh biến thể (V).',
    side: 'Xỉu (Under) only · chỉ (V)',
    when: 'Đúng lúc kickoff Hiệp 2, 1 lần/trận.',
    strategy: ['Y hệt V.Bot 9, thêm lọc: chỉ nhận trận biến thể (V) — nơi Under lệch mạnh (~58%).'],
    data: [FEED, PRIOR, GRADE],
    entry: ['Như V.Bot 9 · và trận phải là biến thể (V).'],
  },
  'V.Bot 11': {
    emoji: '🇸',
    headline: 'V.Bot 9 nhưng CHỈ đánh biến thể (S) — control.',
    side: 'Xỉu (Under) only · chỉ (S)',
    when: 'Đúng lúc kickoff Hiệp 2, 1 lần/trận.',
    strategy: ['Y hệt V.Bot 9, thêm lọc: chỉ nhận trận biến thể (S) — đối chứng edge theo variant.'],
    data: [FEED, PRIOR, GRADE],
    entry: ['Như V.Bot 9 · và trận phải là biến thể (S).'],
  },
  'Tài Xỉu Live': {
    emoji: '📡',
    headline: 'Mirror gợi ý Xếp hạng Live (v1) — vào theo tín hiệu live.',
    side: 'Tài hoặc Xỉu (theo model live)',
    when: 'Trong trận, khoá 1 kèo chính mỗi hiệp + nhồi thêm khi điểm mở qua line đã ăn.',
    strategy: [
      'Sao chép ĐÚNG calc của dòng gợi ý VÀO trên tab Xếp hạng Live (v1-recent10).',
      'Nhồi (stack) leg cùng cửa, line cao hơn, chỉ khi tỉ số đã mở qua line thắng trước.',
    ],
    data: [FEED, 'Toàn bộ computeSignal như RankingLive (empirical + market blend).', GRADE],
    entry: ['Theo tín hiệu live của RankingLive · 1 primary/hiệp · nhồi có điều kiện.'],
  },
  'TX v8.0 · lineDrift': {
    emoji: '🌊',
    headline: 'Theo lineDrift — thị trường đẩy line về đâu thì đánh theo.',
    side: 'Tài hoặc Xỉu (theo hướng drift)',
    when: 'Trong trận, khi line dịch chuyển đủ mạnh.',
    strategy: [
      'Track dịch chuyển OU line trong trận (mỗi poll).',
      'Drift ≥ +0.5 → thị trường đẩy Tài → VÀO Tài. Drift ≤ −0.5 → VÀO Xỉu.',
      'Gate lọc: H2H pool N ≥ 8 · giá cửa > 0.70 hoặc âm · EV buffer ≥ 0.06 · ceiling scoredNow không vượt max H2H.',
    ],
    data: [FEED, 'Chuỗi thời gian OU line trong trận (in-memory) + H2H lịch sử.', GRADE],
    entry: ['|drift| ≥ 0.5 · qua đủ 4 gate (N, giá, EV, ceiling).'],
  },
};

const GENERIC: TxRule = {
  emoji: '🤖',
  headline: 'Bot Tài/Xỉu (paper) — chi tiết rule xem source trên VPS.',
  side: '—',
  when: '—',
  strategy: ['Chưa có mô tả rule riêng cho version này trong dashboard.'],
  data: [FEED, GRADE],
  entry: ['Xem source /opt/gs-collector/tx-paper/ trên VPS.'],
};

export function getTxRule(calcVersion: string): TxRule {
  return TX_RULES[calcVersion] ?? GENERIC;
}
