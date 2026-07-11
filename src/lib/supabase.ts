import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Client-side: use anon key
export const supabase = createClient(url, anonKey);

// Server-side (API routes): use service role key to bypass RLS
export function supabaseAdmin() {
  return createClient(url, serviceKey ?? anonKey);
}
