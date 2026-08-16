// saba-decode.mjs — pure SABA (C-Sport) socket protocol decode.
//
// Dependency-free so it can be unit-tested without pg / socket.io. Implements the
// dynamic "f"-schema decode from capture/socket-schema-LIVE.md:
//   • ["f",base,[names...]]  declares field NAMES for numeric indices base..base+len-1
//                            PER BUCKET (order differs per bucket — never hardcode ids).
//     A numeric entry is a back-reference to an already-defined name.
//   • data tuple [op,type,idx,val,idx,val,...] resolves each idx→name via the bucket schema.
//
// The SABA "SchemaStore" below holds one field map per bucket and decodes tuples
// to { type, attrs } name→value objects. The collector layers DB writes on top.

// Bettypes we persist (core soccer markets only): 1=HDP FT, 2=OU FT, 5=1X2 FT,
// plus H1 variants 7=HDP H1, 8/12=OU H1, 15=1X2 H1.
export const BETTYPE_MARKET = {
  1: { market: 'HDP', half: 'FT' },
  2: { market: 'OU', half: 'FT' },
  5: { market: '1X2', half: 'FT' },
  7: { market: 'HDP', half: 'H1' },
  8: { market: 'OU', half: 'H1' },
  12: { market: 'OU', half: 'H1' },
  15: { market: '1X2', half: 'H1' },
};

export function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toBool(v) {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return null;
}

// running minute for soccer: floor(now/60 − livetimer/60). livetimer = epoch sec.
export function computeMinute(livetimer, nowMs = Date.now()) {
  const lt = num(livetimer);
  if (lt == null) return null;
  return Math.max(0, Math.floor(nowMs / 1000 / 60 - lt / 60));
}

// "SABA ELITE FRIENDLY Virtual PES 21 - 5 Mins Play" → '5min';
// "... PENALTY SHOOTOUTS" → 'penalty'; ambiguous → null.
export function parsePlayFormat(leagueName) {
  if (!leagueName) return null;
  const s = String(leagueName);
  if (/penalty\s+shootouts?/i.test(s)) return 'penalty';
  const m = s.match(/(\d+)\s*mins?\s*play/i);
  if (m) return `${m[1]}min`;
  return null;
}

export function parsePesVersion(leagueName) {
  if (!leagueName) return null;
  const m = String(leagueName).match(/virtual\s+pes\s+(\d+)/i);
  return m ? m[1] : null;
}

// Per-bucket dynamic field-name schema store.
export class SchemaStore {
  constructor() {
    this.schemas = new Map(); // bucket -> Map<number,string>
  }

  bucketSchema(bucket) {
    let s = this.schemas.get(bucket);
    if (!s) { s = new Map(); this.schemas.set(bucket, s); }
    return s;
  }

  // apply an ["f",base,names] frame. names[i]: string=new name, number=back-ref
  // to an already-defined name at (n - base - i).
  applySchema(bucket, base, names) {
    const s = this.bucketSchema(bucket);
    for (let i = 0; i < names.length; i++) {
      let n = names[i];
      if (typeof n === 'number') n = s.get(n - base - i);
      s.set(base + i, n);
    }
  }

  // decode a data tuple [op,type,idx,val,idx,val,...] → { type, attrs } or null.
  decodeTuple(bucket, tuple) {
    const s = this.schemas.get(bucket);
    if (!s) return null;
    const type = tuple[1];
    const attrs = {};
    for (let i = 2; i + 1 < tuple.length; i += 2) {
      const name = s.get(tuple[i]);
      if (name != null) attrs[name] = tuple[i + 1];
    }
    return { type, attrs };
  }
}

// Convert a decoded "m" attrs object into a match-state patch (name→typed).
export function matchPatchFromAttrs(attrs) {
  const pick = (...names) => {
    for (const n of names) if (attrs[n] != null) return attrs[n];
    return null;
  };
  const patch = { raw: attrs };
  const matchId = num(attrs.matchid);
  if (matchId != null) patch.matchId = matchId;
  if (attrs.hteamnameen != null) patch.homeTeamRaw = attrs.hteamnameen;
  if (attrs.ateamnameen != null) patch.awayTeamRaw = attrs.ateamnameen;
  if (attrs.hteamnamevn != null) patch.homeTeamVn = attrs.hteamnamevn;
  if (attrs.ateamnamevn != null) patch.awayTeamVn = attrs.ateamnamevn;
  if (attrs.homeid != null) patch.homeId = num(attrs.homeid);
  if (attrs.awayid != null) patch.awayId = num(attrs.awayid);
  if (attrs.leagueid != null) patch.leagueId = num(attrs.leagueid);
  if (attrs.leaguenameen != null) patch.leagueName = attrs.leaguenameen;
  if (attrs.leaguenamevn != null) patch.leagueNameVn = attrs.leaguenamevn;
  if (attrs.leaguegroupid != null) patch.leagueGroupId = num(attrs.leaguegroupid);
  if (attrs.leaguedisplaycat != null) patch.leagueDisplayCat = attrs.leaguedisplaycat;
  const cc = pick('countrycode', 'hteamcountrycode');
  if (cc != null) patch.countryCode = cc;
  if (patch.leagueName != null) {
    patch.playFormat = parsePlayFormat(patch.leagueName);
    patch.pesVersion = parsePesVersion(patch.leagueName);
  }
  if (attrs.livehomescore != null) patch.scoreHome = num(attrs.livehomescore) ?? 0;
  if (attrs.liveawayscore != null) patch.scoreAway = num(attrs.liveawayscore) ?? 0;
  if (attrs.liveperiod != null) patch.period = num(attrs.liveperiod);
  if (attrs.livetimer != null) patch.livetimer = attrs.livetimer;
  if (attrs.homered != null) patch.homeRed = num(attrs.homered) ?? 0;
  if (attrs.awayred != null) patch.awayRed = num(attrs.awayred) ?? 0;
  if (attrs.goalteam != null) patch.goalTeam = String(attrs.goalteam);
  if (attrs.sabapenst != null) patch.penStatus = String(attrs.sabapenst);
  if (attrs.injurytime != null) patch.injuryTime = num(attrs.injurytime);
  if (attrs.isht != null) patch.isHt = toBool(attrs.isht);
  if (attrs.isfulltime != null) patch.isFulltime = toBool(attrs.isfulltime);
  if (attrs.gamestatus != null) patch.gameStatus = String(attrs.gamestatus);
  if (attrs.eventstatus != null) patch.eventStatus = String(attrs.eventstatus);
  if (attrs.kickofftime != null) patch.kickoffAt = attrs.kickofftime;

  const period = patch.period;
  const st = String(pick('eventstatus', 'gamestatus') ?? '').toLowerCase();
  if (attrs.liveperiod != null || attrs.eventstatus != null || attrs.gamestatus != null) {
    patch.isLive = period != null && period >= 1 &&
      st !== 'ended' && st !== 'end' && st !== 'closed';
  }
  return patch;
}

// Convert a decoded "o" attrs object into an odds-state object, or null if the
// bettype is out of scope. line = hdp1 − hdp2 (per socket-schema-LIVE.md §7).
export function oddsFromAttrs(attrs) {
  const pick = (...names) => {
    for (const n of names) if (attrs[n] != null) return attrs[n];
    return null;
  };
  const oddsId = num(attrs.oddsid);
  const matchId = num(attrs.matchid);
  const bettype = num(attrs.bettype);
  if (oddsId == null || matchId == null || bettype == null) return null;
  const mm = BETTYPE_MARKET[bettype];
  if (!mm) return null;

  const hdp1 = num(attrs.hdp1);
  const hdp2 = num(attrs.hdp2);
  let line = null;
  if (hdp1 != null || hdp2 != null) line = String((hdp1 ?? 0) - (hdp2 ?? 0));

  const status = String(pick('oddsstatus') ?? '').toLowerCase();
  const suspended = status !== '' && status !== 'running';

  return {
    oddsId,
    matchId,
    bettype,
    market: mm.market,
    half: mm.half,
    line,
    homePrice: pick('odds1a') != null ? String(attrs.odds1a) : null,
    awayPrice: pick('odds2a') != null ? String(attrs.odds2a) : null,
    drawPrice: pick('odds3a') != null ? String(attrs.odds3a) : null,
    homeGives: line != null ? parseFloat(line) >= 0 : null,
    suspended,
    raw: attrs,
  };
}

// running seconds for soccer: floor(now − livetimer). livetimer = epoch sec.
export function computeSeconds(livetimer, nowMs = Date.now()) {
  const lt = num(livetimer);
  if (lt == null) return null;
  return Math.max(0, Math.floor(nowMs / 1000 - lt));
}
