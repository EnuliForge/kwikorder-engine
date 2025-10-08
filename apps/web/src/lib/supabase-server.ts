import { createClient } from "@supabase/supabase-js";

/** Server-only Supabase client (uses service role; never import into client components) */
export function supaServer() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server key
  if (!url || !key) throw new Error("Supabase env vars missing");
  return createClient(url, key, { auth: { persistSession: false } });
}
