import { NextRequest, NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic"; // ensure this stays a Serverless/Edge function

// ----- Types (keep these narrow so we don't hit `any`) -----
type OrderContext = "dine-in" | "takeaway" | "delivery";

interface CreateOrderBody {
  code: string;
  context: OrderContext;
}

interface DbOrder {
  id: string;
  tenant_id: string;
  order_code: string;
  context: OrderContext;
  opened_at: string;
  customer_confirmed_at: string | null;
  closed_at: string | null;
  metadata: Record<string, unknown>;
}

interface DbTicket {
  id: string;
  tenant_id: string;
  order_group_id: string; // FK to orders.id
  stream: string;
  status: "received" | "preparing" | "ready" | "delivered" | "completed" | "cancelled";
  created_at: string;
  delivered_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

interface OkOrderResponse {
  ok: true;
  order: DbOrder & { tickets: DbTicket[] };
}

interface ErrResponse {
  ok: false;
  error: string;
}

// Constants we used before during bootstrap
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

function bad(message: string, status = 400) {
  const body: ErrResponse = { ok: false, error: message };
  return NextResponse.json(body, { status });
}

function isCreateOrderBody(x: unknown): x is CreateOrderBody {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  const codeOk = typeof b.code === "string" && b.code.trim().length > 0;
  const contextOk =
    b.context === "dine-in" || b.context === "takeaway" || b.context === "delivery";
  return codeOk && contextOk;
}

// POST /api/v1/orders  → open/create an order with one initial ticket
export async function POST(req: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return bad("Body must be JSON");
  }
  if (!isCreateOrderBody(parsed)) {
    return bad(
      "Invalid body. Expected { code: string; context: 'dine-in'|'takeaway'|'delivery' }"
    );
  }
  const { code, context } = parsed;

  const supa = supaServer();
  const nowISO = new Date().toISOString();

  // Upsert/open the order
  const { data: orderRows, error: orderErr } = await supa
    .from<DbOrder>("orders")
    .insert([
      {
        id: crypto.randomUUID(),
        tenant_id: TENANT_ID,
        order_code: code,
        context,
        opened_at: nowISO,
        customer_confirmed_at: null,
        closed_at: null,
        metadata: {},
      },
    ])
    .select("*")
    .limit(1);

  if (orderErr || !orderRows || orderRows.length === 0) {
    return bad(orderErr?.message ?? "Failed to create order", 500);
  }
  const order = orderRows[0];

  // Create initial ticket in "kitchen" with status "received"
  const { data: ticketRows, error: ticketErr } = await supa
    .from<DbTicket>("tickets")
    .insert([
      {
        id: crypto.randomUUID(),
        tenant_id: TENANT_ID,
        order_group_id: order.id,
        stream: "kitchen",
        status: "received",
        created_at: nowISO,
        delivered_at: null,
        completed_at: null,
        metadata: {},
      },
    ])
    .select("*");

  if (ticketErr || !ticketRows) {
    return bad(ticketErr?.message ?? "Failed to create ticket", 500);
  }

  const body: OkOrderResponse = {
    ok: true,
    order: { ...order, tickets: ticketRows },
  };
  return NextResponse.json(body);
}

// (Optional) GET /api/v1/orders → simple health/availability check
export async function GET() {
  return NextResponse.json({ ok: true });
}
