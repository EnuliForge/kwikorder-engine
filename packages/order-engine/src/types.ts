export type TicketStatus =
  | "received" | "preparing" | "ready"
  | "delivered" | "completed" | "cancelled";

export interface Ticket {
  id: string;
  order_group_id: string;
  stream: "kitchen" | "bar";
  status: TicketStatus;
  created_at: string;
  delivered_at?: string | null;
  completed_at?: string | null;
  metadata?: Record<string, unknown>;
}

export type Transition =
  | { to: "preparing" }
  | { to: "ready" }
  | { to: "delivered" }
  | { to: "completed" }
  | { to: "cancelled" };

export interface DomainEvent<T = unknown> {
  id: string;
  occurred_at: string;
  type: string;
  version: number;
  entity_type: "ticket";
  entity_id: string;
  idempotency_key: string;
  payload: T;
}
