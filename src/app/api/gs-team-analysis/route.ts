import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL });
  return pool;
}

// Vietnamese/alternate → canonical English (same map as match-analysis)
const VN_TO_EN: Record<string, string> = {
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
  'Korea DPR': 'North Korea', 'IR Iran': 'Iran', 'Islamic Republic of Iran': 'Iran',
  'Brunei Darussalam': 'Brunei',
};

/** Resolve raw team name (may be Vietnamese or alternate English) → gs_teams.id */
async function resolveTeamId(db: Pool, name: string): Promise<number | null> {
  const m = name.trim().match(/^(.+?)\s+\(([VS])\)$/);
  if (!m) return null;
  const raw = m[1].trim();
  const base = VN_TO_EN[raw] ?? raw;
  const type = m[2];
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM gs_teams WHERE name = $1 AND type = $2',
    [base, type],
  );
  return rows[0]?.id ?? null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const home = searchParams.get('home') ?? '';
  const away = searchParams.get('away') ?? '';
  if (!home || !away)
    return NextResponse.json({ ok: false, error: 'missing params' }, { status: 400 });

  try {
    const db = getPool();

    // Resolve both teams to IDs — query by ID, no string matching
    const [homeId, awayId] = await Promise.all([
      resolveTeamId(db, home),
      resolveTeamId(db, away),
    ]);

    if (!homeId || !awayId) {
      const missing = [!homeId && home, !awayId && away].filter(Boolean).join(', ');
      return NextResponse.json({ ok: false, error: `Team not found: ${missing}` }, { status: 404 });
    }

    // Fetch all matches involving either team
    const { rows } = await db.query(
      `SELECT match_time, match_type, league,
              ht.name || ' (' || ht.type || ')' AS home_team,
              at.name || ' (' || at.type || ')' AS away_team,
              h1_home, h1_away, tt_home, tt_away
       FROM gs_matches_history mh
       JOIN gs_teams ht ON ht.id = mh.home_team_id
       JOIN gs_teams at ON at.id = mh.away_team_id
       WHERE mh.home_team_id = $1 OR mh.away_team_id = $1
          OR mh.home_team_id = $2 OR mh.away_team_id = $2
       ORDER BY match_time DESC`,
      [homeId, awayId],
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
        homeTeam: r.home_team as string,
        awayTeam: r.away_team as string,
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
