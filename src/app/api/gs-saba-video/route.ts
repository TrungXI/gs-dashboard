import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let singleton: Pool | null = null;
function db(): Pool | null {
  const url = process.env.ANALYSIS_DATABASE_URL;
  if (!url) return null;
  if (!singleton) singleton = new Pool({ connectionString: url, max: 2 });
  return singleton;
}

// One streaming source as it appears inside the streaming map (keyed by src).
export interface SabaStreamingSource {
  streamingsrc: number;
  streamingid?: string;
  streamingfixing?: boolean;
  streamingofferto?: number;
  streamingoffertocredit?: boolean;
}

export interface SabaVideoMatch {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  leagueNameVn: string | null;
  homeId: number | null;
  awayId: number | null;
  gv: number | null;
  // Full streaming source map (keyed by streamingsrc), e.g.
  //   { "11": { streamingsrc: 11, streamingid: "783", ... }, "19": { ... } }
  // The FE URL-encodes this whole object into the player URL's &streaming= param.
  streamingJson: Record<string, SabaStreamingSource> | null;
  // Back-compat single-source fields.
  streamingId: string | null;
  streamingSrc: number | null;
  score_home: number;
  score_away: number;
  minute: number | null;
}

// Derive the video PLAYER_BASE from saba_config. The player URL is
//   https://<host>/(S(<session>))/Streaming/Schedule?...
// index_url is the live session the user pasted (host c0z0ia.<domain> +
// /(S(<session>))/... path). We take its origin + the (S(...)) path segment.
// Fallback: session_b_host + session_b if index_url is absent/unparseable.
function derivePlayerBase(cfg: Record<string, string>): string | null {
  const idx = cfg.index_url;
  if (idx) {
    try {
      const u = new URL(idx);
      const seg = u.pathname.split('/').find((p) => /^\(S\(.+\)\)$/.test(p));
      if (seg) return `${u.origin}/${seg}`;
    } catch {
      /* fall through to session_b derivation */
    }
  }
  const host = cfg.session_b_host;
  const session = cfg.session_b;
  if (host && session) return `https://${host}/(S(${session}))`;
  return null;
}

export async function GET() {
  const pool = db();
  if (!pool) return Response.json({ ok: false, error: 'no db' });
  try {
    const { rows: cfgRows } = await pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM saba_config
       WHERE key IN ('index_url','session_b','session_b_host')`
    );
    const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
    const playerBase = derivePlayerBase(cfg);

    // In-play PARENT matches only, that actually have a stream. Exclude prop
    // sub-markets (parent_id set) and scheduled/ended matches (not in_play).
    const { rows } = await pool.query(`
      SELECT m.match_id, m.home_team, m.away_team, m.league_name, m.league_name_vn,
             m.home_id, m.away_id, m.gv, m.streaming_json,
             m.streaming_id, m.streaming_src, m.score_home, m.score_away, m.minute,
             hm.canonical_name AS home_canon, hm.mapped AS home_mapped,
             am.canonical_name AS away_canon, am.mapped AS away_mapped
      FROM saba_matches m
      LEFT JOIN saba_team_map hm ON hm.saba_name = m.home_team
      LEFT JOIN saba_team_map am ON am.saba_name = m.away_team
      WHERE m.in_play = true AND m.parent_id IS NULL AND m.has_streaming = true AND m.league_name ILIKE 'SABA%'
      ORDER BY m.league_group_id NULLS LAST, m.league_name NULLS LAST, m.match_id
    `);

    const matches: SabaVideoMatch[] = rows.map((m) => ({
      matchId: Number(m.match_id),
      homeTeam: (m.home_mapped === true && m.home_canon) ? m.home_canon : m.home_team,
      awayTeam: (m.away_mapped === true && m.away_canon) ? m.away_canon : m.away_team,
      leagueName: m.league_name ?? 'C-Sport',
      leagueNameVn: m.league_name_vn ?? null,
      homeId: m.home_id != null ? Number(m.home_id) : null,
      awayId: m.away_id != null ? Number(m.away_id) : null,
      gv: m.gv != null ? Number(m.gv) : null,
      streamingJson: (m.streaming_json ?? null) as Record<string, SabaStreamingSource> | null,
      streamingId: m.streaming_id ?? null,
      streamingSrc: m.streaming_src != null ? Number(m.streaming_src) : null,
      score_home: Number(m.score_home ?? 0),
      score_away: Number(m.score_away ?? 0),
      minute: m.minute != null ? Number(m.minute) : null,
    }));

    return Response.json({ ok: true, playerBase, matches });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) });
  }
}
