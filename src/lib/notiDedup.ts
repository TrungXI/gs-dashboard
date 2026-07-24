// Chống noti TRÙNG cùng 1 sự kiện (bàn thắng / hết H1) giữa nhiều nguồn hoặc lần poll gần nhau
// (GSLive + RankingLive, race giữa interval poll và visibilitychange, StrictMode re-run…).
// Module-level → chia sẻ chung 1 instance cho mọi component import.
const seen = new Map<string, number>();

// Trả true nếu key CHƯA phát trong `ttlMs` gần đây (được phép noti); false nếu trùng (bỏ qua).
export function notiOnce(key: string, ttlMs = 8000): boolean {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > ttlMs) seen.delete(k); // dọn key cũ
  if (seen.has(key)) return false;
  seen.set(key, now);
  return true;
}
