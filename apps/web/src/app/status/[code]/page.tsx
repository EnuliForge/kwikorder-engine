import { supaServer } from "@/lib/supabase-server";

type OrderContext = "dine-in" | "room-service" | "pickup";
type TicketStatus = "received" | "preparing" | "ready" | "delivered" | "completed" | "cancelled";

interface DbOrderGroup {
  id: string;
  tenant_id: string;
  order_code: string;
  context: OrderContext;
  opened_at: string | null;
  customer_confirmed_at: string | null;
  closed_at: string | null;
  metadata: Record<string, unknown>;
}
interface DbTicket {
  id: string;
  tenant_id: string;
  order_group_id: string;
  stream: "kitchen" | "bar";
  status: TicketStatus;
  created_at: string;
  delivered_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

export const dynamic = "force-dynamic";

// ✅ Note params is a Promise here
export default async function StatusPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const supa = supaServer();
  const { data, error } = await supa
    .from("order_groups")
    .select("*, tickets:tickets(*)")
    .eq("tenant_id", TENANT_ID)
    .eq("order_code", code)
    .limit(1)
    .returns<(DbOrderGroup & { tickets: DbTicket[] })[]>();

  if (error) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Status</h1>
        <p style={{ color: "crimson" }}>Error: {error.message}</p>
      </main>
    );
  }

  const order = data?.[0];
  if (!order) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Status</h1>
        <p>Order <code>{code}</code> not found.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Order Status</h1>
      <p><strong>Code:</strong> {order.order_code}</p>
      <p><strong>Context:</strong> {order.context}</p>
      <p><strong>Opened:</strong> {order.opened_at ?? "—"}</p>
      <h2 style={{ marginTop: 16 }}>Tickets</h2>
      <ul>
        {order.tickets.map((t) => (
          <li key={t.id}>
            <strong>{t.stream}</strong>: {t.status} · {new Date(t.created_at).toLocaleString()}
          </li>
        ))}
      </ul>
    </main>
  );
}
