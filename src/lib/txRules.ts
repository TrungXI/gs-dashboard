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
  when: 'Đợi 30 giây (thời gian thật) kể từ lúc thấy trận, rồi CHỈ vào khi nhà cái mở kèo (không khóa) VÀ tỉ số vẫn 0-0. Nếu tới phút 15 (đồng hồ trong trận) mà vẫn chưa vào được, HOẶC trận đã có bàn thắng, thì BỎ trận.',
  strategy: [
    'Ý tưởng: ở loại trận 20 phút (nhóm V — nhiều bàn), nhà cái thường ra line HƠI CAO so với số bàn thực tế → cửa XỈU có lợi thế.',
    'So sánh: line trung bình nhà cái đưa ~3,69 bàn, nhưng thực tế các trận này trung bình chỉ ~3,56 bàn.',
    'CHỈ VÀO KHI 0-0 (rule mới, quan trọng nhất): dữ liệu cho thấy vào lúc trận CÒN 0-0 mới có lãi (~+2,6%); vào SAU khi đã có bàn thì THUA nặng (1 bàn ≈ −4%, 2 bàn ≈ −6%, 3+ bàn ≈ −12%). Vì vậy đã có bàn là BỎ, không vào nữa.',
    'NÉ các đội đánh Xỉu hay thua theo BLACKLIST ĐỘNG (xem mục 🚫 ở trên) — đổi tức thời qua Telegram /setblacklist, KHÔNG cần sửa code/restart; cả 4 con Real áp chung.',
    'Các đội còn lại đều đánh Xỉu tốt → giữ đánh hết. Blacklist được job 22h tối rà soát ROI 28 ngày/đội và gợi ý thêm/bớt.',
    'Mỗi trận chỉ vào đúng 1 lệnh, giữ tới hết trận (không cắt lời/lỗ giữa chừng), tiền cố định mỗi lệnh.',
  ],
  data: [
    READ_ODDS,
    'Line + giá cửa Xỉu nhà cái đang mở ở trận loại 20 phút, kèm tên 2 đội để lọc, tỉ số hiện tại, và phút trận đang đá.',
    GRADE,
  ],
  entry: [
    'Trận đang đá, đúng loại 20 phút, còn trong hiệp 1.',
    'CHỈ VÀO KHI TỈ SỐ 0-0: nhà cái vừa mở khóa mà tỉ số VẪN 0-0 mới đánh. Đã có bàn (1-0, 0-1, 2-1…) → BỎ HẲN, không vào nữa.',
    'CHỜ ĐẦU: đủ 30 giây THẬT (thời gian thực) kể từ lúc bot thấy trận — né lúc giá vừa mở còn nhảy. (Tính theo giây thật, KHÔNG theo đồng hồ trận chạy nhanh.)',
    'CẤM TRỄ: nếu tới phút 15 theo ĐỒNG HỒ TRONG TRẬN mà vẫn chưa vào được → BỎ HẲN trận (không đánh nữa, kể cả sau đó mới mở kèo).',
    'Lúc đặt lệnh: nhà cái phải đang MỞ KÈO thật, có line + giá Xỉu rõ ràng, KHÔNG bị khóa/tạm ngưng (khóa thì thà bỏ lỡ còn hơn vào mà người theo không vào được).',
    'Cả hai đội đều KHÔNG nằm trong blacklist động hiện tại (xem mục 🚫 ở trên).',
  ],
  note: 'Bot đặt TIỀN THẬT. Lệnh trong group: /setmoney <số> (tiền mỗi lệnh) · /pnl (lãi/lỗ hôm nay) · /balance (số dư) · /start /stop (bật/tắt đặt lệnh) · /settoken 69-… (cập nhật token khi hết hạn) · /info (xem cấu hình + lệnh). Blacklist đội: owner gõ /blacklist (xem) · /setblacklist <đội…> (đổi, áp cả 4 con Real).',
  short: '💰 TIỀN THẬT · XỈU trận 20p (V) · CHỈ vào khi 0-0 · chờ 30s THẬT rồi vào khi book mở (không khóa) · quá phút 15 (đồng hồ trận) chưa vào thì bỏ · né đội theo blacklist động · 1 lệnh/trận.',
};

export const TX_RULES: Record<string, TxRule> = {
  'V.Bot 12 Real': VBOT12_REAL_RULE,
  'V.Bot 12 Kien': {
    ...VBOT12_REAL_RULE,
    headline: 'Y hệt bản tiền thật, nhưng chạy trên VÍ RIÊNG của Kiên (group + token + tiền tách biệt).',
    note: 'Bot đặt TIỀN THẬT trên ví Kiên — độc lập với ví gốc (token/stake/số dư riêng). Lệnh trong group Kiên: /setmoney · /pnl · /pnltotal · /balance · /start /stop · /settoken 69-… · /info. /settoken ở đây KHÔNG đụng token bot gốc / group khác.',
  },
  'V.Bot 12 Trong': {
    ...VBOT12_REAL_RULE,
    headline: 'Y hệt bản tiền thật, nhưng chạy trên VÍ RIÊNG của Trọng (group + token + tiền tách biệt).',
    note: 'Bot đặt TIỀN THẬT trên ví Trọng — độc lập hoàn toàn (token/stake/số dư/PnL riêng). Lệnh trong group Trọng: /setmoney · /pnl · /pnltotal · /balance · /start /stop · /settoken 69-… · /info. /settoken ở đây KHÔNG đụng token gốc / Kiên / Nam.',
  },
  'V.Bot 12 Nam': {
    ...VBOT12_REAL_RULE,
    headline: 'Y hệt bản tiền thật, nhưng chạy trên VÍ RIÊNG của Nam (group + token + tiền tách biệt).',
    note: 'Bot đặt TIỀN THẬT trên ví Nam — độc lập hoàn toàn (token/stake/số dư/PnL riêng). Lệnh trong group Nam: /setmoney · /pnl · /pnltotal · /balance · /start /stop · /settoken 69-… · /info. /settoken ở đây KHÔNG đụng token gốc / Kiên / Trọng.',
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
    headline: 'Đánh XỈU 20p, NÉ 3 đội xấu — chạy CÙNG logic vào kèo với 2 con tiền thật.',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Đợi 30 giây (thời gian thật) từ lúc thấy trận rồi CHỈ vào khi nhà cái mở kèo (không khóa) VÀ tỉ số vẫn 0-0. Quá phút 15 (đồng hồ trong trận) chưa vào được, hoặc trận đã có bàn, thì BỎ trận.',
    strategy: [
      'Cùng ý tưởng: line loại trận 20 phút thường hơi cao → đánh XỈU.',
      'CHỈ VÀO KHI 0-0 (rule mới): vào lúc còn 0-0 mới lãi; có bàn rồi thì thua → có bàn là BỎ.',
      'Dựa trên dữ liệu 940 trận: chỉ có 3 đội đánh Xỉu hay THUA → NÉ đúng 3 đội đó: Indonesia, Saudi Arabia, Triều Tiên (North Korea).',
      'Các đội còn lại (India, Thái Lan, Iran, Trung Quốc, Qatar, New Zealand, Nhật, Việt Nam…) đều đánh Xỉu tốt → giữ đánh hết.',
      'Đã đồng bộ logic vào kèo giống hệt 4 con tiền thật (gate 0-0 + chờ 30s thật + cấm phút 15) để làm mốc đối chiếu chuẩn.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Xỉu, kèm tên 2 đội để lọc, tỉ số hiện tại, và phút trận.', GRADE],
    entry: [
      'Trận loại 20 phút · còn hiệp 1 · nhà cái đã mở kèo (không khóa).',
      'CHỈ vào khi tỉ số 0-0 — đã có bàn thì BỎ.',
      'Đủ 30 giây thật từ lúc thấy trận; chưa quá phút 15 (đồng hồ trận).',
      'Cả hai đội đều KHÔNG phải Indonesia / Saudi Arabia / Triều Tiên.',
    ],
    note: 'Bản backtest tốt nhất (~60% thắng). Chạy THỬ (chưa đặt tiền) — giờ vào kèo y hệt 2 con tiền thật để so kết quả cho công bằng.',
  },
  'V.Bot 12 R4-C': {
    emoji: '🧪',
    headline: 'Giống R4-B nhưng chỉ NÉ 2 đội (KHÔNG né Triều Tiên) — bản thử đối chiếu.',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Sau khi nhà cái mở kèo, đợi 30 giây thật rồi CHỈ vào khi tỉ số vẫn 0-0. Quá phút 15 (đồng hồ trận) chưa vào được, hoặc đã có bàn, thì bỏ.',
    strategy: [
      'Cùng ý tưởng: line loại trận 20 phút thường hơi cao → đánh XỈU.',
      'CHỈ VÀO KHI 0-0 (rule mới): vào lúc còn 0-0 mới lãi; có bàn rồi thì thua → có bàn là BỎ.',
      'Chỉ NÉ 2 đội: Indonesia và Saudi Arabia. BỎ Triều Tiên khỏi danh sách né (đội này thực ra chỉ ~hòa vốn, né nó là bắt nhiễu).',
      'Khác R4-B (né 3 đội): R4-C thử xem BỎ né Triều Tiên có lời hơn không.',
      'Các đội còn lại (gồm cả Triều Tiên) đánh Xỉu bình thường, mỗi trận 1 lệnh.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Xỉu, kèm tên 2 đội để lọc, tỉ số hiện tại.', GRADE],
    entry: [
      'Trận loại 20 phút · còn hiệp 1 · nhà cái mở kèo (không khóa).',
      'CHỈ vào khi tỉ số 0-0 — đã có bàn thì BỎ.',
      'Cả hai đội đều KHÔNG phải Indonesia / Saudi Arabia (Triều Tiên VẪN đánh).',
    ],
    note: 'Chạy THỬ (chưa đặt tiền) để đối chiếu R4-B (né 3 đội) vs R4-C (né 2 đội) — xem né Triều Tiên có đáng không.',
  },
  'V.Bot 13 R2': {
    emoji: '🥇',
    headline: 'CHỈ đánh XỈU khi trận có 1 trong 4 ĐỘI được chọn, vào lúc 0-0 — bản CHÍNH, backtest tốt nhất trên nhiều kèo.',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Vào lúc trận còn 0-0 đầu hiệp 1: chờ 30 giây thật rồi vào khi nhà cái mở kèo (không khóa); quá phút 15 (đồng hồ trận) chưa vào, hoặc đã có bàn, thì BỎ.',
    strategy: [
      'Ý tưởng MỚI (phân tích lại toàn bộ dữ liệu 2026-08-04): thay vì đánh mọi trận rồi né đội xấu, CHỈ đánh khi trận có mặt 1 trong 4 đội mà nhà cái định giá Xỉu SAI một cách bền vững.',
      '4 đội whitelist: Laos, India, Iran, New Zealand. Trận KHÔNG có đội nào trong 4 đội này → BỎ, không đánh.',
      'Đánh cả 2 loại trận: 20 phút (V) và 16 phút (S).',
      'Backtest 1378 kèo: thắng 58,5%, ROI +8,92% — dương CẢ 2 nửa VÀ cả 3 phần ba thời gian (bền, khó overfit). So bot thật hiện tại (né 3 đội) chỉ +3,52% và 1/3 data đầu bị ÂM.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Xỉu, tên 2 đội (để lọc whitelist), tỉ số hiện tại, phút trận.', GRADE],
    entry: [
      'Trận còn hiệp 1, tỉ số 0-0, nhà cái đang mở kèo (không khóa).',
      'Có ÍT NHẤT 1 trong 4 đội: Laos / India / Iran / New Zealand.',
      'Chờ đủ 30 giây thật; chưa quá phút 15 (đồng hồ trận).',
    ],
    note: 'PAPER — CHẠY THỬ, KHÔNG đặt tiền, KHÔNG bắn Telegram (chạy ngầm). Đang forward-test để so với bot thật trước khi cân nhắc lên tiền. Iran là đội cần canh kỹ nhất (nửa đầu dữ liệu mỏng).',
    short: '🥇 PAPER · XỈU 0-0 · whitelist Laos/India/Iran/New Zealand · 20p+16p · backtest +8,92% (WR 58,5%).',
  },
  'V.Bot 13 R1': {
    emoji: '🧪',
    headline: 'Giống R2 nhưng CHỈ trận 20 phút và BỎ Laos — thu về 3 đội, an toàn hơn (không phụ thuộc giải S).',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Vào lúc 0-0 đầu hiệp 1: chờ 30 giây thật rồi vào khi nhà cái mở kèo; quá phút 15, hoặc đã có bàn, thì BỎ.',
    strategy: [
      'Cùng ý tưởng whitelist với R2 nhưng thu hẹp: chỉ 3 đội India, Iran, New Zealand (BỎ Laos — vì Laos thuộc giải S, là 1 nguồn đơn lẻ, muốn tránh rủi ro).',
      'Chỉ đánh loại trận 20 phút (V).',
      'Backtest 1080 kèo: thắng 57,8%, ROI +7,79% — vẫn dương cả 2 nửa + 3 phần ba. Dễ tích hợp chung luồng 20p sẵn có.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Xỉu, tên 2 đội, tỉ số hiện tại, phút trận.', GRADE],
    entry: [
      'Trận 20 phút, còn hiệp 1, tỉ số 0-0, nhà cái mở kèo.',
      'Có ÍT NHẤT 1 trong 3 đội: India / Iran / New Zealand.',
      'Chờ đủ 30 giây thật; chưa quá phút 15.',
    ],
    note: 'PAPER — chạy thử, không tiền, không Telegram. Bản whitelist an toàn nhất (không dính giải S).',
    short: '🧪 PAPER · XỈU 0-0 · whitelist India/Iran/New Zealand · chỉ 20p · backtest +7,79%.',
  },
  'V.Bot 13 R3': {
    emoji: '🏆',
    headline: 'Bản TỐI ĐA: whitelist 4 đội VÀ né 3 đội xấu cùng lúc — ROI backtest cao nhất, nhưng ít kèo hơn.',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Vào lúc 0-0 đầu hiệp 1: chờ 30 giây thật rồi vào khi nhà cái mở kèo; quá phút 15, hoặc đã có bàn, thì BỎ.',
    strategy: [
      'Chồng 2 lớp lọc "edge thật": (1) trận phải có 1 trong 4 đội whitelist (Laos/India/Iran/New Zealand), VÀ (2) né 3 đội xấu (Indonesia/Saudi Arabia/Triều Tiên) — nếu 1 trong 2 đội là đội xấu thì BỎ.',
      'Chỉ đánh loại trận 20 phút (V).',
      'Backtest 808 kèo: thắng 58,4%, ROI +10,36% — CAO NHẤT và ổn nhất (dương cả 3 phần ba). Đánh đổi: ít kèo hơn 2 con kia.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Xỉu, tên 2 đội (lọc whitelist + né đội xấu), tỉ số, phút trận.', GRADE],
    entry: [
      'Trận 20 phút, còn hiệp 1, tỉ số 0-0, nhà cái mở kèo.',
      'Có 1 trong 4 đội whitelist VÀ cả 2 đội KHÔNG phải Indonesia / Saudi Arabia / Triều Tiên.',
      'Chờ đủ 30 giây thật; chưa quá phút 15.',
    ],
    note: 'PAPER — chạy thử, không tiền, không Telegram. ROI backtest cao nhất (+10,36%) nhưng mẫu nhỏ nhất → cần forward-test lâu hơn để chắc.',
    short: '🏆 PAPER · XỈU 0-0 · whitelist 4 đội ∩ né 3 đội xấu · 20p · backtest +10,36% (cao nhất).',
  },
  'V.Bot 14': {
    emoji: '🌀',
    headline: 'Kèo RUNG: cuối mỗi hiệp nếu trận đang tịt (ít bàn) thì đánh TÀI, kỳ vọng có bàn muộn. Chạy THỬ (paper).',
    side: 'Đánh TÀI (Over)',
    when: 'Mỗi hiệp: phút 29 cắm cờ, phút 34 vào lệnh (thang 45 phút/hiệp, tính riêng từng hiệp).',
    strategy: [
      'Ý tưởng (mean-reversion): về cuối hiệp mà vẫn ít bàn → khả năng dồn 1 bàn muộn → đánh TÀI.',
      'Phút 29: nếu kèo XỈU của hiệp đó đang trả giá ≥ 0,7 (thị trường nghiêng ít bàn) → cắm cờ + ghi tỉ số lúc đó.',
      'Từ phút 29 đến 34: nếu KHÔNG ghi thêm bàn nào (tỉ số giữ nguyên) mới xét vào.',
      'Phút 34: nếu có mức kèo cao hơn tỉ số hiện tại đúng 0,5 hoặc 0,75 bàn → đánh TÀI mức đó (ưu tiên 0,5 vì gần tỉ số, dễ ăn hơn).',
      'Cả 2 hiệp canh riêng, mỗi hiệp tối đa 1 lệnh. Có bàn giữa chừng → HUỶ. Nhà cái khoá kèo → thử lại tối đa 3 lần.',
    ],
    data: [READ_ODDS, 'Line + giá Tài/Xỉu của hiệp đang đá, tỉ số hiện tại, phút trong hiệp.', 'Chấm: hiệp 1 theo bàn hiệp 1; hiệp 2 theo tổng bàn cả trận.'],
    entry: [
      'Phút 29 của hiệp: có kèo Xỉu giá ≥ 0,7 → cắm cờ + ghi tỉ số.',
      'Phút 29→34 không có bàn mới.',
      'Phút 34: có mức kèo cao hơn tỉ số 0,5 hoặc 0,75 bàn, nhà cái đang mở kèo → vào TÀI.',
    ],
    note: 'PAPER — chạy thử, không tiền, không Telegram. Chiến lược MỚI, chưa backtest — đang dò dữ liệu.',
    short: '🌀 PAPER · kèo RUNG · mỗi hiệp: phút 29 cắm cờ (Xỉu≥0,7), phút 34 vào TÀI mức gap 0,5/0,75 nếu chưa có bàn.',
  },
  'V.Bot 14 Real': {
    emoji: '💥',
    headline: 'Y hệt kèo RUNG của V.Bot 14 nhưng ĐẶT TIỀN THẬT trên ví riêng (group Rung Tài).',
    side: 'Đánh TÀI (Over) — tiền thật',
    when: 'Mỗi hiệp: phút 29 cắm cờ, phút 34 vào lệnh (cả hiệp 1 và hiệp 2).',
    strategy: [
      'Cùng luật kèo rung với V.Bot 14: phút 29 cắm cờ khi Xỉu ≥ 0,7; phút 34 vào TÀI mức gap 0,5/0,75 nếu 29→34 không thêm bàn.',
      'Đặt lệnh TÀI THẬT trên sb21 (cửa Over) — ví/token/tiền RIÊNG của group Rung Tài, độc lập hoàn toàn với 4 con XỈU.',
      'Có bàn giữa chừng → HUỶ. Nhà cái khoá → thử lại 3 lần. Mỗi hiệp tối đa 1 lệnh.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Tài của hiệp, tỉ số, phút trong hiệp.', 'Chấm theo kết quả thật trên sb21.'],
    entry: [
      'Phút 29: kèo Xỉu ≥ 0,7 → cắm cờ.',
      'Phút 29→34 không thêm bàn.',
      'Phút 34: có mức gap 0,5/0,75 trên tỉ số, nhà cái mở kèo → đặt TÀI thật.',
    ],
    note: 'Bot đặt TIỀN THẬT trên ví Rung Tài — độc lập (token/stake/số dư/PnL riêng). Lệnh trong group: /setmoney · /pnl · /balance · /start /stop · /settoken 69-… · /info. ⚠️ Cửa TÀI + chiến lược CHƯA validate → rủi ro cao; mặc định TẮT tới khi /settoken + /setmoney + /start.',
    short: '💥 TIỀN THẬT · kèo RUNG TÀI (group Rung Tài) · phút 29 cắm cờ Xỉu≥0,7, phút 34 vào TÀI gap 0,5/0,75 · cả H1+H2 · ⚠️ chưa validate.',
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
