// src/app/api/v1/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Stream = "food" | "drinks";
type IncomingItem = {
  stream: Stream;
  sku?: string | null;
  name?: string | null;             // optional from client; we’ll resolve from menu_items if missing
  qty?: number;
  unit_price_cents?: number | null; // optional override
  notes?: string | null;
  modifiers?: unknown;              // JSON-able blob
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const table_number: number | null = body?.table_number ?? null;
    const streams: Stream[] = body?.streams ?? [];
    const items: IncomingItem[] = body?.items ?? [];

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: "items required" }, { status: 400 });
    }
    if (!Array.isArray(streams) || streams.length === 0) {
      return NextResponse.json({ ok: false, error: "streams required" }, { status: 400 });
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-side only
      { auth: { persistSession: false } }
    );

    // 1) Create order group
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .insert([{ table_number }])
      .select("id, order_code")
      .single();
    if (ogErr) throw ogErr;

    // 2) Create tickets per stream
    const ticketRows = streams.map((s) => ({
      order_group_id: og.id,
      stream: s,
      status: "received",
    }));
    const { data: tickets, error: tErr } = await supa
      .from("tickets")
      .insert(ticketRows)
      .select("id, stream");
    if (tErr) throw tErr;

    const ticketByStream = new Map<string, string>(
      (tickets ?? []).map((t: any) => [t.stream, t.id])
    );

    // 3) Resolve names/prices from menu_items for items missing name
    const skus = items.map((i) => i.sku).filter(Boolean) as string[];
    let bySku = new Map<string, { sku: string; name: string; unit_price_cents: number | null }>();
    if (skus.length) {
      const { data: menuRows, error: menuErr } = await supa
        .from("menu_items")
        .select("sku, name, unit_price_cents")
        .in("sku", skus);
      if (menuErr) throw menuErr;
      bySku = new Map((menuRows ?? []).map((r: any) => [r.sku, r]));
    }

    // 4) Build line_items with guaranteed non-null name
    const lineItems = items.map((i) => {
      const m = i.sku ? bySku.get(i.sku) : undefined;
      const name = i.name ?? m?.name;
      if (!name) {
        const e: any = new Error(`Missing name for sku=${i.sku ?? "null"}`);
        e.statusCode = 400;
        throw e;
      }
      const qty = Number.isFinite(i.qty as number) ? Number(i.qty) : 1;
      const unit_price_cents = i.unit_price_cents ?? (m?.unit_pr_
