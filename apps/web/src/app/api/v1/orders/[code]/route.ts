import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

const TENANT = "00000000-0000-0000-0000-000000000001";

// GET /api/v1/orders/[code]
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> } // ✅ keep as Promise (matches your Next types)
) {
  const { code } = await ctx.params;        // ✅ await the params
  const supa = supaServer();

  // Fetch the order_group by code (single row)
  const { data: og, error: ogErr } = await supa
    .from("order_groups")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("order_code", code)
    .maybeSingle();

  if (ogErr) {
    return NextResponse.json({ ok: false, error: ogErr.message }, { status: 500 });
  }
  if (!og) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  // Fetch tickets for that order_group
  const { data: tickets, error: tErr } = await supa
    .from("tickets")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("order_group_id", og.id)
    .order("created_at", { ascending: true });

  if (tErr) {
    return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, order: { ...og, tickets } });
}
