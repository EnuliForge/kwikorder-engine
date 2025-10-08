import { NextRequest, NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { transitionTicket } from "@kwik/order-engine";

const TENANT = "00000000-0000-0000-0000-000000000001"; // demo tenant

// ...existing imports & constants...

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  const idem = req.headers.get("x-idempotency-key") ?? crypto.randomUUID();
  const nowISO = new Date().toISOString();

  let to: any;
  try { ({ to } = await req.json()); } catch {}
  if (!to) {
    return NextResponse.json({ ok:false, error:"Missing body { to: 'preparing'|'ready'|'delivered'|'completed'|'cancelled' }" }, { status: 400 });
  }

  const supa = supaServer();

  const { data: ticket, error: tErr } = await supa
    .from("tickets")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("id", id)
    .maybeSingle();

  if (tErr) return NextResponse.json({ ok:false, error: tErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ ok:false, error: "ticket_not_found" }, { status: 404 });

  // ➕ NEW: idempotent no-op if already at target state
  if ((ticket as any).status === to) {
    return NextResponse.json({ ok: true, ticket }); // no event, already there
  }

  try {
    const { ticket: updated, events } = transitionTicket(ticket as any, { to }, nowISO, idem);

    const { error: upErr } = await supa
      .from("tickets")
      .update({
        status: updated.status,
        delivered_at: updated.delivered_at ?? null,
        completed_at: updated.completed_at ?? null
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
      payload: evt.payload
    });
    if (evErr && !/duplicate key|unique constraint/i.test(evErr.message)) throw evErr;

    return NextResponse.json({ ok:true, ticket: updated });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e.message }, { status: 400 });
  }
}
