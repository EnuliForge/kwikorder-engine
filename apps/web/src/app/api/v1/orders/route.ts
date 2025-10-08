// src/app/api/v1/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Narrow types (keeps ESLint happy without piling on) */
type Stream = "food" | "drinks";

type IncomingItem = {
  stream: Stream;
  sku?: string | null;
  name?: string | null;
  qty?: number;
  unit_price_cents?: number | null;
  notes?: string | null;
  modifiers?: unknown; // JSON-able
};

type Ticket = { id: string; stream: Stream };
type OrderGroup = { id: string; order_code: string };
type MenuItem = { sku: string; name: string; unit_price_cents: number | null };

type LineItemInsert = {
  ticket_id: string;
  stream: Stream;
  sku: string | null;
  name: string; // NOT NULL
  qty: number;
  unit_price_cents: number;
  total_cents: number;
  notes: string | null;
  modifiers_json: unknown | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      table_number?: number | null;
      streams?: Stream[];
      items?: IncomingItem[];
    };

    const table_number: number | null = body?.table_number ?? null;
    const streams: Stream[] = Array.isArray(body?.streams) ? body.streams : [];
    const items: IncomingItem[] = Array.isArray(body?.items) ? body.items : [];

    if (items.length === 0) {
      return NextResponse.json({ ok: false, error: "items required" }, { status: 400 });
    }
    if (streams.length === 0) {
      return NextResponse.json({ ok: false, error: "streams required" }, { status: 400 });
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 1) Create order group
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .insert([{ table_number }])
      .select("id, order_code")
      .single<OrderGroup>();
    if (ogErr || !og) {
      throw new Error(ogErr?.message ?? "order_groups insert failed");
    }

    // 2) Create tickets (one per stream)
    const ticketRows = streams.map((s) => ({
      order_group_id: og.id,
      stream: s,
      status: "received",
    }));
    const { data: tickets, error: tErr } = await supa
      .from("tickets")
      .insert(ticketRows)
      .select("id, stream")
      .returns<Ticket[]>();
    if (tErr) throw new Error(tErr.message);

    const ticketByStream = new Map<Stream, string>((tickets ?? []).map((t) => [t.stream, t.id]));

    // 3) Minimal patch: resolve missing names from menu_items by sku
    const skusNeedingLookup = items
      .filter((i) => !i.name && i.sku)
      .map((i) => String(i.sku));
    const bySku = new Map<string, MenuItem>();
    if (skusNeedingLookup.length > 0) {
      const { data: menuRows, error: menuErr } = await supa
        .from("menu_items")
        .select("sku, name, unit_price_cents")
        .in("sku", skusNeedingLookup)
        .returns<MenuItem[]>();
      if (menuErr) throw new Error(menuErr.message);
      for (const r of menuRows ?? []) bySku.set(r.sku, r);
    }

    const itemsResolved: IncomingItem[] = items.map((i) => {
      const m = i.sku ? bySku.get(String(i.sku)) : undefined;
      return {
        ...i,
        name: i.name ?? m?.name ?? i.name,
        unit_price_cents: i.unit_price_cents ?? m?.unit_price_cents ?? i.unit_price_cents ?? 0,
      };
    });

    // Fail fast if we still don't have names
    for (const i of itemsResolved) {
      if (!i.name) {
        return NextResponse.json(
          { ok: false, error: `Missing name for sku=${i.sku ?? "null"}` },
          { status: 400 }
        );
      }
    }

    // 4) Build line_items
    const lineItems: LineItemInsert[] = itemsResolved.map((i) => {
      const ticket_id = ticketByStream.get(i.stream);
      if (!ticket_id) {
        throw new Error(`No ticket for stream=${i.stream}`);
      }
      const qty = Number.isFinite(i.qty as number) ? Number(i.qty) : 1;
      const unit_price_cents = Number(i.unit_price_cents ?? 0);
      return {
        ticket_id,
        stream: i.stream,
        sku: i.sku ?? null,
        name: i.name as string, // guaranteed above
        qty,
        unit_price_cents,
        total_cents: unit_price_cents * qty,
        notes: i.notes ?? null,
        modifiers_json: i.modifiers ?? null,
      };
    });

    const { error: liErr } = await supa.from("line_items").insert(lineItems);
    if (liErr) throw new Error(liErr.message);

    return NextResponse.json({
      ok: true,
      order: {
        order_group_id: og.id,
        order_code: og.order_code,
        tickets,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
