// src/app/api/v1/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Narrow types so we don't need any/unknown casts */
type Stream = "food" | "drinks";

type IncomingItem = {
  stream: Stream;
  sku?: string | null;
  name?: string | null;
  qty?: number;
  unit_price_cents?: number | null;
  notes?: string | null;
  modifiers?: unknown;
};

type Ticket = {
  id: string;
  stream: Stream;
};

type MenuItemRow = {
  sku: string;
  name: string;
  unit_price_cents: number | null;
};

type OrderGroupRow = {
  id: string;
  order_code: string;
};

type LineItemInsert = {
  ticket_id: string;
  stream: Stream;
  sku: string | null;
  name: string; // not null
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
      .single<OrderGroupRow>();

    if (ogErr) throw ogErr;
    if (!og) return NextResponse.json({ ok: false, error: "order_groups insert failed" }, { status: 500 });

    // 2) Create tickets per stream
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

    if (tErr) throw tErr;
    const ticketByStream = new Map<Stream, string>((tickets ?? []).map((t) => [t.stream, t.id]));

    // 3) Resolve names/prices from menu_items for items missing name
    const skus = items.map((i) => i.sku).filter(Boolean) as string[];
    let bySku = new Map<string, MenuItemRow>();
    if (skus.length > 0) {
      const { data: menuRows, error: menuErr } = await supa
        .from("menu_items")
        .select("sku, name, unit_price_cents")
        .in("sku", skus)
        .returns<MenuItemRow[]>();

      if (menuErr) throw menuErr;
      for (const r of menuRows ?? []) bySku.set(r.sku, r);
    }

    // 4) Build line_items with guaranteed non-null name
    const lineItems: LineItemInsert[] = items.map((i) => {
      const m = i.sku ? bySku.get(i.sku) : undefined;
      const name = i.name ?? m?.name;
      if (!name) {
        const e = new Error(`Missing name for sku=${i.sku ?? "null"}`);
        (e as any).statusCode = 400; // annotate for status below without using any in logic
        throw e;
      }

      const qty = Number.isFinite(i.qty as number) ? Number(i.qty) : 1;
      const unit_price_cents = (i.unit_price_cents ?? m?.unit_price_cents ?? 0) || 0;

      const ticket_id = ticketByStream.get(i.stream);
      if (!ticket_id) {
        const e = new Error(`No ticket for stream=${i.stream}`);
        (e as any).statusCode = 400;
        throw e;
      }

      return {
        ticket_id,
        stream: i.stream,
        sku: i.sku ?? null,
        name,
        qty,
        unit_price_cents,
        total_cents: unit_price_cents * qty,
        notes: i.notes ?? null,
        modifiers_json: i.modifiers ?? null,
      };
    });

    const { error: liErr } = await supa.from("line_items").insert(lineItems);
    if (liErr) throw liErr;

    return NextResponse.json({
      ok: true,
      order: {
        order_group_id: og.id,
        order_code: og.order_code,
        tickets,
      },
    });
  } catch (err) {
    const status =
      typeof (err as { statusCode?: number }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;
    const message = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
