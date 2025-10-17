import { NextRequest, NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// ---- Types (match your DB) ----
type OrderContext = "dine-in" | "room-service" | "pickup";

interface CreateOrderBody {
  code: string;
  context: OrderContext;
}

interface DbOrderGroup {
  id: string;
  tenant_id: string;
  order_code: string;
  context: OrderContext;
  opened_at: string | null;               // default now()
  customer_confirmed_at: string | null;
  closed_at: string | null;
  metadata: Record<string, unknown>;
}

interface DbTicket {
  id: string;
  tenant_id: string;
  order_group_id: string; // FK to order_groups.id
  stream: "kitchen" | "bar";
  status: "received" | "preparing" | "ready" | "delivered" | "completed" | "cancelled";
  created_at: string;
  delivered_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

interface OkOrderResponse {
  ok: true;
  order: DbOrderGroup & { tickets: DbTicket[] };
}

interface ErrResponse {
  ok: false;
  error: string;
}

// same tenant seed you used in SQL
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

function bad(message: string, status = 400) {
  const body: ErrResponse = { ok: false, error: message };
  return NextResponse.json(body, { status });
}

function isCreateOrderBody(x: unknown): x is CreateOrderBody {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  const codeOk = typeof b.code === "string" && b.code.trim().length > 0;
  const ctx = b.context;
  const contextOk = ctx === "dine-in" || ctx === "room-service" || ctx === "pickup";
  return codeOk && contextOk;
}

// POST /api/v1/orders  → open/create an order_group with one initial ticket
export async function POST(req: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return bad("Body must be JSON");
  }
  if (!isCreateOrderBody(parsed)) {
    return bad(
      "Invalid body. Expected { code: string; context: 'dine-in'|'room-service'|'pickup' }"
    );
  }
  const { code, context } = parsed;

  const supa = supaServer();

  // Insert order_group (let defaults fill opened_at, metadata)
  const { data: ogRows, error: ogErr } = await supa
    .from("order_groups")
    .insert([
      {
        id: crypto.randomUUID(),
        tenant_id: TENANT_ID,
        order_code: code,
        context,
        // opened_at, metadata use defaults from your schema
      } satisfies Partial<DbOrderGroup> // we aren't setting every field; defaults handle the rest
    ])
    .select("*")
    .returns<DbOrderGroup[]>();

  if (ogErr) {
    // common cases: unique violation on order_code; table name mismatch; RLS
    return bad(`order_groups insert error: ${ogErr.message}`, 500);
  }
  const og = ogRows?.[0];
  if (!og) return bad("order_groups insert returned no row", 500);

  // Create initial ticket in "kitchen" (status defaults to 'received', created_at defaults now())
  const initialTicket: Partial<DbTicket> = {
    id: crypto.randomUUID(),
    tenant_id: TENANT_ID,
    order_group_id: og.id,
    stream: "kitchen",
    // status / created_at / metadata default in DB
  };

  const { data: ticketRows, error: ticketErr } = await supa
    .from("tickets")
    .insert([initialTicket])
    .select("*")
    .returns<DbTicket[]>();

  if (ticketErr) return bad(`tickets insert error: ${ticketErr.message}`, 500);
  if (!ticketRows) return bad("tickets insert returned no rows", 500);

  const body: OkOrderResponse = {
    ok: true,
    order: { ...og, tickets: ticketRows },
  };
  return NextResponse.json(body);
}

// Optional health check
export async function GET() {
  return NextResponse.json({ ok: true });
}
