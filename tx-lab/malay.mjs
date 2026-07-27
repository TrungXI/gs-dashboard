// malay.mjs — parse Malay odds text -> numeric price, and de-vig implied probs.
//
// Malay odds live in [-1, 1] (the DB stores them as text like "0.85", "-0.52").
//   price >= 0  : you stake 1, win returns +price profit (decimal = price + 1).
//   price <  0  : you stake |price| to win 1 (decimal = 1 + 1/|price|).
// This module is the ONLY place that interprets the ou_over / ou_under text.

// Parse a text (or already-numeric) Malay price into a signed float, clamped to
// the valid [-1, 1] Malay band. Returns null when unparseable (caller passes).
export function parseMalay(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return clampBand(raw);
  }
  const s = String(raw).trim();
  if (s === '' || s.toLowerCase() === 'null') return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return clampBand(v);
}

function clampBand(v) {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

// Malay price -> decimal odds. price 0 is treated as decimal 1.0 (no payout),
// but 0 essentially never occurs in the data (odds are ~[-1,1] non-zero).
export function malayToDecimal(price) {
  if (price >= 0) return price + 1;
  return 1 + 1 / Math.abs(price);
}

// Decimal odds -> raw implied probability (1/decimal).
export function decimalToImplied(dec) {
  return 1 / dec;
}

// De-vigged implied probabilities for the Tài/Xỉu pair from the two Malay
// prices. Returns { pTai, pXiu } normalized so pTai + pXiu = 1, or null if
// either price is missing/unparseable.
export function impliedProbFromMalayPair(overRaw, underRaw) {
  const over = typeof overRaw === 'number' ? overRaw : parseMalay(overRaw);
  const under = typeof underRaw === 'number' ? underRaw : parseMalay(underRaw);
  if (over === null || under === null) return null;
  const iTai = decimalToImplied(malayToDecimal(over));
  const iXiu = decimalToImplied(malayToDecimal(under));
  const sum = iTai + iXiu;
  if (sum <= 0) return null;
  return { pTai: iTai / sum, pXiu: iXiu / sum };
}
