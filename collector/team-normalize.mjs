// team-normalize.mjs
// VN→EN team-name normalization, duplicated from collector/collector.js (the
// K-Sport collector) so gs-saba-feed stays fully decoupled from that process.
// Do NOT import from collector.js — keep the two collectors independent.

export const VN_TO_EN = {
  'Nhật Bản': 'Japan', 'Hàn Quốc': 'Korea Republic', 'Trung Quốc': 'China',
  'Thái Lan': 'Thailand', 'Việt Nam': 'Vietnam', 'Ả Rập Xê Út': 'Saudi Arabia',
  'Ả Rập Saudi': 'Saudi Arabia', 'Úc': 'Australia', 'Ấn Độ': 'India',
  'Campuchia': 'Cambodia', 'Lào': 'Laos', 'Nga': 'Russia', 'Đức': 'Germany',
  'Pháp': 'France', 'Tây Ban Nha': 'Spain', 'Bồ Đào Nha': 'Portugal',
  'Hà Lan': 'Netherlands', 'Bỉ': 'Belgium', 'Thụy Sĩ': 'Switzerland(CHE)',
  'Thụy Điển': 'Sweden', 'Na Uy': 'Norway', 'Áo': 'Austria', 'Ý': 'Italy',
  'Anh': 'England', 'Maroc': 'Morocco', 'Mỹ': 'USA',
  'Viet Nam': 'Vietnam', 'South Korea': 'Korea Republic',
  'Republic of Korea': 'Korea Republic', 'DPR Korea': 'North Korea',
  'Korea DPR': 'North Korea',
};

export function normalizeTeam(name) {
  if (name == null) return name;
  const m = String(name).trim().match(/^(.+?)(\s+\([VS]\))?$/);
  if (!m) return String(name).trim();
  const base = m[1].trim();
  const suffix = m[2]?.trim() ? ` ${m[2].trim()}` : '';
  return ((VN_TO_EN[base] ?? base) + suffix).trim();
}
