// txRules.ts — Rule/chiến lược của TỪNG bot (calc_version), viết THUẦN TIẾNG VIỆT cho người
// không rành kỹ thuật: nói rõ bot NHÌN GÌ, SO SÁNH GÌ, KHI NÀO VÔ KÈO. Không dùng tên bảng/jargon.

export interface TxRule {
  emoji: string;
  headline: string; // 1 dòng: bot làm gì
  side: string; // cửa đánh
  when: string; // thời điểm vào kèo
  strategy: string[]; // ý tưởng + SO SÁNH GÌ để quyết định
  data: string[]; // bot nhìn vào cái gì
  entry: string[]; // điều kiện VÔ KÈO
  note?: string;
  short?: string; // tóm tắt 1 dòng — hiện THẲNG trong danh sách report (ngoài modal Xem Rule)
}

// Mô tả chung, viết dễ hiểu.
const READ_ODDS = 'Đọc trực tiếp từ nhà cái: line Tài/Xỉu + giá cửa + tỉ số đang đá (cập nhật ~1,5 giây/lần).';
const GRADE = 'Chấm thắng/thua dựa trên TỔNG SỐ BÀN cuối trận.';
const HISTORY = 'Xem lại rất nhiều trận tương tự trong quá khứ để ước tính hiệp 2 thường ghi thêm mấy bàn.';

// Rule bot đặt TIỀN THẬT — dùng chung cho 'V.Bot 12 Real' (ví gốc) và 'V.Bot 12 Kien' (ví Kiên).
// Cùng file code, cùng chiến lược, chỉ khác group + ví + stake.
const VBOT12_REAL_RULE: TxRule = {
  emoji: '💰',
  headline: 'Đánh XỈU loại trận 20 phút: chờ 30 giây thật đầu trận rồi vào khi nhà cái mở kèo, né 3 đội xấu — ĐẶT TIỀN THẬT.',
  side: 'Luôn đánh XỈU (Under)',
  when: 'Đợi 30 giây (thời gian thật) kể từ lúc thấy trận, rồi vào ngay khi nhà cái đang mở kèo (không khóa). Nếu tới phút 15 (đồng hồ trong trận) mà vẫn chưa vào được thì BỎ trận.',
  strategy: [
    'Ý tưởng: ở loại trận 20 phút (nhóm V — nhiều bàn), nhà cái thường ra line HƠI CAO so với số bàn thực tế → cửa XỈU có lợi thế.',
    'So sánh: line trung bình nhà cái đưa ~3,69 bàn, nhưng thực tế các trận này trung bình chỉ ~3,56 bàn.',
    'NÉ 3 đội đánh Xỉu hay thua: Indonesia, Saudi Arabia và Triều Tiên (North Korea).',
    'Các đội còn lại (India, Thái Lan, Iran, Trung Quốc, Qatar, New Zealand, Nhật, Hàn, Việt Nam…) đều đánh Xỉu tốt → giữ đánh hết.',
    'Mỗi trận chỉ vào đúng 1 lệnh, giữ tới hết trận (không cắt lời/lỗ giữa chừng), tiền cố định mỗi lệnh.',
  ],
  data: [
    READ_ODDS,
    'Line + giá cửa Xỉu nhà cái đang mở ở trận loại 20 phút, kèm tên 2 đội để lọc, và phút trận đang đá.',
    GRADE,
  ],
  entry: [
    'Trận đang đá, đúng loại 20 phút, còn trong hiệp 1.',
    'CHỜ ĐẦU: đủ 30 giây THẬT (thời gian thực) kể từ lúc bot thấy trận — né lúc giá vừa mở còn nhảy. (Tính theo giây thật, KHÔNG theo đồng hồ trận chạy nhanh.)',
    'CẤM TRỄ: nếu tới phút 15 theo ĐỒNG HỒ TRONG TRẬN mà vẫn chưa vào được → BỎ HẲN trận (không đánh nữa, kể cả sau đó mới mở kèo).',
    'Lúc đặt lệnh: nhà cái phải đang MỞ KÈO thật, có line + giá Xỉu rõ ràng, KHÔNG bị khóa/tạm ngưng (khóa thì thà bỏ lỡ còn hơn vào mà người theo không vào được).',
    'Cả hai đội đều KHÔNG phải Indonesia / Saudi Arabia / Triều Tiên.',
    'Vào bất kể đang tỉ số mấy (0-0, 1-0, 2-1…) — miễn còn hiệp 1, đã qua 30 giây thật và chưa quá phút 15 trận.',
  ],
  note: 'Bot đặt TIỀN THẬT. Lệnh trong group: /setmoney <số> (tiền mỗi lệnh) · /pnl (lãi/lỗ hôm nay) · /balance (số dư) · /start /stop (bật/tắt đặt lệnh) · /settoken 69-… (cập nhật token khi hết hạn) · /info (xem cấu hình + lệnh).',
  short: '💰 TIỀN THẬT · XỈU trận 20p (V) · chờ 30s THẬT đầu trận rồi vào khi book mở (không khóa) · quá phút 15 (đồng hồ trận) chưa vào thì bỏ · né Indonesia/Saudi Arabia/Triều Tiên · 1 lệnh/trận.',
};

export const TX_RULES: Record<string, TxRule> = {
  'V.Bot 12 Real': VBOT12_REAL_RULE,
  'V.Bot 12 Kien': {
    ...VBOT12_REAL_RULE,
    headline: 'Y hệt bản R4-C tiền thật, nhưng chạy trên VÍ RIÊNG của Kiên (group + token + tiền tách biệt).',
    note: 'Bot đặt TIỀN THẬT trên ví Kiên — độc lập với ví gốc (token/stake/số dư riêng). Lệnh trong group Kiên: /setmoney · /pnl · /balance · /start /stop · /settoken 69-… · /info. /settoken ở đây KHÔNG đụng token bot gốc.',
  },
  'V.Bot 12 R1': {
    emoji: '🧪',
    headline: 'Y hệt bản tiền thật nhưng chạy THỬ (không đặt tiền) — để đối chiếu.',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Ngay khi nhà cái mở kèo, lúc còn hiệp 1.',
    strategy: [
      'Cùng cách đánh với bản tiền thật: line nhà cái ở loại trận 20 phút thường hơi cao → đánh XỈU.',
      'Đánh mọi đội, mỗi trận 1 lệnh. Khác biệt duy nhất: KHÔNG đặt tiền, chỉ ghi nhận để so sánh kết quả.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Xỉu nhà cái vừa mở.', GRADE],
    entry: ['Trận loại 20 phút · còn hiệp 1 · nhà cái đã mở kèo.'],
  },
  'V.Bot 12': {
    emoji: '🤖',
    headline: 'Đánh XỈU như bản gốc nhưng TRÁNH vài đội hay ghi nhiều bàn.',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Ngay khi nhà cái mở kèo, lúc còn hiệp 1.',
    strategy: [
      'Cùng ý tưởng: line loại trận 20 phút hơi cao → đánh XỈU.',
      'Khác biệt: BỎ QUA các đội hay ghi nhiều bàn (Indonesia, Hàn Quốc, Nhật) — vì mấy đội này dễ làm kèo nghiêng về Tài, đánh Xỉu dễ thua.',
      'Còn lại đánh XỈU bình thường, mỗi trận 1 lệnh.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Xỉu, kèm tên 2 đội để lọc.', GRADE],
    entry: [
      'Trận loại 20 phút · còn hiệp 1 · nhà cái đã mở kèo.',
      'Cả hai đội đều KHÔNG nằm trong nhóm đội bị tránh.',
    ],
  },
  'V.Bot 12 R4-B': {
    emoji: '🏆',
    headline: 'Đánh XỈU 20p như bản gốc, nhưng chỉ NÉ 3 đội xấu — bản tối ưu mới nhất.',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Ngay khi nhà cái mở kèo, lúc còn hiệp 1.',
    strategy: [
      'Cùng ý tưởng: line loại trận 20 phút thường hơi cao → đánh XỈU.',
      'Dựa trên dữ liệu 940 trận: chỉ có 3 đội đánh Xỉu hay THUA → NÉ đúng 3 đội đó: Indonesia, Saudi Arabia, Triều Tiên (North Korea).',
      'Các đội còn lại (India, Thái Lan, Iran, Trung Quốc, Qatar, New Zealand, Nhật, Việt Nam…) đều đánh Xỉu tốt → giữ đánh hết.',
      'Khác R2 cũ (né nhầm Nhật + Hàn — hai đội này thật ra vẫn ăn Xỉu).',
    ],
    data: [READ_ODDS, 'Line + giá cửa Xỉu, kèm tên 2 đội để lọc.', GRADE],
    entry: [
      'Trận loại 20 phút · còn hiệp 1 · nhà cái đã mở kèo.',
      'Cả hai đội đều KHÔNG phải Indonesia / Saudi Arabia / Triều Tiên.',
    ],
    note: 'Bản này backtest cho kết quả tốt nhất: thắng ~60%, lời đều cả kỳ. Đang chạy THỬ (chưa đặt tiền) để đối chiếu với các bản khác.',
  },
  'V.Bot 1': {
    emoji: '📈',
    headline: 'Đợi hết hiệp 1, đoán hiệp 2 ghi thêm mấy bàn rồi so với line.',
    side: 'Tài hoặc Xỉu (tuỳ hướng lệch)',
    when: 'Đúng lúc bắt đầu hiệp 2 (nhà cái mở kèo lại). Mỗi trận 1 lệnh.',
    strategy: [
      'Nhìn số bàn đã ghi ở hiệp 1, rồi cộng thêm số bàn hiệp 2 thường ghi (theo lịch sử) → ra TỔNG dự kiến cả trận.',
      'So sánh tổng dự kiến với line nhà cái:',
      '• Dự kiến cao hơn line rõ rệt → đánh TÀI.  • Dự kiến thấp hơn line rõ rệt → đánh XỈU.  • Chênh ít → bỏ qua.',
    ],
    data: [READ_ODDS, HISTORY, GRADE],
    entry: ['Vào đầu hiệp 2, khi mức chênh giữa dự kiến và line đủ lớn.'],
  },
  'V.Bot 2': {
    emoji: '📊',
    headline: 'Đầu hiệp 2, so xác suất bot tính với xác suất mà GIÁ nhà cái ngụ ý.',
    side: 'Tài hoặc Xỉu (cửa nào "giá hời")',
    when: 'Đúng lúc bắt đầu hiệp 2. Mỗi trận 1 lệnh.',
    strategy: [
      'Bot tự tính khả năng thắng cửa Tài (dựa trên lịch sử trận tương tự).',
      'Rồi tính khả năng mà GIÁ nhà cái đang ngụ ý.',
      'Cửa nào bot thấy "giá hời hơn thực tế" (khả năng thắng cao hơn giá phản ánh) thì đánh cửa đó.',
    ],
    data: [READ_ODDS, HISTORY, 'Dùng giá cửa Tài/Xỉu để suy ra nhà cái đang nghĩ khả năng thắng bao nhiêu.', GRADE],
    entry: ['Vào đầu hiệp 2, khi độ lệch giữa tính toán của bot và giá nhà cái đủ lớn.'],
  },
  'V.Bot 5': {
    emoji: '⬇️',
    headline: 'Như V.Bot 1 nhưng CHỈ đánh Xỉu, và né kèo giá bèo.',
    side: 'Chỉ đánh XỈU (Under)',
    when: 'Đúng lúc bắt đầu hiệp 2. Mỗi trận 1 lệnh.',
    strategy: [
      'Cùng cách đoán tổng bàn cả trận như V.Bot 1, nhưng chỉ vào khi kết quả nghiêng về XỈU.',
      'Thêm điều kiện: chỉ đánh khi giá cửa Xỉu không quá thấp (tránh kèo bị "cắt giá").',
    ],
    data: [READ_ODDS, HISTORY, GRADE],
    entry: ['Đầu hiệp 2 · dự kiến nghiêng Xỉu đủ rõ · giá cửa Xỉu chấp nhận được.'],
    note: 'Bot này VÀO ÍT KÈO vì đòi điều kiện chặt — không phải chạy chậm hay bị treo.',
  },
  'V.Bot 7': {
    emoji: '🎯',
    headline: 'Như V.Bot 5 nhưng KHẮT KHE NHẤT — chỉ vào kèo cực chắc.',
    side: 'Chỉ đánh XỈU (Under)',
    when: 'Đúng lúc bắt đầu hiệp 2. Mỗi trận 1 lệnh.',
    strategy: [
      'Giống V.Bot 5 nhưng yêu cầu độ chênh giữa dự kiến và line phải RẤT LỚN mới vào.',
      'Càng chắc mới đánh → số kèo ÍT NHẤT trong tất cả bot.',
    ],
    data: [READ_ODDS, HISTORY, GRADE],
    entry: ['Đầu hiệp 2 · chỉ vào khi cực kỳ chắc (độ chênh rất lớn).'],
    note: 'Đây là bot vào ít kèo nhất hệ thống — đó là lý do trông "chạy chậm", không phải lỗi.',
  },
  'V.Bot 8': {
    emoji: '🔒',
    headline: 'Chỉ đánh Xỉu khi CẢ HAI cách tính đều đồng ý.',
    side: 'Chỉ đánh XỈU (Under)',
    when: 'Đúng lúc bắt đầu hiệp 2. Mỗi trận 1 lệnh.',
    strategy: [
      'Bot dùng 2 cách tính khác nhau để đoán trận này Xỉu hay không.',
      'Chỉ vào khi CẢ HAI cách đều nói "Xỉu" → chắc ăn mới đánh, nên vào rất ít kèo nhưng chất lượng cao.',
    ],
    data: [READ_ODDS, HISTORY, GRADE],
    entry: ['Đầu hiệp 2 · cả 2 cách tính cùng báo Xỉu.'],
  },
  'V.Bot 9': {
    emoji: '⚙️',
    headline: 'Bản V.Bot 5 chỉnh chặt hơn: né mức line hay thua.',
    side: 'Chỉ đánh XỈU (Under)',
    when: 'Đúng lúc bắt đầu hiệp 2. Mỗi trận 1 lệnh.',
    strategy: [
      'Giống V.Bot 5 nhưng đòi độ chênh lớn hơn mới vào.',
      'Tránh các mức line hay thua (khoảng 2.25–2.5).',
      'Vẫn giữ điều kiện giá cửa Xỉu không quá bèo.',
    ],
    data: [READ_ODDS, HISTORY, GRADE],
    entry: ['Đầu hiệp 2 · nghiêng Xỉu đủ mạnh · line ngoài vùng 2.25–2.5 · giá ổn.'],
  },
  'V.Bot 10': {
    emoji: '🇻',
    headline: 'Như V.Bot 9 nhưng CHỈ đánh nhóm trận loại (V).',
    side: 'Chỉ đánh XỈU (Under) · chỉ trận (V)',
    when: 'Đúng lúc bắt đầu hiệp 2. Mỗi trận 1 lệnh.',
    strategy: ['Y hệt V.Bot 9, thêm lọc: chỉ chơi nhóm trận loại (V) — nhóm mà cửa Xỉu lệch mạnh hơn.'],
    data: [READ_ODDS, HISTORY, GRADE],
    entry: ['Như V.Bot 9 · và phải là trận loại (V).'],
  },
  'V.Bot 11': {
    emoji: '🇸',
    headline: 'Như V.Bot 9 nhưng CHỈ đánh nhóm trận loại (S).',
    side: 'Chỉ đánh XỈU (Under) · chỉ trận (S)',
    when: 'Đúng lúc bắt đầu hiệp 2. Mỗi trận 1 lệnh.',
    strategy: ['Y hệt V.Bot 9, thêm lọc: chỉ chơi nhóm trận loại (S) — để so sánh với nhóm (V).'],
    data: [READ_ODDS, HISTORY, GRADE],
    entry: ['Như V.Bot 9 · và phải là trận loại (S).'],
  },
  'Tài Xỉu Live': {
    emoji: '📡',
    headline: 'Đánh THEO TRẬN, bám đúng gợi ý ở tab Xếp hạng Live.',
    side: 'Tài hoặc Xỉu (theo gợi ý live)',
    when: 'Trong lúc trận đang đá, theo tín hiệu thời gian thực.',
    strategy: [
      'Dùng đúng dòng gợi ý VÀO đang hiện trên tab Xếp hạng Live.',
      'Khi trận có thêm bàn (tỉ số mở ra), bot có thể đánh chồng thêm 1 lệnh cùng cửa ở line cao hơn.',
    ],
    data: [READ_ODDS, 'Dùng đúng cách tính của tab Xếp hạng Live.', GRADE],
    entry: ['Theo gợi ý live · mỗi hiệp 1 lệnh chính · đánh thêm khi tỉ số mở qua line vừa thắng.'],
  },
  'TX v8.0 · lineDrift': {
    emoji: '🌊',
    headline: 'Nhìn nhà cái KÉO LINE về đâu thì đánh theo hướng đó.',
    side: 'Tài hoặc Xỉu (theo hướng nhà cái kéo)',
    when: 'Trong lúc trận đang đá, khi line dịch chuyển đủ mạnh.',
    strategy: [
      'Theo dõi line Tài/Xỉu của nhà cái thay đổi trong trận.',
      'Nhà cái kéo line LÊN (đẩy về Tài) → bot đánh TÀI. Kéo line XUỐNG → bot đánh XỈU.',
      'Kèm vài bộ lọc (đủ dữ liệu đối đầu, giá không bèo, có lợi thế thật) để bỏ kèo rác.',
    ],
    data: [READ_ODDS, 'Theo dõi line thay đổi trong suốt trận + lịch sử đối đầu 2 đội.', GRADE],
    entry: ['Line dịch đủ mạnh · qua các bộ lọc an toàn.'],
  },
};

const GENERIC: TxRule = {
  emoji: '🤖',
  headline: 'Bot Tài/Xỉu — chưa có mô tả riêng cho phiên bản này.',
  side: '—',
  when: '—',
  strategy: ['Phiên bản này chưa có ghi chú rule trong dashboard.'],
  data: [READ_ODDS, GRADE],
  entry: ['—'],
};

export function getTxRule(calcVersion: string): TxRule {
  return TX_RULES[calcVersion] ?? GENERIC;
}
