import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gs_claude_predictions (
      id              SERIAL PRIMARY KEY,
      event_id        INTEGER NOT NULL,
      score_home      SMALLINT NOT NULL DEFAULT 0,
      score_away      SMALLINT NOT NULL DEFAULT 0,
      half            VARCHAR(4),
      minute          SMALLINT,
      prediction_text TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT now(),
      updated_at      TIMESTAMPTZ DEFAULT now(),
      CONSTRAINT uq_gs_claude_pred UNIQUE (event_id, score_home, score_away)
    )
  `);
}

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId');
  if (!eventId) return NextResponse.json({ ok: false, error: 'missing eventId' }, { status: 400 });

  const pool = getPool();
  if (!pool) return NextResponse.json({ ok: true, predictions: [] });

  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      `SELECT score_home, score_away, half, minute, prediction_text, updated_at
       FROM gs_claude_predictions
       WHERE event_id = $1
       ORDER BY updated_at ASC`,
      [Number(eventId)],
    );
    console.log(`[gs-history] GET event=${eventId} found ${rows.length} records`);
    return NextResponse.json({ ok: true, predictions: rows });
  } catch (e) {
    console.error('[gs-history] GET error', String(e));
    return NextResponse.json({ ok: false, error: String(e), predictions: [] });
  }
}

export async function POST(req: NextRequest) {
  const pool = getPool();
  if (!pool) {
    console.error('[gs-history] POST: no ANALYSIS_DATABASE_URL configured');
    return NextResponse.json({ ok: false, error: 'no db' });
  }

  const { eventId, scoreHome, scoreAway, half, minute, predictionText } = await req.json();
  if (!eventId || predictionText == null) {
    return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
  }

  try {
    await ensureTable(pool);
    const result = await pool.query(
      `INSERT INTO gs_claude_predictions
         (event_id, score_home, score_away, half, minute, prediction_text, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT ON CONSTRAINT uq_gs_claude_pred DO UPDATE SET
         half            = EXCLUDED.half,
         minute          = EXCLUDED.minute,
         prediction_text = EXCLUDED.prediction_text,
         updated_at      = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [eventId, scoreHome ?? 0, scoreAway ?? 0, half ?? null, minute ?? null, predictionText],
    );
    const row = result.rows[0];
    console.log(`[gs-history] saved event=${eventId} score=${scoreHome}-${scoreAway} id=${row?.id} action=${row?.inserted ? 'INSERT' : 'UPDATE'}`);
    return NextResponse.json({ ok: true, id: row?.id, action: row?.inserted ? 'insert' : 'update' });
  } catch (e) {
    console.error('[gs-history] POST error', String(e));
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
