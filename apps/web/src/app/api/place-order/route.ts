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
   // 1. get body
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

  // basic validation
  if (!tenant_id || !context || !table_id || !cart || cart.length === 0) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400 }
    );
  }

  // 2. create admin supabase client
  const supabase = supaAdmin();
  
  // 3. PROBE: can this key even read order_groups?
  const probe = await supabase
    .from("order_groups")
    .select("*")
    .limit(1);

  
  // if probe already fails with permission denied, surface that right away
  if (probe.error) {
    console.error("### PROBE ERROR BLOCKING INSERT ###", probe.error);
    return NextResponse.json(
      { error: "probe_failed", details: probe.error },
      { status: 500 }
    );
  }

  // 4. Create order_group
  const order_code = generateOrderCode();

  const { data: orderGroupRow, error: ogErr } = await supabase
    .from("order_groups")
    .insert({
      tenant_id,
      order_code,
      table_id,
      context,
      opened_at: new Date().toISOString(),
      metadata: {}, // placeholder for future
    })
    .select("*")
    .single();

  if (ogErr || !orderGroupRow) {
    console.error("order_groups insert failed", ogErr);
    return NextResponse.json(
      { error: "order_groups insert failed", details: ogErr },
      { status: 500 }
    );
  }

  // 5. Group cart items by stream
  const byStream: Record<string, CartItem[]> = {};
  for (const item of cart) {
    if (!byStream[item.stream]) {
      byStream[item.stream] = [];
    }
    byStream[item.stream].push(item);
  }

  // 6. For each stream, create a ticket + line_items
  for (const [stream, itemsForThisStream] of Object.entries(byStream)) {
    const { data: ticketRow, error: tErr } = await supabase
      .from("tickets")
      .insert({
        tenant_id,
        order_group_id: orderGroupRow.id,
        stream, // "kitchen" | "bar" | "special"
        status: "received",
        created_at: new Date().toISOString(),
        metadata: notes ? { notes } : {},
      })
      .select("*")
      .single();

    if (tErr || !ticketRow) {
      console.error("tickets insert failed for stream", stream, tErr);
      continue;
    }

    const lineItemsPayload = itemsForThisStream.map((item) => ({
      tenant_id,
      ticket_id: ticketRow.id,
      sku: item.sku ?? null,
      name: item.name,
      qty: item.qty,
      price_minor: item.price_minor,
      modifiers: item.modifiers ? item.modifiers : [],
      notes: item.notes ?? null,
      metadata: {},
    }));

    const { error: liErr } = await supabase
      .from("line_items")
      .insert(lineItemsPayload);

    if (liErr) {
      console.error(
        "line_items insert failed for stream",
        stream,
        liErr
      );
    }
  }

  // 7. Respond so client can redirect
  return NextResponse.json({ table_id }, { status: 200 });
}
