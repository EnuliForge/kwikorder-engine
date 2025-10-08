import type { Ticket, Transition, TicketStatus, DomainEvent } from "./types";
import { safeUUID } from "./util/uuid";

const legal: Record<TicketStatus, TicketStatus[]> = {
  received:  ["preparing","cancelled"],
  preparing: ["ready","cancelled"],
  ready:     ["delivered","cancelled"],
  delivered: ["completed","ready","cancelled"],
  completed: [],
  cancelled: []
};

export function transitionTicket(
  ticket: Ticket,
  cmd: Transition,
  nowISO: string,
  idempotencyKey: string,
  uuid: () => string = safeUUID
): { ticket: Ticket; events: DomainEvent[] } {
  const next = cmd.to;
  if (!legal[ticket.status].includes(next)) {
    throw new Error(`Illegal transition: ${ticket.status} -> ${next}`);
  }

  const updated: Ticket = { ...ticket, status: next };
  if (next === "delivered") updated.delivered_at = nowISO;
  if (next === "completed") updated.completed_at = nowISO;

  const evt: DomainEvent = {
    id: uuid(),
    occurred_at: nowISO,
    type: "TICKET_STATUS_CHANGED",
    version: 1,
    entity_type: "ticket",
    entity_id: ticket.id,
    idempotency_key: idempotencyKey,
    payload: { from: ticket.status, to: next }
  };

  return { ticket: updated, events: [evt] };
}
