import { NextRequest, NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import {
  transitionTicket,
  type Ticket,
  type TicketStatus,
} from "@kwik/order-engine";

// Only allow valid *targets* (can't transition *to* 'received')
type NextStatus = Exclude<TicketStatus, "received">;

const TENANT = "00000000-0000-0000-0000-000000000001" as const;

type Body = { to: NextStatus };


export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const idem = req.headers.get("x-idempotency-key") ?? crypto.randomUUID();
  const nowISO = new Date().toISOString();

  let body: Partial<Body> = {};
  try {
    body = (await req.json()) as Partial<Body>;
  } catch {
    /* ignore parse error */
  }
  const to = body.to;
  if (!to) {
    return NextResponse.json(
      { ok: false, error: "Missing body { to: 'preparing'|'ready'|'delivered'|'completed'|'cancelled' }" },
      { status: 400 }
    );
  }

  const supa = supaServer();

  // Load current ticket (scoped to tenant)
  const { data: trow, error: tErr } = await supa
    .from("tickets")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("id", id)
    .maybeSingle();

  if (tErr) return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
  if (!trow) return NextResponse.json({ ok: false, error: "ticket_not_found" }, { status: 404 });

  // Map DB row → engine Ticket type (narrow types; no any)
  const ticket: Ticket = {
    id: String(trow.id),
    order_group_id: String(trow.order_group_id),
    stream: trow.stream as Ticket["stream"],
    status: trow.status as TicketStatus,
    created_at: String(trow.created_at),
    delivered_at: (trow.delivered_at as string | null) ?? null,
    completed_at: (trow.completed_at as string | null) ?? null,
    metadata: (trow.metadata as Record<string, unknown>) ?? {},
  };

  // Idempotent no-op if already at target state
  if (ticket.status === to) {
    return NextResponse.json({ ok: true, ticket });
  }

  try {
    const { ticket: updated, events } = transitionTicket(ticket, { to }, nowISO, idem);

    const { error: upErr } = await supa
      .from("tickets")
      .update({
        status: updated.status,
        delivered_at: updated.delivered_at ?? null,
        completed_at: updated.completed_at ?? null,
      })
      .eq("tenant_id", TENANT)
      .eq("id", id);
    if (upErr) throw upErr;

    const evt = events[0];
    const { error: evErr } = await supa.from("domain_events").insert({
      occurred_at: evt.occurred_at,
      tenant_id: TENANT,
      type: evt.type,
      version: evt.version,
      entity_type: evt.entity_type,
      entity_id: evt.entity_id,
      idempotency_key: evt.idempotency_key,
      payload: evt.payload,
    });
    if (evErr && !/duplicate key|unique constraint/i.test(evErr.message)) throw evErr;

    return NextResponse.json({ ok: true, ticket: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
