import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';

export async function GET() {
  const db = supabaseAdmin();

  // Test connection
  const { error: testErr } = await db.from('gs_matches_cache').select('date_key').limit(1);

  if (!testErr) {
    return NextResponse.json({ ok: true, message: 'Tables already exist' });
  }

  // Tables don't exist — return SQL for manual creation
  const sql = `
CREATE TABLE IF NOT EXISTS gs_matches_cache (
  date_key TEXT PRIMARY KEY,
  matches JSONB NOT NULL DEFAULT '[]',
  match_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS volta_matches_cache (
  match_id BIGINT PRIMARY KEY,
  match_data JSONB NOT NULL,
  match_date TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE gs_matches_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE volta_matches_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_gs ON gs_matches_cache;
DROP POLICY IF EXISTS anon_read_volta ON volta_matches_cache;

CREATE POLICY anon_read_gs ON gs_matches_cache FOR SELECT USING (true);
CREATE POLICY anon_read_volta ON volta_matches_cache FOR SELECT USING (true);
`;

  return NextResponse.json({
    ok: false,
    message: 'Tables not found. Please run this SQL in Supabase SQL Editor:',
    sql,
  });
}
