import { NextRequest, NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { newOrderCode } from "@/lib/order-code";

const TENANT = "00000000-0000-0000-0000-000000000001" as const;

type Item = {
  sku?: string;
  name: string;
  qty: number;
  price_minor: number; // cents
  modifiers?: unknown[];
  notes?: string;
  metadata?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const supa = supaServer();

  const body = await req.json().catch(() => ({}));
  const context = (body?.context ?? "dine-in") as "dine-in" | "room-service" | "pickup";
  const stream = (body?.stream ?? "kitchen") as "kitchen" | "bar";
  const items = (body?.items ?? []) as Item[];
  const code = (body?.order_code as string | undefined) ?? newOrderCode();

  if (!["dine-in", "room-service", "pickup"].includes(context)) {
    return NextResponse.json({ ok:false, error:"invalid_context" }, { status: 400 });
  }
  if (!["kitchen","bar"].includes(stream)) {
    return NextResponse.json({ ok:false, error:"invalid_stream" }, { status: 400 });
  }

  const { data: og, error: ogErr } = await supa
    .from("order_groups")
    .insert({
      tenant_id: TENANT,
      order_code: code,
      context,
      metadata: body?.metadata ?? {}
    })
    .select("*")
    .single();

  if (ogErr) {
    if (/duplicate key|unique constraint|order_code/i.test(ogErr.message)) {
      return NextResponse.json({ ok:false, error:"order_code_conflict" }, { status: 409 });
    }
    return NextResponse.json({ ok:false, error: ogErr.message }, { status: 500 });
  }

  const { data: ticket, error: tErr } = await supa
    .from("tickets")
    .insert({
      tenant_id: TENANT,
      order_group_id: og.id,
      stream,
      status: "received",
      metadata: body?.ticket_metadata ?? {}
    })
    .select("*")
    .single();

  if (tErr) return NextResponse.json({ ok:false, error: tErr.message }, { status: 500 });

  if (Array.isArray(items) && items.length > 0) {
    const rows = items.map((it) => ({
      tenant_id: TENANT,
      ticket_id: ticket.id,
      sku: it.sku ?? null,
      name: it.name,
      qty: it.qty,
      price_minor: it.price_minor,
      modifiers: it.modifiers ?? [],
      notes: it.notes ?? null,
      metadata: it.metadata ?? {}
    }));
    const { error: liErr } = await supa.from("line_items").insert(rows);
    if (liErr) return NextResponse.json({ ok:false, error: liErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok:true, order_code: og.order_code, order_group_id: og.id, ticket_id: ticket.id });
}
