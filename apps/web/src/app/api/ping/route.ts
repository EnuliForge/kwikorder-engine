import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export async function GET() {
  try {
    // just prove the client constructs; no-op call
    const supa = supaServer();
    return NextResponse.json({ ok: true, supabaseClient: !!supa });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
