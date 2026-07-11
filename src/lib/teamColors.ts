export const TEAM_COLORS: Record<string, { bg: string; fg: string }> = {
  'Australia (V)': { bg: '#00843D', fg: '#fff' },
  'Australia (S)': { bg: '#4CAF50', fg: '#fff' },
  'Brunei (S)': { bg: '#F5A623', fg: '#000' },
  'Cambodia (S)': { bg: '#8B4513', fg: '#fff' },
  'China (V)': { bg: '#DE2910', fg: '#fff' },
  'China (S)': { bg: '#FF6B6B', fg: '#fff' },
  'India (V)': { bg: '#FF9933', fg: '#000' },
  'Indonesia (V)': { bg: '#CE1126', fg: '#fff' },
  'Indonesia (S)': { bg: '#FF7043', fg: '#fff' },
  'Iran (V)': { bg: '#239F40', fg: '#fff' },
  'Japan (V)': { bg: '#BC002D', fg: '#fff' },
  'Japan (S)': { bg: '#E91E63', fg: '#fff' },
  'Korea Republic (V)': { bg: '#003478', fg: '#fff' },
  'Korea Republic (S)': { bg: '#1565C0', fg: '#fff' },
  'Laos (S)': { bg: '#B71C1C', fg: '#FFD700' },
  'Malaysia (V)': { bg: '#CC0001', fg: '#fff' },
  'Malaysia (S)': { bg: '#D32F2F', fg: '#fff' },
  'Myanmar (S)': { bg: '#FFCC02', fg: '#000' },
  'New Zealand (V)': { bg: '#00247D', fg: '#fff' },
  'North Korea (V)': { bg: '#024FA2', fg: '#fff' },
  'Philippines (S)': { bg: '#0038A8', fg: '#fff' },
  'Qatar (V)': { bg: '#8D1B3D', fg: '#fff' },
  'Qatar (S)': { bg: '#AD1457', fg: '#fff' },
  'Saudi Arabia (V)': { bg: '#006C35', fg: '#fff' },
  'Saudi Arabia (S)': { bg: '#2E7D32', fg: '#fff' },
  'Singapore (S)': { bg: '#E53935', fg: '#fff' },
  'Thailand (V)': { bg: '#2D2A4A', fg: '#fff' },
  'Thailand (S)': { bg: '#7B1FA2', fg: '#fff' },
  'Vietnam (V)': { bg: '#DA251D', fg: '#fff' },
  'Vietnam (S)': { bg: '#C62828', fg: '#fff' },
};

export const DEFAULT_COLOR = { bg: '#607D8B', fg: '#fff' };

export function teamColor(name: string): { bg: string; fg: string } {
  return TEAM_COLORS[name] || DEFAULT_COLOR;
}
