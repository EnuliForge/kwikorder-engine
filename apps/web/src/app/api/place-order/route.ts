import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";

type CartItem = {
  name: string;
  sku?: string;
  qty: number;
  price_minor: number;
  stream: "kitchen" | "bar" | "special";
  notes?: string;
  modifiers?: string[];
};

function generateOrderCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      tenant_id,
      context,
      table_id,
      cart,
      notes,
    }: {
      tenant_id: string;
      context: "dine-in" | "room-service" | "pickup";
      table_id: string;
      cart: CartItem[];
      notes?: string;
    } = body;

    if (!tenant_id || !context || !table_id || !Array.isArray(cart) || cart.length === 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const supabase = supaAdmin();

    // Create order group
    const order_code = generateOrderCode();
    const { data: orderGroupRow, error: ogErr } = await supabase
      .from("order_groups")
      .insert({
        tenant_id,
        order_code,
        table_id,
        context,
        opened_at: new Date().toISOString(),
        metadata: {},
      })
      .select("id, order_code")
      .single();

    if (ogErr || !orderGroupRow) {
      console.error("order_groups insert failed", ogErr);
      return NextResponse.json({ error: "order_groups insert failed" }, { status: 500 });
    }

    // Group items by stream and create tickets + line items
    const byStream: Record<"kitchen" | "bar" | "special", CartItem[]> = { kitchen: [], bar: [], special: [] };
    for (const item of cart) byStream[item.stream].push(item);

    for (const [stream, items] of Object.entries(byStream) as ["kitchen"|"bar"|"special", CartItem[]][]) {
      if (items.length === 0) continue;

      const { data: ticketRow, error: tErr } = await supabase
        .from("tickets")
        .insert({
          tenant_id,
          order_group_id: orderGroupRow.id,
          stream,
          status: "received",
          created_at: new Date().toISOString(),
          metadata: notes ? { notes } : {},
        })
        .select("id")
        .single();

      if (tErr || !ticketRow) {
        console.error("tickets insert failed", stream, tErr);
        continue;
      }

      const payload = items.map((it) => ({
        tenant_id,
        ticket_id: ticketRow.id,
        sku: it.sku ?? null,
        name: it.name,
        qty: it.qty,
        price_minor: it.price_minor,
        modifiers: it.modifiers ?? [],
        notes: it.notes ?? null,
        metadata: {},
      }));
      const { error: liErr } = await supabase.from("line_items").insert(payload);
      if (liErr) console.error("line_items insert failed", stream, liErr);
    }

    // Return both table_id and order_code
    return NextResponse.json({ table_id, order_code }, { status: 200 });
  } catch (e) {
    console.error("place-order server error", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
