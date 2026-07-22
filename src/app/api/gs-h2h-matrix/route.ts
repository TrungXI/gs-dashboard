import { NextResponse } from 'next/server';
import { fetchH2HMatrix } from '../../../lib/gsMatchesDb';

export const dynamic = 'force-dynamic';

// GET /api/gs-h2h-matrix?type=20p&market=ft
//   -> { ok, teams, cells, leadersTai, leadersXiu }
// `type`   : 20p | 16p  (required — teams are league-specific)
// `market` : ft | h1    (ft = full-match total vs ou_line, h1 = H1 total vs ou_h1_line)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const typeParam = searchParams.get('type') === '16p' ? '16p' : '20p';
    const market = searchParams.get('market') === 'h1' ? 'h1' : 'ft';

    const matrix = await fetchH2HMatrix(typeParam, market);

    return NextResponse.json({ ok: true, ...matrix });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
