import { headers } from "next/headers";

export const dynamic = "force-dynamic";

// Build an absolute base URL from the incoming request (works locally & on Vercel)
async function getBaseUrl() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    "localhost:3000";
  return `${proto}://${host}`;
}

type Order = {
  order_code: string;
  tickets?: Array<{
    id: string;
    stream: string;
    status: string;
    delivered_at?: string | null;
    completed_at?: string | null;
  }>;
};

export default async function StatusPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  // 👇 await getBaseUrl()
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/v1/orders/${code}`, { cache: "no-store" });
  if (!res.ok) return <div className="p-6">Failed to load order.</div>;

  const data: { ok: boolean; order: Order | null } = await res.json();
  const order = data.order;
  if (!order) return <div className="p-6">No order found.</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Order {order.order_code}</h1>
      {order.tickets?.map((t) => (
        <div key={t.id} className="rounded-xl border p-4">
          <div className="font-semibold capitalize">{t.stream}</div>
          <div>Status: <span className="font-mono">{t.status}</span></div>
          {t.delivered_at && (
            <div>Delivered: <span className="font-mono">{new Date(t.delivered_at).toLocaleString()}</span></div>
          )}
          {t.completed_at && (
            <div>Completed: <span className="font-mono">{new Date(t.completed_at).toLocaleString()}</span></div>
          )}
        </div>
      ))}
    </div>
  );
}

