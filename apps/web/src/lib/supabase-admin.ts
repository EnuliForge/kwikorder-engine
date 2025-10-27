import { createClient } from "@supabase/supabase-js";

export function supaAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  // service role can bypass RLS and read any table
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
    },
  });
}
