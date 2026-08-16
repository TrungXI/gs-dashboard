// saba-auth.mjs
// Session / JWT acquisition + refresh for the SABA (C-Sport) socket feed.
// Auth flow CONFIRMED from live capture — see capture/auth-flow-CONFIRMED.md.
//
// ── PRIMARY UX: user pastes the NewIndex URL ─────────────────────────────────
// The user pastes `https://<h>.bpy6vurb.com/(S(<sessionA>))/NewIndex?...` into
// the dashboard. `/api/gs-saba-token` stores it in saba_config (key `index_url`)
// and, once seeded, the extracted `at`/`rt`/`session_b`/`push_node`/`member_id`.
//
// ── SEED (once): initial at/rt from the pasted NewIndex URL ───────────────────
// Getting the FIRST at/rt requires page-JS execution once (the tokens are seeded
// into sessionStorage by the page bootstrap). See seedFromIndexUrl() below — it
// is a documented STUB (the exact bootstrap request chain is written out). The
// first-cut path is: the operator supplies at/rt/session_b/push_node/member_id
// directly via the token API (the UI can accept either the index URL or a raw
// at/rt pair), and pure-Node refresh sustains it from there.
//
// ── REFRESH (every ~60s, PURE NODE — no chromium) — CONFIRMED ────────────────
// POST https://c0z0ia.<dom>/(S(<sessionB>))/LoginCheckin/Index
//   Content-Type: application/x-www-form-urlencoded
//   Body: rt=<currentRt>&at=<currentAt>
//   → { ErrorCode:0, Data:{ at:<new JWT>, rt:<new rt>, TMI:6 } }
// refreshToken() implements exactly this and persists the new at/rt to
// saba_config. Self-sustaining while the collector runs; on ErrorCode≠0 / non-2xx
// the session B is dead → the collector idles and the UI prompts a re-paste.
//
// saba-auth reads/writes ONLY saba_config (its own table). Zero K-Sport writes.

import { Pool } from 'pg';

let pool = null;
function db() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  return pool;
}

function randomGid() {
  const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return hex() + hex() + hex() + hex();
}

// ── saba_config helpers ───────────────────────────────────────────────────────
async function readConfigMap() {
  const p = db();
  if (!p) return {};
  try {
    const { rows } = await p.query(
      `SELECT key, value FROM saba_config
       WHERE key IN ('index_url','at','rt','session_b','push_node','member_id','gid','socket_url','token','id','socket_host')`
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {}; // table not applied yet — fall back to env
  }
}

async function writeConfig(entries) {
  const p = db();
  if (!p) return;
  for (const [k, v] of Object.entries(entries)) {
    await p.query(
      `INSERT INTO saba_config (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [k, v]
    );
  }
}

// Derive the c0z0ia session-B host from a push node / index host if not stored.
// The LoginCheckin host is the Sports-frame host `c0z0ia.<domain>`.
function sessionBHost(cfg) {
  if (cfg.session_b_host) return cfg.session_b_host;
  // domain is the shared 2-label suffix (e.g. bpy6vurb.com) of whatever host we have.
  const anyHost = cfg.push_node || cfg.socket_host || '';
  const domain = anyHost.split('.').slice(-2).join('.');
  return domain ? `c0z0ia.${domain}` : null;
}

// ── Session for the socket connection ─────────────────────────────────────────
function fromWssUrl(raw) {
  const u = new URL(raw);
  const q = u.searchParams;
  return {
    socketHost: u.host,
    gid: q.get('gid') || process.env.SABA_GID || randomGid(),
    id: q.get('id') || process.env.SABA_ID || '',
    token: q.get('token') || '',
    rt: '',
  };
}

function fromEnv() {
  if (process.env.SABA_SOCKET_URL) return fromWssUrl(process.env.SABA_SOCKET_URL);
  const socketHost = process.env.SABA_SOCKET_HOST;
  const token = process.env.SABA_TOKEN;
  if (!socketHost || !token) return null;
  return {
    socketHost,
    gid: process.env.SABA_GID || randomGid(),
    id: process.env.SABA_ID || '',
    token,
    rt: process.env.SABA_RT || '',
  };
}

// getSession() → { socketHost, gid, id, token, rt } built from saba_config
// (push_node + at + member_id), else a stored socket_url, else env.
export async function getSession() {
  const cfg = await readConfigMap();
  if (cfg.at && cfg.push_node) {
    return {
      socketHost: cfg.push_node,
      gid: cfg.gid || randomGid(),
      id: cfg.member_id || cfg.id || '',
      token: cfg.at,
      rt: cfg.rt || '',
    };
  }
  if (cfg.socket_url) return fromWssUrl(cfg.socket_url);
  const env = fromEnv();
  if (env && env.token) return env;
  throw new Error('SABA token chưa sẵn sàng — dán link NewIndex mới trong UI (/api/gs-saba-token)');
}

// refreshToken() — CONFIRMED pure-Node LoginCheckin POST. Reads current at/rt
// from saba_config, POSTs to LoginCheckin/Index, persists the returned at/rt.
// Returns { token, rt }. On failure returns the current token unchanged.
export async function refreshToken(_rt) {
  const cfg = await readConfigMap();
  const at = cfg.at;
  const rt = cfg.rt || _rt;
  const host = sessionBHost(cfg);
  const sessionB = cfg.session_b;
  if (!at || !rt || !host || !sessionB) {
    // Nothing to refresh against (not seeded) — return whatever we have.
    return { token: cfg.at || '', rt: cfg.rt || _rt || '' };
  }
  const url = `https://${host}/(S(${sessionB}))/LoginCheckin/Index`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `bearer ${at}`,
      },
      body: `rt=${encodeURIComponent(rt)}&at=${encodeURIComponent(at)}`,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`LoginCheckin HTTP ${res.status}`);
    const json = await res.json();
    if (json?.ErrorCode !== 0 || !json?.Data?.at) {
      throw new Error(`LoginCheckin ErrorCode=${json?.ErrorCode}`);
    }
    const newAt = json.Data.at;
    const newRt = json.Data.rt || rt;
    await writeConfig({ at: newAt, rt: newRt });
    return { token: newAt, rt: newRt };
  } catch (e) {
    console.warn('[SABA-AUTH] refresh failed:', e.message);
    return { token: at, rt }; // keep current; caller reconnects/idles as needed
  }
}

// seedFromIndexUrl(indexUrl) — obtain the INITIAL {at, rt, session_b, push_node,
// member_id} from the pasted NewIndex URL. STUB (documented request chain):
//
//   (a) one-shot headless (puppeteer/playwright, ONLY at seed — not persistent):
//       load indexUrl → wait for the Sports frame → read
//       `sessionStorage.at`, `sessionStorage.rt`, `config.urls.pushNode`,
//       member id, and the redirected `c0z0ia.<dom>/(S(<sessionB>))/` path.
//   (b) pure-Node bootstrap replication (preferred, higher risk):
//       GET indexUrl → POST /login_checkin.aspx (session A) →
//       GET EntryIndex/OpenSports → follow redirect to
//       c0z0ia.<dom>/(S(<sessionB>))/Sports/ → parse embedded `at`/`rt` from the
//       page bootstrap (offset e.at/e.rt) + `urls.pushNode` + member id.
//
// Not implemented now (avoids persistent chromium on the VPS and brittle Node
// replication). First-cut: the operator supplies at/rt/session_b/push_node/
// member_id directly via /api/gs-saba-token. Once seeded, refreshToken() sustains
// it indefinitely with NO browser.
export async function seedFromIndexUrl(indexUrl) {
  await writeConfig({ index_url: indexUrl });
  throw new Error(
    'seedFromIndexUrl: automatic seed not implemented — supply at/rt/session_b/push_node/member_id via /api/gs-saba-token (see saba-auth.mjs header for the confirmed request chain).'
  );
}

// Decode the (unverified) JWT `exp` (unix seconds). null if undecodable.
export function jwtExp(token) {
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
