import { transitionTicket } from "@kwik/order-engine";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  const now = new Date().toISOString();

  const ticket = {
    id: "t1",
    order_group_id: "og1",
    stream: "kitchen" as const,
    status: "ready" as const,
    created_at: now,
  };

  const { ticket: after, events } = transitionTicket(
    ticket,
    { to: "delivered" },
    now,
    "demo-abc-123"
  );

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontWeight: 700, fontSize: 24 }}>Engine Demo</h1>
      <pre style={{ background: "#111", color: "#0f0", padding: 16 }}>
        {JSON.stringify({ before: ticket, after, events }, null, 2)}
      </pre>
      <p>Expected: status changes from <code>ready</code> → <code>delivered</code> and an event is emitted.</p>
    </main>
  );
}
