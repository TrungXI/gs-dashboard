import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL });
  return pool;
}

function formatTeam(name: string): string {
  return name
    .replace(/ \(V\) \(20p\)$/, ' (V)')
    .replace(/ \(S\) \(16p\)$/, ' (S)')
    .replace(/ \(20p\)$/, ' (V)')
    .replace(/ \(16p\)$/, ' (S)');
}

// Live API uses Vietnamese names; DB stores English names
const VN_TO_EN: Record<string, string> = {
  'Nhật Bản': 'Japan',
  'Hàn Quốc': 'Korea Republic',
  'Trung Quốc': 'China',
  'Thái Lan': 'Thailand',
  'Việt Nam': 'Vietnam',
  'Nga': 'Russia',
  'Đức': 'Germany',
  'Pháp': 'France',
  'Tây Ban Nha': 'Spain',
  'Bồ Đào Nha': 'Portugal',
  'Hà Lan': 'Netherlands',
  'Bỉ': 'Belgium',
  'Thụy Sĩ': 'Switzerland(CHE)',
  'Thụy Điển': 'Sweden',
  'Na Uy': 'Norway',
  'Đan Mạch': 'Denmark',
  'Ba Lan': 'Poland',
  'Áo': 'Austria',
  'Croatia': 'Croatia(HRV)',
  'Ý': 'Italy',
  'Anh': 'England',
  'Scotland': 'Scotland',
  'Maroc': 'Morocco',
  'Senegal': 'Senegal',
  'Ghana': 'Ghana',
  'Mexico': 'Mexico',
  'Argentina': 'Argentina',
  'Brazil': 'Brazil',
  'Colombia': 'Colombia',
  'Uruguay': 'Uruguay',
  'Ecuador': 'Ecuador',
  'Mỹ': 'USA',
  'Ả Rập Xê Út': 'Saudi Arabia',
  'Iraq': 'Iraq',
  'Iran': 'Iran',
  'Qatar': 'Qatar',
  'Úc': 'Australia',
  'Ấn Độ': 'India',
  'Indonesia': 'Indonesia',
  'Malaysia': 'Malaysia',
  'Philippines': 'Philippines',
  'Singapore': 'Singapore',
  'Myanmar': 'Myanmar',
  'Campuchia': 'Cambodia',
  'Lào': 'Laos',
  'Brunei': 'Brunei',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const home = searchParams.get('home') ?? '';
  const away = searchParams.get('away') ?? '';
  if (!home || !away)
    return NextResponse.json({ ok: false, error: 'missing params' }, { status: 400 });

  const base = (s: string) => {
    const stripped = s.replace(/ \([VS]\)$/, '').replace(/ \((?:20|16)p\)$/, '').trim();
    return VN_TO_EN[stripped] ?? stripped;
  };
  const baseHome = base(home);
  const baseAway = base(away);

  try {
    const db = getPool();
    const { rows } = await db.query(
      `
      SELECT match_time, match_type, league, home_team, away_team,
             h1_home, h1_away, tt_home, tt_away
      FROM gs_matches_history
      WHERE home_team LIKE $1 OR away_team LIKE $1
         OR home_team LIKE $2 OR away_team LIKE $2
      ORDER BY match_time DESC
      `,
      [`${baseHome}%`, `${baseAway}%`],
    );

    const matches = rows.map((r) => {
      const ms = new Date(r.match_time).getTime() + 7 * 60 * 60 * 1000;
      const d = new Date(ms);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = d.getUTCFullYear();
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const min = String(d.getUTCMinutes()).padStart(2, '0');
      return {
        date: `${dd}/${mm}/${yyyy}`,
        time: `${dd}/${mm}/${yyyy} ${hh}:${min}`,
        matchType: r.match_type as '20p' | '16p',
        league: r.league as string,
        homeTeam: formatTeam(r.home_team as string),
        awayTeam: formatTeam(r.away_team as string),
        h1Home: String(r.h1_home),
        h1Away: String(r.h1_away),
        ttHome: String(r.tt_home),
        ttAway: String(r.tt_away),
      };
    });

    return NextResponse.json({ ok: true, matches });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
