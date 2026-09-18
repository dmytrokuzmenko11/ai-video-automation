import { createServerClient } from '@supabase/ssr';

export const supabaseServer = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { cookies: { getAll: () => [], setAll: () => {} } }
);
