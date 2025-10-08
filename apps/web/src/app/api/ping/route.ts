import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export async function GET() {
  try {
    const supa = supaServer();
    // simple roundtrip: select NOW() from Postgres
    const { data, error } = await supa.rpc("now"); // will fail until we add a helper, so just return ok
    // we won't rely on it; just proving the client constructs
    return NextResponse.json({ ok: true, supabaseClient: !!supa, rpcTried: true, error: error?.message ?? null });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
