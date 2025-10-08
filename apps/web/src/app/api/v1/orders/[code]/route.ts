import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

const TENANT = "00000000-0000-0000-0000-000000000001";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> } // 👈 Promise-wrapped
) {
  const { code } = await ctx.params;        // 👈 await it
  const supa = supaServer();

  const { data: og, error: ogErr } = await supa
    .from("order_groups")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("order_code", code)
    .maybeSingle();

  if (ogErr) return NextResponse.json({ ok:false, error: ogErr.message }, { status: 500 });
  if (!og)  return NextResponse.json({ ok:true, order: null });

  const { data: tickets, error: tErr } = await supa
    .from("tickets")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("order_group_id", og.id)
    .order("created_at", { ascending: true });

  if (tErr) return NextResponse.json({ ok:false, error: tErr.message }, { status: 500 });

  return NextResponse.json({ ok:true, order: { ...og, tickets } });
}
