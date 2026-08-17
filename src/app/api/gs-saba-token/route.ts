import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Reads/writes ONLY saba_config (its own new table). Zero writes to any gs_* table.
let singleton: Pool | null = null;
function db(): Pool | null {
  const url = process.env.ANALYSIS_DATABASE_URL;
  if (!url) return null;
  if (!singleton) singleton = new Pool({ connectionString: url, max: 2 });
  return singleton;
}

// Decode the (unverified) `exp` unix-seconds claim from a JWT payload.
function jwtExp(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

// Extract the session `S(...)` token and host from a SABA URL (index or wss).
function parseSabaUrl(raw: string): { host: string; session: string | null } | null {
  try {
    const u = new URL(raw.trim());
    const m = u.pathname.match(/\(S\(([^)]+)\)\)/);
    return { host: u.host, session: m ? m[1] : null };
  } catch {
    return null;
  }
}

async function setConfig(pool: Pool, entries: Record<string, string | null>) {
  for (const [k, v] of Object.entries(entries)) {
    if (v == null) continue;
    await pool.query(
      `INSERT INTO saba_config (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [k, v]
    );
  }
}

type Body = {
  indexUrl?: string;
  // full seed (once): the confirmed pure-Node refresh needs these
  at?: string;
  rt?: string;
  sessionB?: string;
  pushNode?: string;
  memberId?: string;
  gid?: string;
  // back-compat: a raw wss URL is still accepted
  socketUrl?: string;
};

export async function POST(req: Request) {
  const pool = db();
  if (!pool) return Response.json({ ok: false, error: 'no db' });
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const entries: Record<string, string | null> = {};
  let at: string | null = null;

  // 1) Full seed (preferred): at/rt/sessionB/pushNode/memberId → refresh loop can sustain.
  if (body.at && body.rt) {
    at = body.at;
    entries.at = body.at;
    entries.rt = body.rt;
    if (body.sessionB) entries.session_b = body.sessionB;
    if (body.pushNode) entries.push_node = body.pushNode;
    if (body.memberId) entries.member_id = body.memberId;
    if (body.gid) entries.gid = body.gid;
  }

  // 2) NewIndex URL — stored for the (future) seed step; captures session + host.
  if (body.indexUrl) {
    const parsed = parseSabaUrl(body.indexUrl);
    if (!parsed) return Response.json({ ok: false, error: 'indexUrl không hợp lệ' }, { status: 400 });
    entries.index_url = body.indexUrl.trim();
    if (parsed.session) entries.session_b = entries.session_b ?? parsed.session;
  }

  // 3) Back-compat: raw wss URL carries token + host directly.
  if (body.socketUrl) {
    const parsed = parseSabaUrl(body.socketUrl);
    try {
      const u = new URL(body.socketUrl.trim());
      const tok = u.searchParams.get('token');
      if (tok) { at = tok; entries.at = tok; }
      if (parsed?.host) entries.push_node = entries.push_node ?? parsed.host;
      const mid = u.searchParams.get('id');
      if (mid) entries.member_id = entries.member_id ?? mid;
      entries.socket_url = body.socketUrl.trim();
    } catch {
      return Response.json({ ok: false, error: 'socketUrl không hợp lệ' }, { status: 400 });
    }
  }

  if (Object.keys(entries).length === 0) {
    return Response.json({ ok: false, error: 'cần { indexUrl } hoặc { at, rt, sessionB, pushNode, memberId } hoặc { socketUrl }' }, { status: 400 });
  }

  try {
    await setConfig(pool, entries);
  } catch (error) {
    return Response.json({ ok: false, error: String(error) });
  }

  const exp = at ? jwtExp(at) : null;
  const expiresInSec = exp != null ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : null;
  const seeded = !!(entries.at && entries.rt && entries.push_node);
  return Response.json({ ok: true, exp, expiresInSec, seeded });
}

export async function GET() {
  const pool = db();
  if (!pool) return Response.json({ ok: false, error: 'no db' });
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM saba_config WHERE key IN ('at','rt','push_node','index_url')`
    );
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const at: string | undefined = cfg.at;
    const hasToken = !!at;
    const seeded = !!(cfg.at && cfg.rt && cfg.push_node);
    const exp = at ? jwtExp(at) : null;
    const expiresInSec = exp != null ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : null;
    const masked = at ? `…${at.slice(-6)}` : null;
    const hasIndexUrl = !!cfg.index_url;
    const valid = expiresInSec != null && expiresInSec > 0;
    return Response.json({ ok: true, hasToken, valid, seeded, hasIndexUrl, exp, expiresInSec, masked });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) });
  }
}
