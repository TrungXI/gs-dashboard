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

// Rule bot đặt TIỀN THẬT — dùng chung cho cả 4 con V.Bot 12 (Real/Kien/Trong/Nam).
// 2026-08-07: chuyển sang model PAIRING-WHITELIST (env PAIR_WL=1) — CHỈ đánh khi gặp đúng 4 cặp,
// BỎ hết whitelist/blacklist/pairing per-đội. File chung tx-paper-bot-vbot12real-r4d.mjs.
const VBOT12_REAL_RULE: TxRule = {
  emoji: '💰',
  headline: 'Đánh XỈU trận 20 phút — CHỈ vào khi CẶP đang đá nằm trong danh sách whitelist ĐỘNG (đã BỎ hết whitelist/blacklist/pairing per-đội). ĐẶT TIỀN THẬT.',
  side: 'Luôn đánh XỈU (Under)',
  when: 'Đợi 30 giây (thời gian thật) kể từ lúc thấy trận, rồi CHỈ vào khi nhà cái mở kèo (không khóa) VÀ tỉ số vẫn 0-0. Tới phút 12 (đồng hồ trận) chưa vào được, HOẶC đã có ≥2 bàn, thì BỎ trận.',
  strategy: [
    'MODEL HIỆN TẠI — PAIRING-WHITELIST: CHỈ đánh khi CẶP đang đá nằm trong danh sách whitelist ĐỘNG (cặp có ROI Xỉu dương) — xem box 🎯 ở trên (cập nhật live). Cặp KHÁC → BỎ HẲN.',
    'Danh sách cặp là ĐỘNG — set qua Telegram /setpairwl, xem list hiện tại ở box 🎯 phía trên. File pair-whitelist-r4d.json (reload 5s, áp cả 4 con Real).',
    'ĐÃ BỎ toàn bộ lọc per-đội cũ: KHÔNG whitelist ≥1 đội, KHÔNG blacklist đội, KHÔNG pairing-blacklist, KHÔNG bỏ line 3.0. Pairing-whitelist là gate DUY NHẤT.',
    'Vì sao dùng pairing-whitelist: audit 28 ngày — whitelist per-đội nhồi nhiều cặp lạ chỉ +9,2% và có vùng "đánh mù" lỗ; chỉ giữ nhóm cặp Xỉu dương chắc. Đánh đổi: volume thấp hơn đổi lấy độ chắc.',
    'GATE BÀN (mới, user 2026-08-09): vào khi tổng bàn ≤1 (0-0 hoặc mới 1 trái) — vì nhà cái mở kèo trễ (~phút 9) hay đã 1 trái; đã có ≥2 bàn thì BỎ (tổng cao, cửa Xỉu hẹp). Chỉnh qua env MAX_SCORE_AT_ENTRY.',
    'Mỗi trận đúng 1 lệnh, giữ tới hết trận (không cắt giữa chừng), tiền cố định.',
    'Song song có 2 con PAPER gom data mở rộng cặp: "V.Bot 12 Test Full" (đánh mọi trận) + "V.Bot 12 Test Whitelist" (mirror danh sách whitelist động).',
  ],
  data: [
    READ_ODDS,
    'Line + giá cửa Xỉu trận 20 phút, tên 2 đội (khớp cặp trong whitelist), tỉ số hiện tại, phút trận đang đá.',
    GRADE,
  ],
  entry: [
    'Trận đang đá, đúng loại 20 phút, còn trong hiệp 1.',
    'CẶP đang đá PHẢI nằm trong danh sách whitelist động (box 🎯 ở trên). Cặp khác → BỎ HẲN.',
    'CHỈ VÀO KHI ≤1 BÀN: nhà cái vừa mở khóa mà tổng bàn 0 hoặc 1 mới đánh. Đã có ≥2 bàn → BỎ.',
    'CHỜ ĐẦU: đủ 30 giây THẬT kể từ lúc bot thấy trận (né lúc giá vừa mở còn nhảy).',
    'CẤM TRỄ: quá phút 12 (đồng hồ trận) chưa vào được → BỎ HẲN.',
    'Lúc đặt lệnh: nhà cái phải đang MỞ KÈO thật (không khóa/suspended), có line + giá Xỉu rõ ràng.',
  ],
  note: 'Bot đặt TIỀN THẬT — model PAIRING-WHITELIST (cặp trong whitelist động, env PAIR_WL=1). Volume thấp/độ chắc cao; 2 con paper (Test Full + Test Whitelist) chạy song song gom data mở rộng cặp. Lệnh group: /setmoney <số> · /pnl · /balance · /start /stop · /settoken 69-… · /info.',
  short: '💰 TIỀN THẬT · XỈU trận 20p · CHỈ cặp trong whitelist động (xem box 🎯) · vào khi ≤1 bàn · chờ 30s · quá phút 12 bỏ · 1 lệnh/trận.',
};

// Rule con V.Bot 17 — đánh TÀI, CHỈ đánh cặp trong pair-blacklist ("nổ Tài"). Mirror ngược V.Bot 12 whitelist.
const VBOT17_RULE: TxRule = {
  emoji: '⬆️',
  headline: 'Đánh TÀI (Over) trận 20 phút — CHỈ vào khi CẶP đang đá nằm trong danh sách BLACKLIST (cặp hay nổ Tài). Mirror ngược con Xỉu-whitelist.',
  side: 'Luôn đánh TÀI (Over)',
  when: 'Chỉ vào khi tỉ số 0-0, VÀO NGAY khi nhà cái mở kèo (KHÔNG chờ 30s, không khóa); quá phút 15 (đồng hồ trận) chưa vào được hoặc đã có bàn thì BỎ.',
  strategy: [
    'PAIRING-BLACKLIST = "whitelist" của con này: CHỈ đánh TÀI khi CẶP đang đá nằm trong danh sách cặp NỔ TÀI — xem box 🎯 ở trên. Cặp khác → BỎ HẲN.',
    'Danh sách cặp lấy từ backtest FT (tổng bàn THẬT gs_matches_history vs line mở kèo 0-0): cặp Xỉu-kém = Tài-tốt. Đổi qua Telegram /setpairbl (reload 5s) hoặc nút "Set blacklist" trang 📈 Cặp WL/BL.',
    'Bỏ hết lọc per-đội (whitelist/blacklist theo ĐỘI). Gate DUY NHẤT: cặp phải nằm trong list blacklist.',
    'CHỈ vào khi tỉ số 0-0, vào NGAY khi book mở (đã bỏ chờ 30s). Mỗi trận 1 lệnh, giữ tới hết trận, tiền cố định.',
    'Đây là MIRROR NGƯỢC của V.Bot 12 Test Whitelist (Xỉu, cặp whitelist) — để so edge 2 chiều.',
  ],
  data: [READ_ODDS, 'Line + giá cửa TÀI (Over) trận 20 phút, tên 2 đội (khớp list blacklist), tỉ số, phút trận.', GRADE],
  entry: [
    'Trận 20 phút, hiệp 1, nhà cái mở kèo (không khóa), tỉ số 0-0.',
    'CẶP đang đá PHẢI nằm trong danh sách blacklist (box 🎯 ở trên). Cặp khác → BỎ.',
    'Vào NGAY khi book mở (KHÔNG chờ 30s); chưa quá phút 15.',
  ],
  note: 'Model TÀI-blacklist. Đổi cặp qua /setpairbl hoặc trang 📈. Áp cả V.Bot 17 Real + Kiên + Test.',
  short: '⬆️ TÀI trận 20p · CHỈ cặp trong blacklist (nổ Tài) · vào 0-0 · VÀO NGAY (ko chờ) · quá phút 15 bỏ · 1 lệnh/trận.',
};

export const TX_RULES: Record<string, TxRule> = {
  'V.Bot 17 Real': {
    ...VBOT17_RULE,
    emoji: '💰',
    headline: 'ĐẶT TIỀN THẬT — đánh TÀI trận 20 phút, CHỈ cặp trong blacklist (nổ Tài). Mirror ngược con Xỉu-whitelist.',
    note: 'Bot đặt TIỀN THẬT — model TÀI-blacklist (chỉ đánh cặp trong pair-blacklist). Ví/token RIÊNG (group Real ⬆️ Blacklist). Lệnh: /setmoney · /pnl · /balance · /start /stop · /settoken 69-… · /info. Đổi cặp: /setpairbl hoặc nút Set trang 📈.',
    short: '💰 TIỀN THẬT · ⬆️ TÀI 20p · CHỈ cặp blacklist · vào 0-0 · VÀO NGAY (ko chờ) · quá phút 15 bỏ · 1 lệnh/trận.',
  },
  'V.Bot 17 Real Kien': {
    ...VBOT17_RULE,
    emoji: '💰',
    headline: 'Y hệt V.Bot 17 Real (TÀI, cặp blacklist) nhưng chạy trên VÍ RIÊNG của Kiên (group + token + tiền tách biệt).',
    note: 'Bot đặt TIỀN THẬT trên ví Kiên — model TÀI-blacklist, độc lập hoàn toàn (token/stake/số dư riêng). Lệnh trong group Kiên: /setmoney · /pnl · /balance · /start /stop · /settoken 69-… · /info. /settoken KHÔNG đụng ví khác.',
    short: '💰 TIỀN THẬT (ví Kiên) · ⬆️ TÀI 20p · CHỈ cặp blacklist · vào 0-0 · 1 lệnh/trận.',
  },
  'V.Bot 17 Test BlackList': {
    ...VBOT17_RULE,
    emoji: '🎯',
    headline: 'PAPER: đánh TÀI, CHỈ cặp trong blacklist — mirror ngược V.Bot 12 Test Whitelist. Khác 2 con Real: CHỜ 10 GIÂY thực rồi mới check.',
    when: 'CHỜ 10 GIÂY THỰC kể từ lúc thấy trận, rồi mới xét: tỉ số vẫn 0-0? nhà cái đã mở kèo? → vào TÀI. Quá phút 15 hoặc đã có bàn hoặc book khóa lúc đó → BỎ. (2 con Real thì vào NGAY, không chờ.)',
    note: 'PAPER — không tiền, không Telegram, chỉ ghi DB. Cùng model TÀI-blacklist với 2 con Real nhưng CHỜ 10s (Real vào ngay) — để so timing.',
    short: '🎯 PAPER · ⬆️ TÀI 20p · CHỈ cặp blacklist · vào 0-0 · CHỜ 10s (Real vào ngay) · mirror ngược Test Whitelist.',
  },
  'V.Bot 12 Real': VBOT12_REAL_RULE,
  'V.Bot 12 Kien': {
    ...VBOT12_REAL_RULE,
    headline: 'Y hệt bản tiền thật (model 4 cặp whitelist), nhưng chạy trên VÍ RIÊNG của Kiên (group + token + tiền tách biệt).',
    note: 'Bot đặt TIỀN THẬT trên ví Kiên — model 4 cặp whitelist (PAIR_WL, chỉ đánh khi gặp đúng 4 cặp), độc lập với ví gốc (token/stake/số dư riêng). Lệnh trong group Kiên: /setmoney · /pnl · /pnltotal · /balance · /start /stop · /settoken 69-… · /info. /settoken ở đây KHÔNG đụng token bot gốc / group khác.',
  },
  'V.Bot 12 Trong': {
    ...VBOT12_REAL_RULE,
    headline: 'Y hệt bản tiền thật (model 4 cặp whitelist), nhưng chạy trên VÍ RIÊNG của Trọng (group + token + tiền tách biệt).',
    note: 'Bot đặt TIỀN THẬT trên ví Trọng — model 4 cặp whitelist (PAIR_WL, chỉ đánh khi gặp đúng 4 cặp), độc lập hoàn toàn (token/stake/số dư/PnL riêng). Lệnh trong group Trọng: /setmoney · /pnl · /pnltotal · /balance · /start /stop · /settoken 69-… · /info. /settoken ở đây KHÔNG đụng token gốc / Kiên / Nam.',
  },
  'V.Bot 12 Nam': {
    ...VBOT12_REAL_RULE,
    headline: 'Y hệt bản tiền thật (model 4 cặp whitelist), nhưng chạy trên VÍ RIÊNG của Nam — con V.Bot 12 Xỉu (KHÁC hẳn V.Bot 14 Real Nam đánh Tài).',
    note: 'Bot đặt TIỀN THẬT trên ví Nam (V.Bot 12 Xỉu) — model 4 cặp whitelist (PAIR_WL, chỉ đánh khi gặp đúng 4 cặp), độc lập hoàn toàn (token/stake/số dư/PnL riêng). ⚠️ ĐỪNG nhầm với V.Bot 14 Real Nam (đánh TÀI, ví khác). Lệnh trong group Nam V12: /setmoney · /pnl · /pnltotal · /balance · /start /stop · /settoken 69-… · /info.',
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
    headline: 'Đánh XỈU 20p, NÉ đội theo BLACKLIST ĐỘNG — chạy ngầm CÙNG blacklist với 4 con tiền thật.',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Đợi 30 giây (thời gian thật) từ lúc thấy trận rồi CHỈ vào khi nhà cái mở kèo (không khóa) VÀ tỉ số vẫn 0-0. Quá phút 15 (đồng hồ trong trận) chưa vào được, hoặc trận đã có bàn, thì BỎ trận.',
    strategy: [
      'Cùng ý tưởng: line loại trận 20 phút thường hơi cao → đánh XỈU.',
      'CHỈ VÀO KHI 0-0: vào lúc còn 0-0 mới lãi; có bàn rồi thì thua → có bàn là BỎ.',
      'NÉ các đội theo BLACKLIST ĐỘNG (xem mục 🚫 ở trên) — dùng CHUNG file blacklist với 4 con tiền thật, đổi qua Telegram /setblacklist là R4-B áp trong ~5s (không restart).',
      'Chạy ngầm cùng blacklist động để làm MỐC ĐỐI CHIẾU paper cho luồng tiền thật.',
      'Đã đồng bộ logic vào kèo giống hệt 4 con tiền thật (gate 0-0 + chờ 30s thật + cấm phút 15).',
    ],
    data: [READ_ODDS, 'Line + giá cửa Xỉu, kèm tên 2 đội để lọc theo blacklist động, tỉ số hiện tại, và phút trận.', GRADE],
    entry: [
      'Trận loại 20 phút · còn hiệp 1 · nhà cái đã mở kèo (không khóa).',
      'CHỈ vào khi tỉ số 0-0 — đã có bàn thì BỎ.',
      'Đủ 30 giây thật từ lúc thấy trận; chưa quá phút 15 (đồng hồ trận).',
      'Cả hai đội đều KHÔNG nằm trong blacklist động hiện tại (xem mục 🚫 ở trên).',
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
  'V.Bot 12 R4-D': {
    emoji: '🧬',
    headline: 'R4-B + 2 lọc MỚI: chỉ đánh khi có ≥1 đội whitelist VÀ bỏ line mở 3.0 — chạy ngầm ĐỐI CHIẾU với 4 con tiền thật (cùng model R4D).',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Đợi 30 giây thật từ lúc thấy trận rồi CHỈ vào khi nhà cái mở kèo (không khóa) VÀ tỉ số vẫn 0-0. Quá phút 15 (đồng hồ trận) chưa vào, hoặc đã có bàn, thì BỎ.',
    strategy: [
      'Nền tảng R4-B: line loại trận 20 phút thường hơi cao → đánh XỈU; CHỈ vào khi 0-0; né đội theo BLACKLIST ĐỘNG (mục 🚫).',
      'LỌC MỚI 1 — WHITELIST ĐỘNG: trận phải có ÍT NHẤT 1 đội trong whitelist (mục 🟢, mặc định India/New Zealand/Iran/China/Qatar/Vietnam/Indonesia). Cả 2 đội ngoài whitelist → BỎ. Đổi qua /setwhitelist (~5s, không restart).',
      'LỌC MỚI 2 — BỎ LINE MỞ 3.0: nhà cái mở đúng line 3.0 thì KHÔNG vào (mức này backtest lỗ ~−4%).',
      'LỌC MỚI 3 — PAIRING BLACKLIST động (2026-08-07): bỏ CẶP đấu H2H Xỉu kém dù đội ∈ whitelist (vd Iran vs North Korea nổ TB 4.77 bàn → Xỉu chỉ 26%). File pair-blacklist-r4d.json, đổi qua /setpairbl, reload 5s.',
      'Backtest: whitelist ≥1 đội tốt kéo ROI −0,4%→+3,6% (giữ ~78% volume); bỏ line 3.0 cắt −4%; bỏ 11 cặp xấu ước nhấc Xỉu 52,3%→~56% (in-sample).',
      'Đây CHÍNH là model đang gắn cho 4 con tiền thật V.Bot 12 (Real/Kien/Trong/Nam); bản paper này chạy ngầm để đối chiếu công bằng.',
    ],
    data: [READ_ODDS, 'Line + giá Xỉu, tên 2 đội (lọc whitelist + blacklist + cặp đấu), tỉ số, phút trận.', GRADE],
    entry: [
      'Trận 20 phút, còn hiệp 1, nhà cái mở kèo (không khóa), tỉ số 0-0.',
      'Có ≥1 đội trong whitelist động; cả 2 đội KHÔNG trong blacklist động.',
      'CẶP đấu KHÔNG nằm trong pairing-blacklist (cặp H2H Xỉu kém — /pairbl xem).',
      'Line mở KHÁC 3.0.',
      'Đủ 30 giây thật; chưa quá phút 15 (đồng hồ trận).',
    ],
    note: 'PAPER — chạy thử, không tiền, không Telegram. Cùng model R4D (whitelist + né blacklist + bỏ line 3.0 + né cặp đấu Xỉu kém) với 4 con tiền thật để làm mốc đối chiếu.',
    short: '🧬 PAPER · R4D · XỈU 0-0 trận 20p · CHỈ khi có ≥1 đội whitelist · né blacklist đội · né CẶP H2H Xỉu kém · BỎ line mở 3.0 · đối chiếu 4 con real.',
  },
  'V.Bot 12 Test Full': {
    emoji: '🧪',
    headline: 'PAPER "đánh mù": vào XỈU MỌI trận 20p (bỏ HẾT whitelist/blacklist/pairing/line) — gom data toàn bộ CẶP để mở rộng pairing-whitelist.',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Chỉ vào khi tổng bàn ≤1 (0-0 hoặc 1 trái), chờ 30s thật rồi vào khi nhà cái mở kèo; quá phút 12 (đồng hồ trận) thì bỏ. KHÔNG lọc đội/cặp/line.',
    strategy: [
      'Mục đích thí nghiệm: đánh MỌI cặp để 1 tuần sau có đủ n cho từng cặp → mở rộng danh sách "2 đội gặp nhau auto Xỉu".',
      'Bỏ toàn bộ filter: KHÔNG whitelist, KHÔNG blacklist đội, KHÔNG pairing-blacklist, KHÔNG bỏ line mở 3.0.',
      'Giữ khung nền để data so sánh công bằng: XỈU, vào khi ≤1 bàn, trận 20p (V), chờ 30s thật, cấm vào sau phút 12.',
      'PAPER — không tiền, không Telegram, chỉ ghi DB để phân tích.',
    ],
    data: [READ_ODDS, 'Line + giá Xỉu, tên 2 đội, tỉ số, phút trận (chỉ để ghi, KHÔNG lọc).', GRADE],
    entry: [
      'Trận 20p, hiệp 1, nhà cái mở kèo, tổng bàn ≤1 (0-0 hoặc 1 trái).',
      'KHÔNG điều kiện lọc đội/cặp — đủ khung là vào.',
      'Đủ 30 giây thật; chưa quá phút 12.',
    ],
    note: 'PAPER thí nghiệm — đánh mọi cặp gom data. Đối chiếu với "V.Bot 12 Test Whitelist" (chỉ cặp trong whitelist động) + 4 con Real.',
    short: '🧪 PAPER · đánh MỌI trận XỈU (≤1 bàn) 20p · bỏ hết filter · gom data toàn bộ cặp.',
  },
  'V.Bot 12 Test Whitelist': {
    emoji: '🎯',
    headline: 'PAPER: CHỈ vào XỈU khi cặp đang đá nằm trong whitelist ĐỘNG (xem box 🎯) — mirror paper của 4 con tiền thật.',
    side: 'Luôn đánh XỈU (Under)',
    when: 'Chỉ vào khi tổng bàn ≤1 (0-0 hoặc 1 trái), chờ 30s thật rồi vào khi mở kèo; quá phút 12 thì bỏ.',
    strategy: [
      'CHỈ đánh khi CẶP đấu ∈ pairing-whitelist ĐỘNG (nhóm cặp ROI Xỉu dương) — set qua /setpairwl, xem list hiện tại ở box 🎯 phía trên.',
      'Bỏ qua whitelist/blacklist/pairing per-đội — pairing-whitelist (PAIR_WL) là gate DUY NHẤT.',
      'Bản PAPER y hệt cấu hình 4 con tiền thật V.Bot 12 (Real/Kien/Trong/Nam) đang chạy — để đối chiếu.',
    ],
    data: [READ_ODDS, 'Line + giá Xỉu, tên 2 đội (lọc cặp trong whitelist), tỉ số, phút trận.', GRADE],
    entry: [
      'Trận 20p, hiệp 1, nhà cái mở kèo, tổng bàn ≤1 (0-0 hoặc 1 trái).',
      'CẶP đấu phải nằm trong whitelist động (box 🎯); cặp khác → BỎ.',
      'Đủ 30 giây thật; chưa quá phút 12.',
    ],
    note: 'PAPER mirror của 4 con tiền thật (cặp trong whitelist động). Đối chiếu với "V.Bot 12 Test Full" (đánh mọi cặp).',
    short: '🎯 PAPER · XỈU ≤1 bàn 20p · CHỈ cặp trong whitelist động · mirror 4 con Real.',
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
  'TNK - CLB - Top Rung H1': {
    emoji: '🥇',
    headline: 'Đánh TÀI hiệp 1, trận Câu Lạc Bộ 20 phút — chỉ chọn trận có đội hay ghi bàn muộn hiệp 1. Bot chạy THỬ, không đặt tiền thật.',
    side: 'Đánh TÀI (Over) — mỗi trận tối đa 1 lệnh',
    when: 'Hiệp 1: theo dõi từ phút 29, vào lệnh từ phút 34 cho tới khi hết hiệp 1.',
    strategy: [
      'Chỉ chọn trận có ít nhất 1 đội (sân nhà hoặc sân khách) hay thắng kèo Tài kiểu "ghi bàn muộn" hiệp 1 — tỉ lệ này từ 60% trở lên theo thống kê tự cập nhật.',
      'Từ phút 29: ghi lại tỉ số làm mốc. Nếu có thêm bàn thắng trước khi vào lệnh → huỷ, không đánh trận đó nữa.',
      'Từ phút 34 trở đi: nếu vẫn chưa có bàn thêm và nhà cái đang mở kèo (không khoá, không ẩn) → đánh TÀI ở mức kèo sát tỉ số hiện tại. Đánh ở bất kỳ giá nào nhà cái đưa ra, không kén giá cao/thấp.',
      'Mỗi trận chỉ đánh đúng 1 lệnh.',
    ],
    data: [READ_ODDS, 'Tỉ lệ đội hay ghi bàn muộn hiệp 1 (thống kê nội bộ, tự cập nhật), tổng bàn hiệp 1 hiện tại.', 'Chấm thắng/thua theo TỔNG BÀN HIỆP 1 — không tính bàn ghi ở hiệp 2.'],
    entry: [
      'Trận thuộc giải Câu Lạc Bộ 20 phút, có ≥1 đội hay ghi bàn muộn hiệp 1 (tỉ lệ ≥60%).',
      'Phút 29: ghi tỉ số làm mốc.',
      'Từ mốc đó tới lúc vào lệnh: không có bàn thắng nào thêm.',
      'Từ phút 34 trở đi: có mức Tài sát tỉ số hiện tại, nhà cái đang mở kèo → vào lệnh.',
    ],
    note: 'PAPER 100% — chỉ ghi nhận giả lập, KHÔNG đặt tiền thật ở bất kỳ bước nào. Chấm theo tổng bàn HIỆP 1 (khác bot Rung H2 chấm theo cả trận). Rule đã đơn giản hoá 2026-08-22 theo yêu cầu — bỏ các điều kiện phụ (mẫu tối thiểu, giới hạn giá, giới hạn phút cuối).',
    short: '🥇 PAPER · Tài hiệp 1 · đội hay ghi bàn muộn H1 ≥60% · vào từ phút 34 nếu chưa có bàn từ phút 29 · 1 lệnh/trận.',
  },
  'TNK - CLB - Top Rung H2': {
    emoji: '🏟️',
    headline: 'Đánh TÀI hiệp 2, trận Câu Lạc Bộ 20 phút — chỉ chọn trận có đội hay ghi bàn muộn hiệp 2. Bot chạy THỬ, không đặt tiền thật.',
    side: 'Đánh TÀI (Over) — mỗi trận tối đa 1 lệnh',
    when: 'Hiệp 2: theo dõi từ phút 29, vào lệnh từ phút 34 cho tới khi hết trận.',
    strategy: [
      'Chỉ chọn trận có ít nhất 1 đội (sân nhà hoặc sân khách) hay thắng kèo Tài kiểu "ghi bàn muộn" hiệp 2 — tỉ lệ này từ 60% trở lên theo thống kê tự cập nhật.',
      'Từ phút 29: ghi lại tỉ số làm mốc. Nếu có thêm bàn thắng trước khi vào lệnh → huỷ, không đánh trận đó nữa.',
      'Từ phút 34 trở đi: nếu vẫn chưa có bàn thêm và nhà cái đang mở kèo (không khoá, không ẩn) → đánh TÀI ở mức kèo sát tỉ số hiện tại. Đánh ở bất kỳ giá nào nhà cái đưa ra, không kén giá cao/thấp.',
      'Mỗi trận chỉ đánh đúng 1 lệnh.',
    ],
    data: [READ_ODDS, 'Tỉ lệ đội hay ghi bàn muộn hiệp 2 (thống kê nội bộ, tự cập nhật), tổng bàn cả trận hiện tại.', 'Chấm thắng/thua theo TỔNG BÀN CẢ TRẬN (FT).'],
    entry: [
      'Trận thuộc giải Câu Lạc Bộ 20 phút, có ≥1 đội hay ghi bàn muộn hiệp 2 (tỉ lệ ≥60%).',
      'Phút 29: ghi tỉ số làm mốc.',
      'Từ mốc đó tới lúc vào lệnh: không có bàn thắng nào thêm.',
      'Từ phút 34 trở đi: có mức Tài sát tỉ số hiện tại, nhà cái đang mở kèo → vào lệnh.',
    ],
    note: 'PAPER 100% — chỉ ghi nhận giả lập, KHÔNG đặt tiền thật ở bất kỳ bước nào. Chấm theo tổng bàn CẢ TRẬN (khác bot Rung H1 chấm theo hiệp 1). Rule đã đơn giản hoá 2026-08-22 theo yêu cầu — bỏ các điều kiện phụ (mẫu tối thiểu, giới hạn giá, giới hạn phút cuối, điều kiện bàn thắng/thẻ đỏ).',
    short: '🏟️ PAPER · Tài hiệp 2 · đội hay ghi bàn muộn H2 ≥60% · vào từ phút 34 nếu chưa có bàn từ phút 29 · 1 lệnh/trận.',
  },
  'TNK - CLB - Top Tài H2': {
    emoji: '🥅',
    headline: 'Đánh TÀI hiệp 2 — CHỈ giải Câu Lạc Bộ 20 phút, CHỈ trận thoả 1 điều kiện tỉ lệ (bảng CLBV Analyst). PAPER — chưa backtest dài, đang dò. Rule cập nhật 2026-08-21.',
    side: 'Đánh TÀI (Over) — mỗi trận tối đa 1 lệnh',
    when: 'Hiệp 2: chỉ ARM (ghi tỉ số nền) nếu lần đầu thấy trận rơi đúng phút 1-3 (đầu hiệp); CHỈ kiểm tra điều kiện vào kèo ĐÚNG tại phút 10 (2026-08-21, trước đây kiểm tra liên tục phút 1-10). Thấy trận lần đầu SAU phút 3, hoặc quá phút 10 chưa vào được → bỏ hẳn.',
    strategy: [
      'CHỌN TRẬN (2026-08-21, DUY NHẤT 1 điều kiện — bỏ 2 điều kiện Tài cả trận/floor Tài H2 mà rule 2026-08-20 từng thêm): có ÍT NHẤT 1 đội (sân nhà hoặc sân khách) tỉ lệ "Tài H2" ≥ 60% (≥10 trận dữ liệu) — danh sách tự cập nhật khi bấm Sync ở trang CLBV Analyst, bot đọc lại khoảng mỗi 3 phút.',
      'Đầu hiệp 2 (phút 1-3, chỉ arm 1 lần): ghi tổng bàn hiện tại làm mốc nền. Từ đó tới lúc vào lệnh, hễ có thêm bàn là HUỶ luôn.',
      'CHỈ kiểm tra ĐÚNG tại phút 10 (2026-08-21, trước đây kiểm tra liên tục từ phút 1): tìm mức Tài cao hơn tổng bàn hiện tại tối đa 1,5 bàn (không cần đúng bằng, lấy mức GẦN tỉ số nhất trong các mức thoả điều kiện) và giá kèo đó phải LỚN HƠN 0,75 (2026-08-21: ĐẢO LẠI mức nâng 0,85 của rule 2026-08-20, quay về 0,75).',
      'Điều kiện tổng bàn (2026-08-20, KHÔNG đổi): chỉ vào kèo nếu tổng bàn hiện tại < 5 HOẶC đang có ít nhất 1 đội bị thẻ đỏ — nếu tổng bàn ≥5 mà chưa có thẻ đỏ thì tiếp tục chờ (thẻ đỏ có thể xuất hiện sau, chưa huỷ hẳn trận).',
      'Chỉ vào khi nhà cái đang mở kèo (không khoá cả trận) và đúng mức kèo đó không bị ẩn/khoá riêng.',
      'Quá phút 10 mà chưa tìm được mức phù hợp → bỏ hẳn, không vào kèo trận đó nữa.',
      'Giải Câu Lạc Bộ (leagueId 1508) đã nằm trong feed thật dùng chung (feed-leagues.json, từ 2026-08-18) — bot này đọc CHUNG feed đó (http://localhost:8899) như mọi bot paper khác.',
    ],
    data: [READ_ODDS, 'Bảng gs_clbv_analyst (tỉ lệ Tài H2, số trận từng đội), tổng bàn hiện tại, thẻ đỏ, phút trong hiệp 2.', 'Chấm: theo tổng bàn cả trận (FT), luật Asian đầy đủ (có thể hoà/half-win vì mức không cố định là số lẻ 0,5).'],
    entry: [
      'Trận thuộc giải Câu Lạc Bộ 20 phút, có ≥1 đội tỉ lệ Tài H2 ≥60% (≥10 trận dữ liệu).',
      'Phút 1-3 của hiệp 2 (lần đầu thấy trận trong khoảng này): ghi tổng bàn làm nền. Thấy trận lần đầu muộn hơn → bỏ hẳn.',
      'Từ mốc nền tới lúc vào lệnh: không có bàn nào thêm.',
      'Tổng bàn hiện tại < 5 HOẶC đang có đội bị thẻ đỏ.',
      'ĐÚNG tại phút 10: có mức Tài cao hơn tổng bàn hiện tại ≤1,5, giá > 0,75, nhà cái đang mở kèo, mức đó không bị khoá riêng → vào TÀI (ưu tiên mức gần tỉ số nhất nếu có nhiều mức thoả).',
    ],
    note: 'PAPER 100% — không gọi API đặt cược thật ở bất kỳ nhánh code nào. Backfill KHÔNG còn dùng được để kiểm chứng rule này (dữ liệu lịch sử 20p_club chỉ ghi snapshot theo sự kiện, không có mốc đúng phút 10) — xem chi tiết ở CLBV Analyst + TX Report.',
    short: '🥅 PAPER · CLB · Tài H2≥60% (1 đội, n≥10) · ĐÚNG phút 10 · Tài gap≤1,5 giá>0,75 · tổng bàn<5 hoặc có thẻ đỏ · 1 lệnh/trận.',
  },
  'NVT - CLB - RH2': {
    emoji: '🎯',
    headline: 'Đánh TÀI CẢ HAI HIỆP — CHỈ giải Câu Lạc Bộ 20 phút (leagueId 1508). PAPER. ⚠️ HAI HIỆP ĐÁNH HAI LOẠI KÈO KHÁC NHAU: hiệp 1 đánh KÈO TÀI/XỈU HIỆP 1 (chỉ tính bàn trong hiệp 1), hiệp 2 đánh KÈO TÀI/XỈU CẢ TRẬN (tính bàn cả trận) vì nhà cái KHÔNG treo kèo hiệp 2 cho giải này. Hiệp 1 — A30 (áp dụng từ 2026-08-21 11:27): cắm cờ ở phút 30 ghi tỉ số nền, vào phút 33 nếu tỉ số CHƯA đổi; có thêm bàn BẤT KỲ LÚC NÀO là HUỶ hẳn hiệp 1; thấy trận lần đầu khi đã qua phút 30 thì bỏ hẳn hiệp 1 (không có mốc nền thì không đoán mò). Hiệp 2: cắm cờ phút 29, vào phút 34 nếu tỉ số chưa đổi.',
    side: 'Đánh TÀI (Over) — hiệp 1 trên mức kèo HIỆP 1, hiệp 2 trên mức kèo CẢ TRẬN — 1 lệnh MỖI HIỆP, tối đa 2 lệnh/trận',
    when: 'Hiệp 1 — A30: cắm cờ (ghi tỉ số nền) tại phút 30, theo dõi tới phút 33, vào tại phút 33 nếu tỉ số vẫn y nguyên, trên mức Tài/Xỉu HIỆP 1. Hiệp 2: cắm cờ (ghi tỉ số nền) tại phút 29, theo dõi tới phút 34, vào tại phút 34 nếu tỉ số vẫn y nguyên, trên mức Tài/Xỉu CẢ TRẬN. Cả 2 hiệp: đang bị nhà cái khoá kèo thì KHÔNG vào, chờ tới lúc mở khoá rồi mới vào — nên phút vào thực tế có thể là 35, 36, 38...',
    strategy: [
      'CHỌN TRẬN: chỉ giải Câu Lạc Bộ 20 phút (leagueId 1508) — đọc CHUNG feed thật với cả fleet rồi tự lọc riêng giải này, không tự poll nhà cái riêng.',
      'KHÔNG xét tỉ lệ đội — khác hẳn 3 bot TNK - CLB: bot này không dùng bảng CLBV Analyst, không đòi đội nào đạt ngưỡng phần trăm nào cả.',
      '⚠️ HAI THỊ TRƯỜNG KHÁC NHAU (sửa 2026-08-21): HIỆP 1 vào mức Tài/Xỉu HIỆP 1 do nhà cái treo riêng cho hiệp 1 (mức thường quanh 1,5-2,0) và CHẤM theo TỔNG BÀN HIỆP 1. HIỆP 2 vào mức Tài/Xỉu CẢ TRẬN (mức thường quanh 3,0-3,5) và CHẤM theo TỔNG BÀN CẢ TRẬN. Trước đây bot vào nhầm mức cả trận ở CẢ hai hiệp — đã sửa.',
      'VÌ SAO HIỆP 2 DÙNG KÈO CẢ TRẬN: nhà cái KHÔNG treo kèo Tài/Xỉu hiệp 2 cho giải 1508 (kiểm 17.774 lượt ghi nhận trong hiệp 2, không lượt nào có mức nửa hiệp). Nên trong hiệp 2, mức CẢ TRẬN chính là thứ đóng vai trò kèo Tài hiệp 2.',
      'HIỆP 1 — A30 (từ 2026-08-21 11:27, TRƯỚC ĐÓ là vô điều kiện): cắm cờ ở phút 30 ghi tỉ số nền, vào phút 33 nếu tỉ số CHƯA đổi; có thêm bàn BẤT KỲ LÚC NÀO là HUỶ hẳn hiệp 1; thấy trận lần đầu khi đã qua phút 30 thì bỏ hẳn hiệp 1 (không có mốc nền thì không đoán mò). Không chặn giá. Lệnh cũ hơn mốc này mang nhãn snapshot.filterVersion = NULL và chạy rule vô điều kiện — cắt dữ liệu theo filterVersion, ĐỪNG cắt theo ngày.',
      'HIỆP 2 — CÓ MỐC NỀN: tại phút 29 ghi TỔNG BÀN hiện tại làm mốc nền, rồi theo dõi từ phút 29 tới phút 34. Tới phút 34, nếu tỉ số VẪN Y NGUYÊN mốc nền thì vào TÀI trên mức cả trận.',
      'HIỆP 2 — HUỶ: bất kỳ lúc nào kể từ khi cắm cờ (kể cả trong lúc đang chờ nhà cái mở khoá) mà tổng bàn vượt mốc nền → huỷ hẳn hiệp đó, không vào nữa.',
      'ĐIỂM VÀO HIỆP 2 LÀ PHÚT 34, KHÔNG VÀO SỚM (sửa 2026-08-20): trước đây bot vào sớm nhất có thể trong khoảng 29-34; nay phải chờ đủ tới phút 34 mới vào.',
      'LẤY ĐÚNG MỨC ĐẦU TIÊN: mỗi hiệp lấy đúng mức Tài/Xỉu đầu tiên nhà cái đưa ra cho thị trường của hiệp đó (hiệp 1 lấy mức hiệp 1, hiệp 2 lấy mức cả trận) — không tự chọn mức khác, không ép mức = tổng bàn + 0,5. KHÔNG CHẶN GIÁ — nhận mọi giá đọc được: âm, 0 hay dương đều ĐẠT.',
      'CHỜ KHI BỊ KHOÁ KÈO (cả 2 hiệp): đang khoá thì TUYỆT ĐỐI không vào, bot chờ tiếp. Lúc nhà cái mở khoá mới vào, và ghi đúng phút thực tế (35, 36, 38...). Riêng hiệp 2 phải thoả thêm điều kiện: tỉ số vẫn y nguyên mốc nền.',
      'THỬ LẠI: tối đa 3 lần thất bại vì lý do KỸ THUẬT (nhà cái chưa đẩy mức kèo của thị trường hiệp đó, giá không đọc được, lỗi ghi dữ liệu) thì bỏ hiệp đó. Bị nhà cái KHOÁ KÈO KHÔNG tính vào 3 lần này (vì đã có cơ chế chờ mở khoá riêng).',
      'HAI HIỆP ĐỘC LẬP: vào được ở hiệp 1 KHÔNG chặn hiệp 2 và ngược lại — mỗi hiệp tối đa 1 lệnh, cả trận tối đa 2 lệnh.',
      'Thấy trận lần đầu khi đã QUÁ điểm vào của hiệp đó (bot vừa khởi động lại, hoặc trận vào feed muộn) → bỏ hiệp đó, không đoán mò.',
    ],
    data: [
      READ_ODDS,
      'Hiệp 1: mức Tài/Xỉu HIỆP 1 + giá cửa Tài của mức đó. Hiệp 2: mức Tài/Xỉu CẢ TRẬN + giá cửa Tài. Kèm tổng bàn hiện tại, hiệp và phút đang đá, trạng thái khoá kèo của trận và của riêng mức đó.',
      'Chấm — KHÁC NHAU THEO HIỆP: lệnh hiệp 1 chấm theo TỔNG BÀN HIỆP 1; lệnh hiệp 2 chấm theo TỔNG BÀN CẢ TRẬN. Cả hai dùng luật Asian đầy đủ — mức có thể là số chẵn (hoà) hoặc mức lẻ 1/4 (nửa ăn/nửa thua).',
    ],
    entry: [
      'Trận thuộc giải Câu Lạc Bộ 20 phút (leagueId 1508).',
      'HIỆP 1: đã cắm cờ ở phút 30, đã tới phút 33, và từ mốc nền KHÔNG có thêm bàn nào (A30) → vào TÀI trên mức kèo HIỆP 1.',
      'HIỆP 2: đã cắm cờ ở phút 29, đã tới phút 34, và từ mốc nền tới giờ KHÔNG có thêm bàn nào. Vào TÀI trên mức kèo CẢ TRẬN.',
      'Nhà cái đang MỞ KÈO — đủ cả 3 tầng: trận đang nhận cược, trận không bị tạm dừng, và riêng mức Tài/Xỉu của hiệp đó cũng không bị khoá. Đang khoá thì chỉ chờ, TUYỆT ĐỐI không vào.',
      'Nhà cái đã đẩy mức kèo của đúng thị trường hiệp đó, và đọc được mức + giá cửa Tài ra số hợp lệ — không đặt sàn giá, giá âm/0/dương đều vào. Chưa có mức thì tính là lỗi kỹ thuật (đếm vào 3 lần thử lại).',
      'Hiệp đó chưa có lệnh nào (1 lệnh/hiệp) → vào TÀI, ghi lại đúng hiệp + phút thực tế lúc vào để xem được trên bảng chi tiết.',
    ],
    note: 'PAPER 100% — không gọi API đặt cược thật ở bất kỳ nhánh code nào. Không có backfill (chỉ chạy LIVE). ⚠️ Đọc bảng chi tiết nhớ phân biệt: dòng hiệp 1 là KÈO HIỆP 1 nên mức nhỏ (khoảng 1,5-2,0) và chấm theo bàn hiệp 1; dòng hiệp 2 là KÈO CẢ TRẬN nên mức lớn hơn (khoảng 3,0-3,5) và chấm theo bàn cả trận — hai loại kèo này KHÔNG so sánh mức trực tiếp với nhau được. Cột "Thời điểm vào" hiện rõ hiệp + phút thực (ví dụ H1 33, H2 34); nếu phải chờ nhà cái mở khoá thì hiện thêm "(chờ mở khoá)" và phút có thể lớn hơn 34.',
    short: '🎯 PAPER · CLB 20p · H1 (A30) cắm cờ phút 30, vào TÀI phút 33 nếu tỉ số chưa đổi — có bàn là HUỶ — trên KÈO HIỆP 1 (chấm theo bàn hiệp 1) · H2 cắm cờ phút 29, vào phút 34 nếu chưa có bàn, trên KÈO CẢ TRẬN (chấm theo bàn cả trận, vì nhà cái không treo kèo hiệp 2) · lấy mức đầu tiên, KHÔNG chặn giá · bị khoá thì chờ mở khoá mới vào · tối đa 3 lần thử lại kỹ thuật · 1 lệnh/hiệp, tối đa 2 lệnh/trận.',
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
  'V.Bot 14 Real Kien': {
    emoji: '💥',
    headline: 'Y hệt V.Bot 14 Real (kèo RUNG TÀI tiền thật) nhưng chạy trên VÍ RIÊNG của Kiên (group + token + tiền tách biệt).',
    side: 'Đánh TÀI (Over) — tiền thật',
    when: 'Mỗi hiệp: phút 29 cắm cờ, phút 34 vào lệnh (cả hiệp 1 và hiệp 2).',
    strategy: [
      'Cùng luật kèo rung với V.Bot 14: phút 29 cắm cờ khi Xỉu ≥ 0,7; phút 34 vào TÀI mức gap 0,5/0,75 nếu 29→34 không thêm bàn.',
      'Đặt lệnh TÀI THẬT trên sb21 (cửa Over) — ví/token/tiền RIÊNG của group Rung Tài Kiên, độc lập hoàn toàn với con gốc + 4 con XỈU.',
      'Có bàn giữa chừng → HUỶ. Nhà cái khoá → thử lại 3 lần. Mỗi hiệp tối đa 1 lệnh.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Tài của hiệp, tỉ số, phút trong hiệp.', 'Chấm theo kết quả thật trên sb21.'],
    entry: [
      'Phút 29: kèo Xỉu ≥ 0,7 → cắm cờ.',
      'Phút 29→34 không thêm bàn.',
      'Phút 34: có mức gap 0,5/0,75 trên tỉ số, nhà cái mở kèo → đặt TÀI thật.',
    ],
    note: 'Bot đặt TIỀN THẬT trên ví Rung Tài KIÊN — độc lập hoàn toàn (token/stake/số dư/PnL riêng, không đụng con gốc). Lệnh trong group Kiên: /setmoney · /pnl · /pnltotal · /balance · /active · /start /stop · /settoken 69-… · /info. ⚠️ Cửa TÀI + chiến lược CHƯA validate → rủi ro cao; mặc định TẮT tới khi /settoken + /setmoney + /start.',
    short: '💥 TIỀN THẬT · kèo RUNG TÀI (ví riêng Kiên) · phút 29 cắm cờ Xỉu≥0,7, phút 34 vào TÀI gap 0,5/0,75 · cả H1+H2 · ⚠️ chưa validate.',
  },
  'V.Bot 14 Real Trong': {
    emoji: '💥',
    headline: 'Y hệt V.Bot 14 Real (kèo RUNG TÀI tiền thật) nhưng chạy trên VÍ RIÊNG của Trọng (group + token + tiền tách biệt).',
    side: 'Đánh TÀI (Over) — tiền thật',
    when: 'Mỗi hiệp: phút 29 cắm cờ, phút 34 vào lệnh (cả hiệp 1 và hiệp 2).',
    strategy: [
      'Cùng luật kèo rung với V.Bot 14: phút 29 cắm cờ khi Xỉu ≥ 0,7; phút 34 vào TÀI mức gap 0,5/0,75 nếu 29→34 không thêm bàn.',
      'Đặt lệnh TÀI THẬT trên sb21 (cửa Over) — ví/token/tiền RIÊNG của group Rung Tài Trọng, độc lập hoàn toàn với con gốc + Kiên + 4 con XỈU.',
      'Có bàn giữa chừng → HUỶ. Nhà cái khoá → thử lại 3 lần. Mỗi hiệp tối đa 1 lệnh.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Tài của hiệp, tỉ số, phút trong hiệp.', 'Chấm theo kết quả thật trên sb21.'],
    entry: [
      'Phút 29: kèo Xỉu ≥ 0,7 → cắm cờ.',
      'Phút 29→34 không thêm bàn.',
      'Phút 34: có mức gap 0,5/0,75 trên tỉ số, nhà cái mở kèo → đặt TÀI thật.',
    ],
    note: 'Bot đặt TIỀN THẬT trên ví Rung Tài TRỌNG — độc lập hoàn toàn (token/stake/số dư/PnL riêng, không đụng con gốc/Kiên). Lệnh trong group Trọng: /setmoney · /pnl · /pnltotal · /balance · /active · /start /stop · /settoken 69-… · /info. ⚠️ Cửa TÀI + chiến lược CHƯA validate → rủi ro cao; mặc định TẮT tới khi /settoken + /setmoney + /start.',
    short: '💥 TIỀN THẬT · kèo RUNG TÀI (ví riêng Trọng) · phút 29 cắm cờ Xỉu≥0,7, phút 34 vào TÀI gap 0,5/0,75 · cả H1+H2 · ⚠️ chưa validate.',
  },
  'V.Bot 14 Real Nam': {
    emoji: '💥',
    headline: 'Y hệt V.Bot 14 Real (kèo RUNG TÀI tiền thật) nhưng chạy trên VÍ RIÊNG của Nam (group + token + tiền tách biệt). (Group này trước là V.Bot 12 Nam, đã chuyển hẳn sang V14.)',
    side: 'Đánh TÀI (Over) — tiền thật',
    when: 'Mỗi hiệp: phút 29 cắm cờ, phút 34 vào lệnh (cả hiệp 1 và hiệp 2).',
    strategy: [
      'Cùng luật kèo rung với V.Bot 14: phút 29 cắm cờ khi Xỉu ≥ 0,7; phút 34 vào TÀI mức gap 0,5/0,75 nếu 29→34 không thêm bàn.',
      'Đặt lệnh TÀI THẬT trên sb21 (cửa Over) — ví/token/tiền RIÊNG của group Rung Tài Nam, độc lập hoàn toàn với con gốc + Kiên + Trọng + 4 con XỈU.',
      'Có bàn giữa chừng → HUỶ. Nhà cái khoá → thử lại 3 lần. Mỗi hiệp tối đa 1 lệnh.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Tài của hiệp, tỉ số, phút trong hiệp.', 'Chấm theo kết quả thật trên sb21.'],
    entry: [
      'Phút 29: kèo Xỉu ≥ 0,7 → cắm cờ.',
      'Phút 29→34 không thêm bàn.',
      'Phút 34: có mức gap 0,5/0,75 trên tỉ số, nhà cái mở kèo → đặt TÀI thật.',
    ],
    note: 'Bot đặt TIỀN THẬT trên ví Rung Tài NAM — độc lập hoàn toàn (token/stake/số dư/PnL riêng, không đụng con gốc/Kiên/Trọng). Lệnh trong group Nam: /setmoney · /pnl · /pnltotal · /balance · /active · /start /stop · /settoken 69-… · /info. ⚠️ Cửa TÀI + chiến lược CHƯA validate → rủi ro cao; mặc định TẮT tới khi /settoken + /setmoney + /start.',
    short: '💥 TIỀN THẬT · kèo RUNG TÀI (ví riêng Nam) · phút 29 cắm cờ Xỉu≥0,7, phút 34 vào TÀI gap 0,5/0,75 · cả H1+H2 · ⚠️ chưa validate.',
  },
  'V.Bot 15': {
    emoji: '🌅',
    headline: 'Đánh TÀI đầu trận loại 16 phút (S) khi nhà cái mở line CAO — bản thử, hiện đang TẮT.',
    side: 'Đánh TÀI (Over) · chỉ trận (S) 16 phút',
    when: 'Rất sớm: phút 1–4 của trận, ngay khi nhà cái mở kèo.',
    strategy: [
      'Ý tưởng (từ phân tích 16p): ở loại trận 16 phút, đường sáng nhất là đánh TÀI đầu trận khi nhà cái mở line CAO (≥2.75) — backtest +13,5% ROI (n121, CHƯA forward-test kỹ).',
      'Chỉ vào khi line mở ≥ 2.75; chỉ trận loại 16 phút (S); mỗi trận 1 lệnh.',
    ],
    data: [READ_ODDS, 'Line + giá Tài nhà cái vừa mở ở trận 16 phút, phút trận.', GRADE],
    entry: ['Trận 16 phút (S) · phút 1–4 · line mở ≥ 2.75 · nhà cái đang mở kèo.'],
    note: 'PAPER — chạy thử, không tiền, không Telegram. HIỆN ĐANG TẮT (pm2 stopped, mới 3 lệnh). Ngược hướng các V.Bot XỈU: bản này đánh TÀI.',
    short: '🌅 PAPER (đang TẮT) · TÀI đầu trận 16p (S) · line mở ≥2.75 · phút 1–4 · backtest +13,5% chưa forward-test.',
  },
  'V.Bot 16': {
    emoji: '⏱️',
    headline: 'KÈO RUNG 16p: giữa hiệp (phút 25→32) nếu trận đang tịt + thị trường nghiêng Xỉu → đánh TÀI (over 0.5), chờ giá over về −0,6. PAPER.',
    side: 'Đánh TÀI (Over) · chỉ trận (S) 16 phút',
    when: 'Mỗi hiệp: phút 25 ghi mốc, xét ở phút 32, đặt khi giá over đạt ngưỡng (tối đa tới phút 42).',
    strategy: [
      'Ý tưởng (mean-reversion, cho trận 16 phút): giữa hiệp mà vẫn ít bàn VÀ thị trường nghiêng Xỉu → kỳ vọng 1 bàn muộn → đánh TÀI.',
      'Phút 25: ghi tỉ lệ Xỉu (under) + tỉ số nền.',
      'Đếm bàn trong cửa sổ 25→32. Tại phút 32 vào nếu thoả 1 TRONG 2: (A) Xỉu@25 ≥ 0,75 và 0 bàn (25-32); (B) Xỉu@25 ≥ 0,75 và < 2 bàn (25-32). [đã NÂNG ngưỡng 0,5/0,6 → 0,75 để siết chặt, improve 2026-08-08]',
      'Vào OVER 0.5 (line gap 0,5 trên tỉ số → cần thêm 1 bàn), NHƯNG chờ đến khi giá over của line đó ≥ −0,6 (Malay) mới đặt — lấy value, tránh vào lúc over quá được ưu ái.',
      'Mỗi (trận × hiệp) tối đa 1 lệnh; quá phút 42 chưa đặt được thì bỏ. Có lưu odds phút 25/32/lúc vào để đối chiếu/backtest.',
    ],
    data: [READ_ODDS, 'Line + giá Tài/Xỉu của hiệp (16p S), tỉ số, phút trong hiệp.', 'Chấm: H1 theo bàn hiệp 1; H2 theo tổng bàn cả trận (FT).'],
    entry: [
      'Trận 16 phút (S), đang trong hiệp, phút 25→42.',
      'Thoả 1 TRONG 2 điều kiện:',
      '• A) Xỉu@25 ≥ 0,75  VÀ  0 bàn ghi trong cửa sổ phút 25→32.',
      '• B) Xỉu@25 ≥ 0,75  VÀ  dưới 2 bàn (tức 0 hoặc 1) trong cửa sổ phút 25→32.',
      'Line over gap 0,5 trên tỉ số (cần thêm 1 bàn), giá over ≥ −0,6, nhà cái mở kèo.',
    ],
    note: 'PAPER — chạy thử, KHÔNG tiền, KHÔNG Telegram (ngầm). ⚠️ Backtest sơ bộ 1 ngày (18 lượt) cho TÀI muộn chỉ ~11% thắng — nhưng data quá mỏng + logger cắt cụt ~phút 42; đang forward-test lấy số thật. Rule do owner đề xuất 2026-08-07.',
    short: '⏱️ PAPER · KÈO RUNG 16p (S) · TÀI over 0.5 · phút25 ghi Xỉu, phút32 xét (Xỉu@25 ≥ 0,75 & <2 bàn) · chờ over≥−0,6 · ⚠️ chưa validate.',
  },
  'V.Bot 18': {
    emoji: '🎰',
    headline: 'Kèo RUNG 2 CHIỀU theo CẶP ĐẤU (whitelist ĐỘNG, cập nhật mỗi ngày): cặp hay NỔ muộn → đánh TÀI phút 34; cặp hay TỊT → đánh XỈU phút 29. Chỉ hiệp 1 trận 20p. PAPER.',
    side: 'TÀI (Over 0.5) HOẶC XỈU (Under 0.5) — tuỳ cặp đấu',
    when: 'Chỉ hiệp 1, khi tỉ số còn 0-0. XỈU: xét ở phút 29. TÀI: xét ở phút 34. Có bàn trước thời điểm xét → BỎ trận.',
    strategy: [
      'Ý tưởng: ở trận 20p (V), việc trận nổ bàn muộn hay tịt tới cuối hiệp 1 phụ thuộc RẤT mạnh vào CẶP ĐẤU cụ thể (không phải từng đội lẻ). Nên bot chia 2 danh sách cặp và đánh 2 chiều ngược nhau.',
      'DANH SÁCH ĐỘNG (tự cập nhật mỗi ngày, cửa sổ trượt 21 ngày — KHÔNG cố định tay): mỗi đêm backtest lại toàn bộ trận 20p(V), tính cho từng cặp: %nổ@34 (đang 0-0 ở phút 34 rồi có bàn tới hết H1) và %tịt@29 (0-0 ở phút 29 và giữ 0-0 tới hết H1).',
      'CẶP TÀI (file rung-tai-whitelist.json): cặp có %nổ@34 ≥ 65% → khi gặp lại, đánh TÀI over 0.5 ở phút 34 (kỳ vọng bàn muộn). VD hiện tại: Australia|Indonesia, Indonesia|Iran, India|Japan, Korea Republic|Malaysia, Iran|Vietnam…',
      'CẶP XỈU (file rung-xiu-whitelist.json): cặp có %tịt@29 ≥ 60% → khi gặp lại, đánh XỈU under 0.5 ở phút 29 (kỳ vọng giữ 0-0 hết hiệp). VD: New Zealand|North Korea, India|Malaysia, Qatar|Saudi Arabia, New Zealand|Thailand, Iran|Saudi Arabia, India|North Korea.',
      'LỌC GIÁ CHO XỈU: chỉ vào XỈU khi giá cửa under-0.5 ≥ 0,75 (Malay) — đủ value mới đánh, tránh vào lúc under bị cắt giá.',
      'Cặp KHÔNG nằm trong cả 2 danh sách → BỎ. Mỗi trận tối đa 1 lệnh; có bàn trước thời điểm xét → huỷ (rung mất).',
    ],
    data: [READ_ODDS, 'Tên 2 cặp đấu (khớp 2 danh sách động), line + giá over/under 0.5 hiệp 1, tỉ số hiện tại, phút trong hiệp.', 'Chấm theo TỔNG BÀN HIỆP 1 (line 0.5): TÀI thắng nếu H1 có ≥1 bàn; XỈU thắng nếu H1 giữ 0-0.'],
    entry: [
      'Trận 20 phút (V), còn hiệp 1, tỉ số 0-0, nhà cái mở kèo.',
      'CẶP XỈU: ở phút 29, cặp ∈ danh sách XỈU động VÀ giá under-0.5 ≥ 0,75 → vào XỈU under 0.5.',
      'CẶP TÀI: ở phút 34 (nếu chưa vào XỈU), cặp ∈ danh sách TÀI động → vào TÀI over 0.5.',
    ],
    note: 'PAPER — chạy thử, không tiền. Bắn tín hiệu vào Topic "V.Bot 18". 2 danh sách cặp là ĐỘNG, tự sinh lại mỗi ngày (cron backtest 21 ngày) — không phải whitelist gõ tay, cặp vào/ra theo phong độ gần nhất. Chiến lược MỚI → forward-test trước khi cân nhắc lên tiền.',
    short: '🎰 PAPER · kèo RUNG 2 chiều theo CẶP (whitelist ĐỘNG/ngày) · cặp nổ muộn→TÀI phút34 · cặp tịt→XỈU phút29 (under≥0,75) · 20p H1 · bắn Topic V.Bot 18.',
  },
  'V.Bot 18 Real': {
    emoji: '💰',
    headline: 'Y hệt V.Bot 18 (kèo RUNG 2 chiều theo CẶP, whitelist ĐỘNG mỗi ngày) nhưng ĐẶT TIỀN THẬT trên ví riêng — group "Real VBot18".',
    side: 'TÀI (Over 0.5) HOẶC XỈU (Under 0.5) — tuỳ cặp đấu · TIỀN THẬT',
    when: 'Chỉ hiệp 1 trận 20p (V), khi tỉ số còn 0-0. XỈU: xét ở phút 29. TÀI: xét ở phút 34. Có bàn trước thời điểm xét → BỎ trận.',
    strategy: [
      'Cùng luật với V.Bot 18 paper: ở trận 20p (V), việc trận nổ bàn muộn hay tịt tới cuối hiệp 1 phụ thuộc mạnh vào CẶP ĐẤU — chia 2 danh sách cặp, đánh 2 chiều ngược nhau.',
      'DANH SÁCH ĐỘNG (tự cập nhật mỗi ngày, cửa sổ trượt 21 ngày): mỗi đêm backtest lại toàn bộ trận 20p(V), tính cho từng cặp %nổ@34 và %tịt@29.',
      'CẶP TÀI (rung-tai-whitelist.json, %nổ@34 ≥ 65%): gặp lại → đặt TÀI over 0.5 THẬT ở phút 34 (cửa Over/selOver).',
      'CẶP XỈU (rung-xiu-whitelist.json, %tịt@29 ≥ 60%): gặp lại → đặt XỈU under 0.5 THẬT ở phút 29 (cửa Under/selUnder), CHỈ khi giá under-0.5 ≥ 0,75 (Malay).',
      'CHỈ giải V (20p) — KHÔNG đánh 16p(S) dù cặp trùng tên. Cặp không nằm trong cả 2 danh sách → BỎ. Mỗi trận tối đa 1 lệnh; có bàn trước thời điểm xét → huỷ.',
      'Đặt lệnh THẬT trên sb21 — ví/token/tiền RIÊNG của group Real VBot18, độc lập hoàn toàn với các con khác.',
    ],
    data: [READ_ODDS, 'Tên 2 cặp đấu (khớp 2 danh sách động), line + giá over/under 0.5 hiệp 1, tỉ số hiện tại, phút trong hiệp.', 'Chấm theo kết quả thật trên sb21 (H1 line 0.5).'],
    entry: [
      'Trận 20 phút (V), còn hiệp 1, tỉ số 0-0, nhà cái mở kèo.',
      'CẶP XỈU: phút 29, cặp ∈ danh sách XỈU động VÀ giá under-0.5 ≥ 0,75 → đặt XỈU under 0.5 thật.',
      'CẶP TÀI: phút 34 (nếu chưa vào XỈU), cặp ∈ danh sách TÀI động → đặt TÀI over 0.5 thật.',
    ],
    note: 'Bot đặt TIỀN THẬT trên ví Real VBot18 — độc lập (token/stake/số dư/PnL riêng). Lệnh trong group: /setmoney · /pnl · /balance · /start /stop · /sethour · /settoken 69-… · /info. 2 danh sách cặp là ĐỘNG, tự sinh lại mỗi ngày (cron 3h sáng, backtest 21 ngày). ⚠️ Cửa Tài+Xỉu 2 chiều, chiến lược MỚI CHƯA forward-test tiền thật → rủi ro cao; mặc định TẮT (enabled=false + token trống) tới khi /settoken + /setmoney + /start.',
    short: '💰 TIỀN THẬT · kèo RUNG 2 chiều theo CẶP (whitelist ĐỘNG/ngày) · cặp nổ muộn→TÀI phút34, cặp tịt→XỈU phút29 (under≥0,75) · 20p(V) H1 · ⚠️ chưa validate, mặc định TẮT.',
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
  'V.Bot 21 QT Xỉu': {
    emoji: '🌍',
    headline: 'CHỈ giải International 20p — cuối hiệp nếu thị trường nghiêng Xỉu mạnh thì đánh XỈU tại line hiệp đang đá.',
    side: 'Chỉ đánh XỈU (Under) · chỉ giải International 20p',
    when: 'Từ phút 29 của hiệp đang đá trở đi (đồng hồ trận), canh tới phút 42. Khi nhà cái mở kèo VÀ giá Xỉu đủ hời thì vào.',
    strategy: [
      'CHỈ chơi giải International loại 20 phút — bỏ hết các giải/loại khác.',
      'Đợi tới cuối hiệp (phút ≥ 29 của hiệp đang đá): nếu thị trường đang định giá Xỉu (Under) ≥ 0,75 (tức nghiêng ít bàn) thì đánh theo cửa XỈU.',
      'Vào tại line của HIỆP đang đá: hiệp 1 dùng line hiệp 1, hiệp 2 dùng line cả trận (FT).',
      'Né lúc nhà cái KHOÁ kèo: canh liên tục từ phút 29 tới phút 42 — hễ book mở lại VÀ Xỉu vẫn ≥ 0,75 thì vào; quá phút 42 chưa vào được thì bỏ.',
    ],
    data: [READ_ODDS, 'Line + giá cửa Xỉu của hiệp đang đá (H1 line H1, H2 line FT), tên giải (lọc International), tỉ số, phút trong hiệp.', GRADE],
    entry: [
      'Trận giải International, loại 20 phút.',
      'Phút ≥ 29 của hiệp đang đá; chưa quá phút 42.',
      'Giá cửa Xỉu (Under) ≥ 0,75 (Malay) VÀ nhà cái đang MỞ kèo (không khoá).',
    ],
    note: 'PAPER — chạy thử, không tiền, không Telegram. Chỉ giải International 20p, đánh XỈU cuối hiệp khi thị trường nghiêng ít bàn + book mở.',
    short: '🌍 PAPER · XỈU · CHỈ International 20p · phút ≥29 (canh tới 42) · Xỉu ≥0,75 + book mở → vào line hiệp đang đá.',
  },
  'V.Bot Air 1': {
    emoji: '🌐',
    headline: 'CHỈ giải International 20p — đánh XỈU theo tỉ số live + phút cụ thể (backtest +21u/231 trận, EV +0.091/trận).',
    side: 'Luôn đánh XỈU (Under)',
    when: 'H1 phút 29–31 hoặc H2 phút 24–26 / 29–31 tuỳ condition. Vào ngay khi nhà cái mở kèo.',
    strategy: [
      'CHỈ giải International loại 20 phút (league_id 1485).',
      'Phân tích 281 trận thực tế: tìm phút + tỉ số có EV dương cao nhất, backtest trên toàn bộ data trước khi deploy.',
      'Hoàn toàn XỈU — không đánh Tài (không tìm được Tài có edge đủ mạnh).',
      '5 conditions độc lập mỗi trận; 1 condition = 1 lệnh, không overlap.',
    ],
    data: [READ_ODDS, 'Tỉ số live, phút trong hiệp (reset mỗi hiệp), line OU + giá Xỉu.', GRADE],
    entry: [
      'C1 — Xỉu H1: H1 phút 29–31, tỉ số = 1 bàn, line ~1.50 → Xỉu hiệp 1. [EV +0.046, n=78]',
      'C2 — Xỉu FT: H2 phút 24–26, tỉ số FT = 1 bàn, line ~1.6 → Xỉu FT. [EV +0.080, n=51]',
      'C3 — Xỉu FT: H2 phút 24–26, tỉ số FT = 4 bàn, line ~4.6 → Xỉu FT. [EV +0.161, n=32]',
      'C4 — Xỉu FT: H2 phút 29–31, tỉ số FT = 3 bàn, line ~3.50 → Xỉu FT. [EV +0.122, n=37]',
      'C5 — Xỉu FT: H2 phút 29–31, tỉ số FT = 4 bàn, line ~4.50 → Xỉu FT. [EV +0.110, n=33]',
      'Book phải MỞ (bettingOpen=true, không suspended) tại thời điểm vào.',
    ],
    note: 'PAPER — chạy thử, không tiền thật. Backtest 231 trận: PnL +21u, win rate trung bình ~62%. Forward-test đang chạy để xác nhận edge.',
    short: '🌐 PAPER · XỈU · International 20p · 5 conditions (tỉ số + phút) · EV +0.09/trận · book mở → vào ngay.',
  },

  // ── Handicap models (paper) — key riêng 'HCAP:A|B|C' (không phải calc_version, không chạy pm2). ──
  'HCAP:A': {
    emoji: '📈',
    headline: 'HC-A · Trên tiếp H2 (16p): đội mạnh dẫn ≥3 bàn hết H1 → đầu H2 bắt tiếp kèo ĐỘI MẠNH (chấp FT).',
    side: 'Kèo ĐỘI MẠNH (đội chấp, chấp FT) · trận 16p',
    when: 'Đầu hiệp 2 — chờ nhà cái mở book (tới phút 42) mới vào.',
    strategy: [
      'Chấp đầu trận (FT, lúc H1) ≥ 1,5 — tức nhà cái đánh giá 1 đội mạnh hẳn.',
      'Cuối H1: đội mạnh (đội chấp) đang dẫn ≥ 3 bàn.',
      '→ Đầu H2 bắt kèo ĐỘI MẠNH (chấp FT), BẤT CHẤP mức chấp (kỳ vọng đội mạnh tiếp tục ăn bàn).',
      'Né lúc nhà cái khoá: chờ book mở (canh tới phút 42) mới vào.',
    ],
    data: [READ_ODDS, 'Mức chấp FT lúc H1, tỉ số cuối H1, cửa chấp đội mạnh đầu H2.', 'Chấm theo TỈ SỐ CUỐI TRẬN.'],
    entry: [
      'Chấp FT (lúc H1) ≥ 1,5.',
      'Cuối H1: đội mạnh dẫn ≥ 3 bàn.',
      'Đầu H2, book mở (tới phút 42) → bắt kèo ĐỘI MẠNH (chấp FT).',
    ],
    note: 'PAPER — chạy thử, không tiền. Chấm theo tỉ số cuối trận.',
    short: '📈 PAPER · HC-A · chấp FT ≥1,5 + đội mạnh dẫn ≥3 hết H1 → đầu H2 bắt ĐỘI MẠNH (chấp FT), chờ book mở tới phút 42.',
  },
  'HCAP:B': {
    emoji: '↩️',
    headline: 'HC-B · Ngược dưới + Tài (20p + Quốc tế): đội mạnh 3–4 bàn / đội yếu 0 hết H1 → đầu H2 bắt ĐỘI YẾU (chấp FT) + TÀI.',
    side: 'Kèo ĐỘI YẾU (chấp FT) + TÀI (Over) · trận 20p Quốc tế',
    when: 'Đầu hiệp 2 — mỗi kèo chờ book của nó mở (né khoá, tới phút 42).',
    strategy: [
      'Cuối H1: đội mạnh ghi 3 HOẶC 4 bàn VÀ đội yếu 0 bàn.',
      '→ Đầu H2 bắt 2 kèo: (1) kèo ĐỘI YẾU (chấp FT) — kỳ vọng đội yếu gỡ/bù chấp; (2) TÀI (Over) — kỳ vọng còn thêm bàn.',
      'Mỗi kèo chấm ăn/thua RIÊNG, mỗi kèo chờ book của nó mở.',
      'Né lúc khoá (canh tới phút 42).',
    ],
    data: [READ_ODDS, 'Tỉ số cuối H1 (đội mạnh 3–4, đội yếu 0), cửa chấp đội yếu + cửa Tài đầu H2.', 'Chấm theo TỈ SỐ CUỐI TRẬN (mỗi kèo riêng).'],
    entry: [
      'Cuối H1: đội mạnh 3 hoặc 4 bàn VÀ đội yếu 0 bàn.',
      'Đầu H2, book mở (tới phút 42): bắt (1) ĐỘI YẾU (chấp FT) + (2) TÀI (Over) — mỗi kèo chờ book riêng.',
    ],
    note: 'PAPER — chạy thử, không tiền. 2 kèo/trận, chấm riêng. Chấm theo tỉ số cuối trận.',
    short: '↩️ PAPER · HC-B · đội mạnh 3–4/đội yếu 0 hết H1 → đầu H2 bắt ĐỘI YẾU (chấp FT) + TÀI, mỗi kèo chờ book riêng (tới phút 42).',
  },
  'HCAP:C': {
    emoji: '🛡️',
    headline: 'HC-C · Thua ít (16p): phút 34–36 H2 tỉ số 4-0 hoặc 5-0 → bắt ĐỘI YẾU (chấp FT), kỳ vọng thua ít.',
    side: 'Kèo ĐỘI YẾU (chấp FT) · trận 16p',
    when: 'Trong khoảng phút 34–36 của hiệp 2 — chờ book mở mới vào.',
    strategy: [
      'Phút 34–36 hiệp 2, tỉ số 4-0 hoặc 5-0 (đội mạnh 4/5, đội yếu 0).',
      '→ Bắt kèo ĐỘI YẾU (chấp FT), kỳ vọng THUA ÍT (cover phần chấp còn lại).',
      'Trong [34,36] chờ book mở mới vào.',
    ],
    data: [READ_ODDS, 'Tỉ số phút 34–36 H2 (4-0/5-0), cửa chấp đội yếu.', 'Chấm theo TỈ SỐ CUỐI TRẬN.'],
    entry: [
      'Phút 34–36 hiệp 2, tỉ số 4-0 hoặc 5-0.',
      'Book mở trong [34,36] → bắt ĐỘI YẾU (chấp FT).',
    ],
    note: 'PAPER — chạy thử, không tiền. Nhánh 20p cần "đội yếu tấn công được" — HOÃN vì thiếu SOT/xG. Chấm theo tỉ số cuối trận.',
    short: '🛡️ PAPER · HC-C · phút 34–36 H2 tỉ số 4-0/5-0 → bắt ĐỘI YẾU (chấp FT) kỳ vọng thua ít, chờ book mở.',
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

// ── 'NVT - CLB - RH2 Real' — bot TIỀN THẬT của group NVT-CLB-Real (-1003853799847) ──────────
// ⚠️ TỪ 2026-08-21 RULE VÀO LỆNH KHÁC BOT PAPER — CỐ Ý, để chạy đối chứng A/B.
// Engine real (tx-paper-bot-nvt-clb-rh2-real.mjs) thêm 2 bộ lọc vào lệnh CHỈ có ở bản tiền thật:
//   F1 — bỏ chân hiệp 1 nếu tỉ số đang 0-0 tại phút vào lệnh.
//   F2 — chân hiệp 2 chỉ vào khi line mở CẢ TRẬN > 3.0; không tra được line mở thì bỏ (fail-closed).
// Bot paper 'NVT - CLB - RH2' GIỮ NGUYÊN rule cũ làm nhóm đối chứng — KHÔNG sửa entry đó.
// Cách CHẤM/SETTLE vẫn giống hệt paper → vẫn kế thừa nguyên `data` (mô tả cách chấm) từ paper.
// Lệnh trước/sau 2026-08-21 phân biệt trên DB bằng field snapshot.filterVersion = 'F1+F2-20260821'.
TX_RULES['NVT - CLB - RH2 Real'] = {
  ...TX_RULES['NVT - CLB - RH2'],
  emoji: '💰',
  headline: 'TIỀN THẬT — ⚠️ TỪ 2026-08-21 RULE VÀO LỆNH KHÁC bot paper "NVT - CLB - RH2" (cố ý, để chạy đối chứng A/B): thêm 2 BỘ LỌC F1 + F2 chỉ có ở bản tiền thật. Nền không đổi: đánh TÀI, CHỈ giải Câu Lạc Bộ 20 phút (leagueId 1508), hiệp 1 đánh KÈO TÀI/XỈU HIỆP 1 (chấm theo bàn hiệp 1) vào phút 33, hiệp 2 đánh KÈO TÀI/XỈU CẢ TRẬN (chấm theo bàn cả trận) cắm cờ phút 29 — vào phút 34. MỚI: F1 — BỎ chân hiệp 1 nếu tỉ số đang 0-0 lúc vào lệnh; F2 — chân hiệp 2 CHỈ vào khi line mở cả trận > 3.0, không tra được line mở thì BỎ. Cách CHẤM/SETTLE vẫn Y HỆT bot paper.',
  side: 'Đánh TÀI (Over) — hiệp 1 trên mức kèo HIỆP 1 (chỉ khi đã có bàn), hiệp 2 trên mức kèo CẢ TRẬN (chỉ khi line mở > 3.0) — tối đa 1 lệnh/hiệp, 2 lệnh/trận',
  when: 'Hiệp 1: phút 33, CHỈ vào nếu tỉ số đang KHÁC 0-0 (bộ lọc F1). Hiệp 2: cắm cờ phút 29, tới phút 34 vào nếu tỉ số vẫn y nguyên VÀ line mở cả trận > 3.0 (bộ lọc F2). Cả 2 hiệp: đang bị khoá kèo thì KHÔNG vào, chờ mở khoá — phút vào thực tế có thể là 35, 36, 38...',
  strategy: [
    '⚠️ KHÁC BOT PAPER TỪ 2026-08-21 — CỐ Ý: bản tiền thật thêm 2 BỘ LỌC VÀO LỆNH (F1 + F2) mà bot paper "NVT - CLB - RH2" KHÔNG có. Bot paper giữ nguyên rule cũ để làm NHÓM ĐỐI CHỨNG A/B. Rule CHẤM/SETTLE của hai con vẫn giống hệt nhau, chỉ khác ở điều kiện VÀO LỆNH.',
    'F1 — CHÂN HIỆP 1 (mới): tới phút 33 mà tỉ số vẫn đang 0-0 thì BỎ HẲN chân hiệp 1, không vào lệnh. Phải đã có ít nhất 1 bàn mới vào TÀI. (Backtest 421 trận giải 1508: nhánh 0-0 thắng 38,2% / n=131 — dưới mức hoà vốn 42,7% ⇒ ROI −8,0%; nhánh đã có bàn thắng 45,5% / n=290 ⇒ ROI +7,1%.)',
    'F2 — CHÂN HIỆP 2 (mới): CHỈ vào khi LINE MỞ CẢ TRẬN (mức Tài/Xỉu cả trận nhà cái treo đầu tiên cho trận đó) LỚN HƠN 3.0. Không tra được line mở → BỎ chân hiệp 2 (fail-closed: thà bỏ còn hơn đánh mù). (Backtest: line mở > 3.0 thắng 52,8% / n=195 ⇒ ROI +18,9%, ổn định 3 ngày liền; line mở ≤ 3.0 thắng 36,5% / n=148 ⇒ chỉ hoà vốn, không đáng đánh. Khoảng 10% trận thiếu dữ liệu line mở sẽ bị bỏ.)',
    '📊 XEM THỐNG KÊ NHỚ TÁCH 2 GIAI ĐOẠN: lệnh TRƯỚC 2026-08-21 của chính con này chạy RULE CŨ (chưa có F1/F2) nên KHÔNG gộp chung / không so trực tiếp với lệnh sau đó được. Trên dữ liệu phân biệt bằng field snapshot.filterVersion = \'F1+F2-20260821\' — lệnh có nhãn này là lệnh đã qua 2 bộ lọc mới.',
    '— Phần dưới đây là RULE NỀN, giống bot paper. Rule nền ĐÃ CÓ SẴN A30 (cắm cờ phút 30 → vào phút 33 nếu chưa có bàn); F1/F2 ở trên là phần CỘNG THÊM —',
    ...TX_RULES['NVT - CLB - RH2'].strategy,
  ],
  entry: [
    'Trận thuộc giải Câu Lạc Bộ 20 phút (leagueId 1508).',
    'HIỆP 1 — có bộ lọc F1 (mới 2026-08-21): tới phút 33 VÀ tỉ số đang KHÁC 0-0 → vào TÀI trên mức kèo HIỆP 1. Đang 0-0 → BỎ chân hiệp 1.',
    'HIỆP 2 — có bộ lọc F2 (mới 2026-08-21): đã cắm cờ phút 29, đã tới phút 34, từ mốc nền KHÔNG có thêm bàn nào, VÀ line mở cả trận > 3.0 → vào TÀI trên mức kèo CẢ TRẬN. Line mở ≤ 3.0 hoặc không tra được line mở → BỎ chân hiệp 2.',
    'Nhà cái đang MỞ KÈO — đủ cả 3 tầng: trận đang nhận cược, trận không bị tạm dừng, và riêng mức Tài/Xỉu của hiệp đó cũng không bị khoá. Đang khoá thì chỉ chờ, TUYỆT ĐỐI không vào.',
    'Nhà cái đã đẩy mức kèo của đúng thị trường hiệp đó, và đọc được mức + giá cửa Tài ra số hợp lệ — KHÔNG chặn giá, giá âm/0/dương đều vào. Chưa có mức thì tính là lỗi kỹ thuật (tối đa 3 lần thử lại).',
    'Hiệp đó chưa có lệnh nào (1 lệnh/hiệp, tối đa 2 lệnh/trận) → đặt lệnh TIỀN THẬT, ghi lại mã vé + đúng hiệp và phút thực tế lúc vào.',
    'Ba khoá độc lập của bản tiền thật, thiếu một khoá là KHÔNG đặt lệnh: đã bật bằng /start, đã nạp token bằng /settoken, đã đặt mức tiền bằng /setmoney.',
  ],
  note: 'TIỀN THẬT — đặt lệnh trực tiếp lên nhà cái, ghi lại mã vé cho từng lệnh. Ví/token/tiền RIÊNG của group này, KHÔNG dùng chung với bất kỳ bot nào khác. ⚠️ TỪ 2026-08-21 rule VÀO LỆNH KHÁC bot paper (thêm F1 + F2) — đây là CHỦ ĐÍCH để chạy đối chứng A/B: paper = rule cũ, real = rule có lọc. Rule CHẤM/SETTLE của hai con vẫn giống hệt nhau. ⚠️ Lệnh TRƯỚC 2026-08-21 của chính con này chạy rule cũ (chưa có bộ lọc) — xem thống kê phải TÁCH 2 GIAI ĐOẠN, nhận biết bằng field snapshot.filterVersion = \'F1+F2-20260821\'. Đọc bảng chi tiết nhớ phân biệt: dòng hiệp 1 là KÈO HIỆP 1 nên mức nhỏ (khoảng 1,5-2,0); dòng hiệp 2 là KÈO CẢ TRẬN nên mức lớn hơn (khoảng 3,0-3,5) — hai loại kèo này KHÔNG so mức trực tiếp với nhau được.',
  short: '💰 TIỀN THẬT · CLB 20p · ⚠️ TỪ 21/08 RULE VÀO LỆNH KHÁC PAPER (đối chứng A/B) · H1 (A30): cắm cờ phút 30, phút 33 vào TÀI trên KÈO HIỆP 1 nếu tỉ số chưa đổi — có bàn từ phút 30 là HUỶ, thấy trận sau phút 30 thì bỏ hẳn — và BỎ nếu đang 0-0 (F1) · H2: cắm cờ phút 29, phút 34 vào TÀI trên KÈO CẢ TRẬN nếu chưa có bàn VÀ line mở cả trận > 3.0 (F2 — không tra được line mở thì bỏ) · KHÔNG chặn giá · khoá kèo thì chờ mở · 1 lệnh/hiệp · CHẤM y hệt paper · lệnh trước 21/08 chạy rule cũ (nhãn snapshot.filterVersion=F1+F2-20260821).',
};

// ── 'NVT - CLB - RH2 - F1' — bot PAPER chạy ĐÚNG RULE CỦA BẢN TIỀN THẬT (A30 + F1 + F2) ──────
// Vì sao có con này: 'NVT - CLB - RH2 Real' phụ thuộc ví (hết tiền / token hỏng / /stop là ngừng
// ra lệnh), nên chuỗi dữ liệu bị đứt. Con này chạy paper 24/7 với ĐÚNG rule đó ⇒ đo được phần
// đóng góp thật của bộ lọc F1+F2 mà không đứt đoạn. Bộ 3 đối chứng:
//   'NVT - CLB - RH2'      = A30, không lọc  (đối chứng)
//   'NVT - CLB - RH2 - F1' = A30 + F1 + F2, KHÔNG tiền   ← khối này
//   'NVT - CLB - RH2 Real' = A30 + F1 + F2, TIỀN THẬT
// Kế thừa `data` (cách chấm) + phần cuối `strategy` từ con paper vì cách CHẤM/SETTLE y hệt.
TX_RULES['NVT - CLB - RH2 - F1'] = {
  ...TX_RULES['NVT - CLB - RH2'],
  emoji: '🧪',
  headline: 'PAPER — KHÔNG đặt tiền, KHÔNG bắn thông báo (chạy ngầm). Rule VÀO LỆNH GIỐNG HỆT bot tiền thật "NVT - CLB - RH2 Real" (A30 + F1 + F2). KHÁC bot paper "NVT - CLB - RH2" ở chỗ CÓ THÊM 2 bộ lọc F1 + F2. Nền chung: đánh TÀI, CHỈ giải Câu Lạc Bộ 20 phút (leagueId 1508); hiệp 1 đánh KÈO TÀI/XỈU HIỆP 1 (chấm theo bàn hiệp 1), hiệp 2 đánh KÈO TÀI/XỈU CẢ TRẬN (chấm theo bàn cả trận).',
  side: 'Đánh TÀI (Over) — PAPER (mô phỏng, không tiền) — hiệp 1 trên mức kèo HIỆP 1 (chỉ khi đã có bàn), hiệp 2 trên mức kèo CẢ TRẬN (chỉ khi line mở > 3.0) — tối đa 1 lệnh/hiệp, 2 lệnh/trận',
  when: 'Hiệp 1: cắm cờ phút 30, tới phút 33 vào nếu tỉ số CHƯA đổi (A30) VÀ tỉ số đang KHÁC 0-0 (F1). Hiệp 2: cắm cờ phút 29, tới phút 34 vào nếu tỉ số vẫn y nguyên VÀ line mở cả trận > 3.0 (F2). Cả 2 hiệp: đang bị khoá kèo thì KHÔNG vào, chờ mở khoá — phút vào thực tế có thể là 35, 36, 38...',
  strategy: [
    '🧪 ĐÂY LÀ BẢN PAPER CỦA CON TIỀN THẬT: rule VÀO LỆNH sao chép nguyên vẹn từ "NVT - CLB - RH2 Real" (A30 + F1 + F2), nhưng KHÔNG đặt một đồng nào và KHÔNG bắn thông báo Telegram. Mục đích: có một chuỗi dữ liệu LIÊN TỤC, không bị đứt khi ví hết tiền / token hỏng / bot thật bị tắt.',
    '⚠️ VÌ VẬY SỐ LỆNH CỦA 2 CON SẼ KHÁC NHAU — VÀ ĐÓ LÀ BÌNH THƯỜNG: bot tiền thật có thể ngừng ra lệnh giữa chừng (hết tiền, token hỏng, bị /stop), còn con này chạy liên tục không đứt. Khi so sánh 2 con, đừng kết luận "lệch = lỗi"; hãy so trên cùng khoảng thời gian mà cả hai đều đang hoạt động.',
    '⚠️ KHÁC BOT PAPER "NVT - CLB - RH2": con kia KHÔNG có F1 và F2 — nó là NHÓM ĐỐI CHỨNG. So 2 con này với nhau chính là đo phần đóng góp thật của bộ lọc.',
    'A30 — CHÂN HIỆP 1 (có ở CẢ BA con): cắm cờ ở phút 30 (ghi tổng bàn hiệp 1 làm nền), theo dõi tới phút 33; có thêm bàn BẤT KỲ LÚC NÀO thì HUỶ hẳn hiệp 1. Thấy trận lần đầu khi đã qua phút 30 → bỏ hẳn hiệp 1 (không có mốc nền thì không đoán mò).',
    'F1 — CHÂN HIỆP 1: tới phút 33 mà tỉ số vẫn đang 0-0 thì BỎ HẲN chân hiệp 1. Phải đã có ít nhất 1 bàn mới vào TÀI. (Backtest 421 trận giải 1508: nhánh 0-0 thắng 38,2% / n=131 — dưới mức hoà vốn 42,7% ⇒ ROI −8,0%; nhánh đã có bàn thắng 45,5% / n=290 ⇒ ROI +7,1%.)',
    'F2 — CHÂN HIỆP 2: CHỈ vào khi LINE MỞ CẢ TRẬN (mức Tài/Xỉu cả trận nhà cái treo đầu tiên cho trận đó) LỚN HƠN 3.0. Không tra được line mở → BỎ chân hiệp 2 (thà bỏ còn hơn đánh mù). (Backtest: line mở > 3.0 thắng 52,8% / n=195 ⇒ ROI +18,9%; line mở ≤ 3.0 thắng 36,5% / n=148 ⇒ chỉ hoà vốn. Khoảng 10% trận thiếu dữ liệu line mở sẽ bị bỏ.)',
    'THỨ TỰ CỔNG CHÂN HIỆP 1: A30 (huỷ vì có bàn) xét TRƯỚC, F1 (0-0) xét SAU — vì A30 nổ được ngay từ phút 30, sớm hơn thời điểm F1 được định nghĩa (phút 33).',
    '📊 Nhận biết trên dữ liệu: mọi lệnh của con này mang nhãn snapshot.filterVersion = \'A30+F1+F2-20260821\' — trùng nhãn với bot tiền thật (cùng bộ rule); phân biệt 2 con bằng calc_version.',
    '— Phần dưới đây là RULE NỀN, giống bot paper đối chứng. Rule nền ĐÃ CÓ SẴN A30 (cắm cờ phút 30 → vào phút 33 nếu chưa có bàn); F1/F2 ở trên là phần CỘNG THÊM —',
    ...TX_RULES['NVT - CLB - RH2'].strategy,
  ],
  entry: [
    'Trận thuộc giải Câu Lạc Bộ 20 phút (leagueId 1508).',
    'HIỆP 1 — A30 + F1: đã cắm cờ ở phút 30, đã tới phút 33, từ mốc nền KHÔNG có thêm bàn nào, VÀ tỉ số đang KHÁC 0-0 → vào TÀI trên mức kèo HIỆP 1. Đang 0-0 → BỎ chân hiệp 1.',
    'HIỆP 2 — F2: đã cắm cờ phút 29, đã tới phút 34, từ mốc nền KHÔNG có thêm bàn nào, VÀ line mở cả trận > 3.0 → vào TÀI trên mức kèo CẢ TRẬN. Line mở ≤ 3.0 hoặc không tra được → BỎ chân hiệp 2.',
    'Nhà cái đang MỞ KÈO — đủ cả 3 tầng: trận đang nhận cược, trận không bị tạm dừng, và riêng mức Tài/Xỉu của hiệp đó cũng không bị khoá. Đang khoá thì chỉ chờ, TUYỆT ĐỐI không vào.',
    'Nhà cái đã đẩy mức kèo của đúng thị trường hiệp đó, và đọc được mức + giá cửa Tài ra số hợp lệ — KHÔNG chặn giá, giá âm/0/dương đều vào. Chưa có mức thì tính là lỗi kỹ thuật (tối đa 3 lần thử lại).',
    'Hiệp đó chưa có lệnh nào (1 lệnh/hiệp, tối đa 2 lệnh/trận) → ghi 1 lệnh MÔ PHỎNG (không tiền, không mã vé), kèm đúng hiệp + phút thực tế lúc vào.',
  ],
  note: 'PAPER 100% — KHÔNG gọi API đặt cược ở bất kỳ nhánh code nào, KHÔNG đọc ví, KHÔNG có mức tiền, KHÔNG có mã vé. CHẠY NGẦM: Telegram tắt hẳn, không bắn thông báo. Rule VÀO LỆNH giống hệt bot tiền thật "NVT - CLB - RH2 Real"; khác bot paper "NVT - CLB - RH2" đúng ở 2 bộ lọc F1 + F2. Cách CHẤM/SETTLE của cả ba con giống hệt nhau. ⚠️ SỐ LỆNH của con này và con tiền thật SẼ KHÁC NHAU và đó là BÌNH THƯỜNG — con tiền thật có thể ngừng đặt vì hết tiền / token hỏng / bị /stop, còn con này chạy liên tục nên chuỗi dữ liệu không đứt. ⚠️ Đọc bảng chi tiết nhớ phân biệt: dòng hiệp 1 là KÈO HIỆP 1 nên mức nhỏ (khoảng 1,5-2,0) và chấm theo bàn hiệp 1; dòng hiệp 2 là KÈO CẢ TRẬN nên mức lớn hơn (khoảng 3,0-3,5) và chấm theo bàn cả trận — không so mức trực tiếp với nhau được.',
  short: '🧪 PAPER (không tiền, không noti) · CLB 20p · RULE Y HỆT BẢN TIỀN THẬT: A30 + F1 + F2 · H1 (A30) cắm cờ phút 30 ghi tỉ số nền — có bàn bất kỳ lúc nào là HUỶ, thấy trận lần đầu sau phút 30 thì bỏ hẳn — vào phút 33 nếu chưa có bàn VÀ đang KHÁC 0-0 (F1), trên KÈO HIỆP 1 · H2 cắm cờ phút 29, vào phút 34 nếu chưa có bàn VÀ line mở cả trận > 3.0 (F2), trên KÈO CẢ TRẬN · khác bot paper "NVT - CLB - RH2" đúng ở F1+F2 (con kia là nhóm đối chứng) · số lệnh khác con tiền thật là bình thường (con này không bị đứt chuỗi).',
};

// ── 'NVT - CLUB - N Real' + 'NVT - CLUB - K Real' — 2 bot TIỀN THẬT ví RIÊNG (2026-08-21) ────
// Rule VÀO LỆNH sao chép NGUYÊN VẸN từ 'NVT - CLB - RH2 Real' (A30 + F1 + F2). Khác nhau ĐÚNG ở
// VÍ: mỗi con một money-config riêng, một group Telegram riêng, một calc_version riêng ⇒ PnL,
// /pnl, /active tách bạch hoàn toàn. KHÔNG kế thừa từ entry 'NVT - CLB - RH2 Real' vì entry đó
// mang phần "lệnh trước 21/08 chạy rule cũ" — không đúng với 2 con mới (sinh ra đã có đủ A30+F1+F2).
const NVT_CLUB_REAL_BASE: TxRule = {
  ...TX_RULES['NVT - CLB - RH2'],
  emoji: '💰',
  headline:
    'TIỀN THẬT — VÍ RIÊNG. Rule VÀO LỆNH giống hệt bot "NVT - CLB - RH2 Real": đánh TÀI, CHỈ giải Câu Lạc Bộ 20 phút (leagueId 1508), đủ bộ A30 + F1 + F2 ngay từ lệnh đầu tiên. Hiệp 1 đánh KÈO TÀI/XỈU HIỆP 1 (chấm theo bàn hiệp 1): cắm cờ phút 30, vào phút 33 nếu CHƯA có thêm bàn (A30) VÀ tỉ số đang KHÁC 0-0 (F1). Hiệp 2 đánh KÈO TÀI/XỈU CẢ TRẬN (chấm theo bàn cả trận): cắm cờ phút 29, vào phút 34 nếu tỉ số vẫn y nguyên VÀ line mở cả trận > 3.0 (F2).',
  side:
    'Đánh TÀI (Over) — TIỀN THẬT — hiệp 1 trên mức kèo HIỆP 1 (chỉ khi đã có bàn), hiệp 2 trên mức kèo CẢ TRẬN (chỉ khi line mở > 3.0) — tối đa 1 lệnh/hiệp, 2 lệnh/trận',
  when:
    'Hiệp 1: cắm cờ phút 30, tới phút 33 vào nếu tỉ số CHƯA đổi (A30) VÀ đang KHÁC 0-0 (F1). Hiệp 2: cắm cờ phút 29, tới phút 34 vào nếu tỉ số vẫn y nguyên VÀ line mở cả trận > 3.0 (F2). Cả 2 hiệp: đang bị khoá kèo thì KHÔNG vào, chờ mở khoá — phút vào thực tế có thể là 35, 36, 38...',
  strategy: [
    '💰 BOT TIỀN THẬT, VÍ HOÀN TOÀN RIÊNG: token, mức tiền và công tắc bật/tắt của con này nằm trong file cấu hình RIÊNG của group nó, KHÔNG dùng chung với "NVT - CLB - RH2 Real" và KHÔNG dùng chung với con còn lại. Mỗi group tự /settoken, tự /setmoney, tự /start /stop; số liệu /pnl và /active cũng chỉ tính riêng cho con của group đó.',
    '🔑 BA KHOÁ ĐỘC LẬP — thiếu một khoá là KHÔNG đặt một đồng nào: (1) đã BẬT bằng /start, (2) đã nạp token bằng /settoken, (3) đã đặt mức tiền > 0 bằng /setmoney. Lúc mới dựng, cả ba khoá đều TẮT (token rỗng, tiền 0, chưa bật) nên bot chạy nhưng KHÔNG cược.',
    '⚠️ CẢNH BÁO CHUNG VÍ: nếu nạp CÙNG MỘT token cho nhiều group thì các bot đó dùng CHUNG một tài khoản nhà cái — mức cược cộng dồn trên cùng một trận, dù báo cáo vẫn tách riêng. Hệ thống KHÔNG tự chặn được. Muốn tách thật thì mỗi group một token của một tài khoản khác nhau.',
    'A30 — CHÂN HIỆP 1: cắm cờ ở phút 30 (ghi tổng bàn hiệp 1 làm nền), theo dõi tới phút 33; có thêm bàn BẤT KỲ LÚC NÀO thì HUỶ hẳn hiệp 1. Thấy trận lần đầu khi đã qua phút 30 → bỏ hẳn hiệp 1 (không có mốc nền thì không đoán mò).',
    'F1 — CHÂN HIỆP 1: tới phút 33 mà tỉ số vẫn đang 0-0 thì BỎ HẲN chân hiệp 1. Phải đã có ít nhất 1 bàn mới vào TÀI. (Backtest 421 trận giải 1508: nhánh 0-0 thắng 38,2% / n=131 — dưới mức hoà vốn 42,7% ⇒ ROI −8,0%; nhánh đã có bàn thắng 45,5% / n=290 ⇒ ROI +7,1%.)',
    'F2 — CHÂN HIỆP 2: CHỈ vào khi LINE MỞ CẢ TRẬN (mức Tài/Xỉu cả trận nhà cái treo đầu tiên cho trận đó) LỚN HƠN 3.0. Không tra được line mở → BỎ chân hiệp 2 (thà bỏ còn hơn đánh mù). (Backtest: line mở > 3.0 thắng 52,8% / n=195 ⇒ ROI +18,9%; line mở ≤ 3.0 thắng 36,5% / n=148 ⇒ chỉ hoà vốn. Khoảng 10% trận thiếu dữ liệu line mở sẽ bị bỏ.)',
    'THỨ TỰ CỔNG CHÂN HIỆP 1: A30 (huỷ vì có bàn) xét TRƯỚC, F1 (0-0) xét SAU — vì A30 nổ được ngay từ phút 30, sớm hơn thời điểm F1 được định nghĩa (phút 33).',
    '🧾 KHÔNG GHI SỔ KHI LỆNH KHÔNG VÀO: chỉ khi nhà cái xác nhận đã nhận lệnh (có mã vé thật) thì bot mới ghi vào sổ. Nhà cái từ chối → thử lại, không ghi. Mất phản hồi giữa chừng → BỎ hẳn hiệp đó và KHÔNG đặt lại (tránh cược đúp), cũng không ghi sổ. Nhờ vậy PnL trên bảng phản ánh đúng tiền đã thực sự đặt.',
    '📊 Nhận biết trên dữ liệu: mọi lệnh của con này mang nhãn snapshot.filterVersion = \'A30+F1+F2-20260821\' — trùng nhãn với "NVT - CLB - RH2 Real" và "NVT - CLB - RH2 - F1" (cùng bộ rule); phân biệt các con bằng calc_version.',
    '⚠️ CÙNG RULE, CÙNG GIẢI, CÙNG PHÚT: con này ra tín hiệu GIỐNG HỆT "NVT - CLB - RH2 Real" và con CLUB còn lại. Số lệnh có thể lệch nhau do ví bị tắt/hết tiền/token hỏng ở từng con — lệch KHÔNG có nghĩa là lỗi.',
    '— Phần dưới đây là RULE NỀN, giống bot paper đối chứng. Rule nền ĐÃ CÓ SẴN A30 (cắm cờ phút 30 → vào phút 33 nếu chưa có bàn); F1/F2 ở trên là phần CỘNG THÊM —',
    ...TX_RULES['NVT - CLB - RH2'].strategy,
  ],
  entry: [
    'Trận thuộc giải Câu Lạc Bộ 20 phút (leagueId 1508).',
    'HIỆP 1 — A30 + F1: đã cắm cờ ở phút 30, đã tới phút 33, từ mốc nền KHÔNG có thêm bàn nào, VÀ tỉ số đang KHÁC 0-0 → vào TÀI trên mức kèo HIỆP 1. Đang 0-0 → BỎ chân hiệp 1.',
    'HIỆP 2 — F2: đã cắm cờ phút 29, đã tới phút 34, từ mốc nền KHÔNG có thêm bàn nào, VÀ line mở cả trận > 3.0 → vào TÀI trên mức kèo CẢ TRẬN. Line mở ≤ 3.0 hoặc không tra được → BỎ chân hiệp 2.',
    'Nhà cái đang MỞ KÈO — đủ cả 3 tầng: trận đang nhận cược, trận không bị tạm dừng, và riêng mức Tài/Xỉu của hiệp đó cũng không bị khoá. Đang khoá thì chỉ chờ, TUYỆT ĐỐI không vào.',
    'Nhà cái đã đẩy mức kèo của đúng thị trường hiệp đó, và đọc được mức + giá cửa Tài ra số hợp lệ — KHÔNG chặn giá, giá âm/0/dương đều vào. Chưa có mức thì tính là lỗi kỹ thuật (tối đa 3 lần thử lại).',
    'ĐỦ BA KHOÁ VÍ của group này: đã /start, đã /settoken, đã /setmoney > 0. Thiếu bất kỳ khoá nào → bot bỏ qua, KHÔNG mượn ví/token của bất kỳ group nào khác.',
    'Hiệp đó chưa có lệnh nào (1 lệnh/hiệp, tối đa 2 lệnh/trận) → đặt lệnh TIỀN THẬT, ghi lại mã vé + đúng hiệp và phút thực tế lúc vào.',
  ],
  note:
    'TIỀN THẬT — đặt lệnh trực tiếp lên nhà cái, ghi lại mã vé cho từng lệnh. VÍ / TOKEN / MỨC TIỀN RIÊNG TUYỆT ĐỐI cho group của con này: KHÔNG dùng chung với "NVT - CLB - RH2 Real", KHÔNG dùng chung với con CLUB còn lại, và KHÔNG lấy token gốc của hệ thống. Rule VÀO LỆNH và cách CHẤM/SETTLE giống hệt "NVT - CLB - RH2 Real" (A30 + F1 + F2) — con này sinh ra đã đủ bộ lọc nên KHÔNG có giai đoạn "rule cũ" phải tách như con RH2. Bot chỉ ghi sổ khi nhà cái xác nhận có mã vé thật ⇒ không có "lệnh ma". ⚠️ Đọc bảng chi tiết nhớ phân biệt: dòng hiệp 1 là KÈO HIỆP 1 nên mức nhỏ (khoảng 1,5-2,0) và chấm theo bàn hiệp 1; dòng hiệp 2 là KÈO CẢ TRẬN nên mức lớn hơn (khoảng 3,0-3,5) và chấm theo bàn cả trận — không so mức trực tiếp với nhau được. Lệnh group: /settoken 69-… → /setmoney <số> → /start · /stop · /pnl · /pnltotal · /active · /balance · /info.',
  short:
    '💰 TIỀN THẬT · VÍ RIÊNG · CLB 20p · RULE Y HỆT "NVT - CLB - RH2 Real": A30 + F1 + F2 · H1 (A30) cắm cờ phút 30 ghi tỉ số nền — có bàn bất kỳ lúc nào là HUỶ, thấy trận lần đầu sau phút 30 thì bỏ hẳn — vào phút 33 nếu chưa có bàn VÀ đang KHÁC 0-0, trên KÈO HIỆP 1 · H2 cắm cờ phút 29, vào phút 34 nếu chưa có bàn VÀ line mở cả trận > 3.0, trên KÈO CẢ TRẬN · KHÔNG chặn giá · khoá kèo thì chờ mở · 1 lệnh/hiệp · chỉ ghi sổ khi có mã vé thật · 3 khoá ví: /settoken → /setmoney → /start.',
};

TX_RULES['NVT - CLUB - N Real'] = {
  ...NVT_CLUB_REAL_BASE,
  note: 'Group Telegram: NVT - CLUB - N. Ví riêng: money-config-nvt-club-n.json · tiến trình gs-nvt-club-n-real. ' + NVT_CLUB_REAL_BASE.note,
};

TX_RULES['NVT - CLUB - K Real'] = {
  ...NVT_CLUB_REAL_BASE,
  note: 'Group Telegram: NVT - CLUB - K. Ví riêng: money-config-nvt-club-k.json · tiến trình gs-nvt-club-k-real. ' + NVT_CLUB_REAL_BASE.note,
};

// ── 'NVT-R-H1' + 'NVT-R-H2' (2026-08-22, user) ────────────────────────────────────────────────
// Hai bot PAPER chạy ngầm, dựng lại NGUYÊN VĂN rule "Top Rung" BẢN CŨ (bản trước 19:17 ngày
// 21/08, tức bản còn cổng giá PRICE_FLOOR = -0.85). Mục đích: giữ một chuỗi dữ liệu chạy đúng
// rule cũ để đối chứng, trong khi 2 bot TNK gốc đã đổi sang rule khác.
// Engine: tx-paper-bot-nvt-r-h1.mjs / tx-paper-bot-nvt-r-h2.mjs · pm2 gs-nvt-r-h1 / gs-nvt-r-h2.
const NVT_R_COMMON = [
  'CHỌN TRẬN: chỉ giải Câu Lạc Bộ 20 phút (leagueId 1508). Phải có ÍT NHẤT 1 đội (nhà hoặc khách) đạt ngưỡng trong bảng CLBV Analyst — xem dòng riêng của từng bot bên dưới.',
  'CẮM CỜ: lần đầu tiên thấy trận ở phút 29, 30 hoặc 31 thì ghi lại tỉ số hiện tại làm mốc nền. Nếu lần đầu thấy trận đã qua phút 31 (bot vừa khởi động lại, hoặc trận vào feed muộn) thì BỎ HẲN trận đó — không cắm cờ trễ, vì không biết đã có bàn nào từ phút 29 hay chưa.',
  'HUỶ: bất kỳ lúc nào kể từ khi cắm cờ mà tổng bàn vượt mốc nền → huỷ hẳn, không đánh trận đó nữa. Nói cách khác trận phải TỊT BÀN liên tục từ phút 29 tới lúc vào lệnh.',
  'CỬA SỔ VÀO LỆNH: chỉ trong phút 34 đến 38. Quá phút 38 mà chưa vào được thì bỏ hẳn trận, không chờ thêm.',
  'MỨC KÈO PHẢI KHỚP CHÍNH XÁC: chỉ nhận dòng có mức đúng bằng TỔNG BÀN HIỆN TẠI + 0,5. Không phải "gần bằng" — nhà cái không treo đúng mức đó thì bot đứng ngoài.',
  'KHOÁ KÈO: trận đang nhận cược, trận không bị tạm dừng, và riêng dòng kèo đó cũng không bị khoá — thiếu một trong ba thì chờ tiếp.',
  'Đánh TÀI, tối đa 1 lệnh mỗi trận.',
];

TX_RULES['NVT-R-H1'] = {
  emoji: '🅰️',
  headline: 'PAPER chạy ngầm. Bản sao rule "Top Rung H1" CŨ (trước 19:17 ngày 21/08). Trận tịt bàn từ phút 29 của HIỆP 1, vào TÀI ở phút 34-38 trên KÈO HIỆP 1, ăn nếu hiệp 1 còn thêm đúng 1 bàn.',
  side: 'Đánh TÀI (Over) trên mức kèo Tài/Xỉu HIỆP 1 — tối đa 1 lệnh/trận',
  when: 'Cắm cờ ở phút 29-31 của hiệp 1, vào lệnh trong phút 34-38 của hiệp 1 nếu tỉ số vẫn y nguyên mốc nền.',
  strategy: [
    'CHỌN TRẬN: cần ít nhất 1 đội có rung_h1_rate ≥ 60% VÀ rung_h1_n ≥ 10 trong bảng CLBV Analyst. Đội thoả gọi là "đội trigger". Đội không có trong bảng coi như KHÔNG đạt, không đoán mò.',
    ...NVT_R_COMMON,
    'ĐIỀU KIỆN RIÊNG CỦA BOT NÀY — CÒN CHỖ CHO BÀN: chỉ vào nếu TỔNG BÀN HIỆN TẠI + 1 < h1_tai_avg_goals của đội trigger. Ví dụ đội trigger có trung bình 3,08 bàn hiệp 1 thì chỉ vào khi tổng bàn đang ≤ 2. Thiếu số trung bình này thì CHỜ, không đoán.',
    'CỔNG GIÁ (bản CŨ): giá cửa Tài phải > −0,85 — nhận cả giá dương. Đây chính là chỗ khác bot TNK gốc hiện tại.',
    '⚠️ DÙNG THỊ TRƯỜNG HIỆP 1 RIÊNG: đọc mức từ danh sách kèo Tài/Xỉu HIỆP 1 (không phải kèo cả trận), và CHẤM theo TỔNG BÀN HIỆP 1.',
  ],
  data: [
    READ_ODDS,
    'Bảng CLBV Analyst: rung_h1_rate, rung_h1_n và h1_tai_avg_goals của từng đội (cửa sổ trượt 7 ngày, chỉ đổi khi bấm Sync).',
    'Chấm theo TỔNG BÀN HIỆP 1. Mức luôn là số nguyên + 0,5 nên không bao giờ hoà.',
  ],
  entry: [
    'Trận thuộc giải Câu Lạc Bộ 20 phút và có đội đạt ngưỡng rung_h1.',
    'Đã cắm cờ trong phút 29-31 của hiệp 1 và từ đó tới giờ KHÔNG có thêm bàn nào.',
    'Đang trong phút 34-38 của hiệp 1.',
    'Tổng bàn hiện tại + 1 < h1_tai_avg_goals của đội trigger.',
    'Có dòng kèo Tài/Xỉu HIỆP 1 với mức đúng bằng tổng bàn + 0,5, giá cửa Tài > −0,85.',
    'Kèo đang mở ở cả ba tầng (trận, tạm dừng, dòng kèo) → vào TÀI.',
  ],
  note: 'PAPER 100% — không có nhánh code nào gọi API đặt cược, không đọc ví, không bắn Telegram (chạy ngầm hoàn toàn). Rule sao chép nguyên văn từ bản .bak của bot TNK Top Rung H1 trước 19:17 ngày 21/08; đã đối chiếu 0 dòng code khác ngoài chuỗi định danh. ⚠️ Bot TNK gốc hiện ĐÃ ĐỔI rule (bỏ cổng giá, bỏ mốc phút tối đa) nên hai bên KHÔNG còn giống nhau — đó là lý do bot này tồn tại.',
  short: '🅰️ PAPER ngầm · CLB 20p · rung_h1 ≥ 60%/n10 · cắm cờ phút 29-31 hiệp 1, tịt bàn tới phút 34-38 thì vào TÀI trên KÈO HIỆP 1, mức = tổng bàn + 0,5, giá > −0,85 (nhận cả giá dương), thêm điều kiện tổng bàn + 1 < h1_tai_avg_goals đội trigger · 1 lệnh/trận · chấm theo bàn hiệp 1.',
};

TX_RULES['NVT-R-H2'] = {
  emoji: '🅱️',
  headline: 'PAPER chạy ngầm. Bản sao rule "Top Rung H2" CŨ (trước 19:17 ngày 21/08). Trận tịt bàn từ phút 29 của HIỆP 2, vào TÀI ở phút 34-38 trên KÈO CẢ TRẬN, ăn nếu còn thêm đúng 1 bàn.',
  side: 'Đánh TÀI (Over) trên mức kèo Tài/Xỉu CẢ TRẬN — tối đa 1 lệnh/trận',
  when: 'Cắm cờ ở phút 29-31 của hiệp 2, vào lệnh trong phút 34-38 của hiệp 2 nếu tỉ số vẫn y nguyên mốc nền.',
  strategy: [
    'CHỌN TRẬN: cần ít nhất 1 đội có rung_h2_rate ≥ 60% VÀ rung_h2_n ≥ 10 trong bảng CLBV Analyst. Đội không có trong bảng coi như KHÔNG đạt.',
    ...NVT_R_COMMON,
    'ĐIỀU KIỆN RIÊNG CỦA BOT NÀY — CÒN CHỖ CHO BÀN: chỉ vào nếu tổng bàn hiện tại < 5, HOẶC đang có ít nhất một đội bị thẻ đỏ. Nếu đã ≥ 5 bàn mà chưa có thẻ đỏ thì CHỜ tiếp (không huỷ) — thẻ đỏ có thể xuất hiện sau.',
    'CỔNG GIÁ (bản CŨ): giá cửa Tài phải ÂM và > −0,85, tức nằm trong khoảng −0,85 đến 0. Giá dương hoặc âm sâu hơn −0,85 đều bị loại. Đây chính là chỗ khác bot TNK gốc hiện tại.',
    'DÙNG KÈO CẢ TRẬN và CHẤM theo TỔNG BÀN CẢ TRẬN — vì nhà cái không treo kèo Tài/Xỉu hiệp 2 cho giải 1508.',
  ],
  data: [
    READ_ODDS,
    'Bảng CLBV Analyst: rung_h2_rate và rung_h2_n của từng đội (cửa sổ trượt 7 ngày, chỉ đổi khi bấm Sync).',
    'Số thẻ đỏ hai bên, để mở ngoại lệ khi trận đã ≥ 5 bàn.',
    'Chấm theo TỔNG BÀN CẢ TRẬN. Mức luôn là số nguyên + 0,5 nên không bao giờ hoà.',
  ],
  entry: [
    'Trận thuộc giải Câu Lạc Bộ 20 phút và có đội đạt ngưỡng rung_h2.',
    'Đã cắm cờ trong phút 29-31 của hiệp 2 và từ đó tới giờ KHÔNG có thêm bàn nào.',
    'Đang trong phút 34-38 của hiệp 2.',
    'Tổng bàn < 5, hoặc đang có thẻ đỏ.',
    'Có dòng kèo Tài/Xỉu CẢ TRẬN với mức đúng bằng tổng bàn + 0,5, giá cửa Tài trong khoảng −0,85 đến 0.',
    'Kèo đang mở ở cả ba tầng (trận, tạm dừng, dòng kèo) → vào TÀI.',
  ],
  note: 'PAPER 100% — không có nhánh code nào gọi API đặt cược, không đọc ví, không bắn Telegram (chạy ngầm hoàn toàn). Rule sao chép nguyên văn từ bản .bak của bot TNK Top Rung H2 trước 19:17 ngày 21/08; đã đối chiếu 0 dòng code khác ngoài chuỗi định danh. ⚠️ Bot TNK gốc hiện ĐÃ ĐỔI rule (bỏ cổng giá, bỏ mốc phút tối đa) nên hai bên KHÔNG còn giống nhau — đó là lý do bot này tồn tại.',
  short: '🅱️ PAPER ngầm · CLB 20p · rung_h2 ≥ 60%/n10 · cắm cờ phút 29-31 hiệp 2, tịt bàn tới phút 34-38 thì vào TÀI trên KÈO CẢ TRẬN, mức = tổng bàn + 0,5, giá phải ÂM và > −0,85 · thêm điều kiện tổng bàn < 5 hoặc có thẻ đỏ · 1 lệnh/trận · chấm theo bàn cả trận.',
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
