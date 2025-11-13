import { supaServer } from "@/lib/supabase-server";
import { notFound } from "next/navigation";

// ---------- Types ----------
type OrderGroup = {
  id: string;
  tenant_id: string;
  order_code: string;
  table_id: string | null;
  context: "dine-in" | "room-service" | "pickup";
  opened_at: string;
  customer_confirmed_at: string | null;
  closed_at: string | null;
  metadata: Record<string, unknown>;
};

type TicketStatus =
  | "received"
  | "preparing"
  | "ready"
  | "delivered"
  | "completed"
  | "cancelled";

type Ticket = {
  id: string;
  tenant_id: string;
  order_group_id: string;
  stream: "kitchen" | "bar" | "special";
  status: TicketStatus;
  created_at: string;
  delivered_at: string | null;
  completed_at: string | null;
  metadata: {
    notes?: string;
    [key: string]: unknown;
  };
};

type LineItem = {
  id: string;
  tenant_id: string;
  ticket_id: string;
  sku: string | null;
  name: string;
  qty: number;
  price_minor: number;
  modifiers: unknown[];
  notes: string | null;
  metadata: Record<string, unknown>;
};

// ---------- Helpers ----------
function formatMoney(minor: number) {
  const kwacha = Math.floor(minor / 100);
  const ngwee = minor % 100;
  const ngweeStr = ngwee.toString().padStart(2, "0");
  return `ZMW ${kwacha}.${ngweeStr}`;
}

function deriveOverallStatus(tickets: Ticket[]): string {
  const states = new Set(tickets.map((t) => t.status));
  if (states.has("received") || states.has("preparing")) return "Being prepared";
  if (states.has("ready")) return "Ready to serve";
  if (
    !states.has("received") &&
    !states.has("preparing") &&
    !states.has("ready") &&
    (states.has("delivered") || states.has("completed") || states.has("cancelled"))
  ) {
    return "Completed";
  }
  return "In progress";
}

function ticketIsDone(status: TicketStatus) {
  return status === "delivered" || status === "completed" || status === "cancelled";
}

function orderGroupIsDone(tickets: Ticket[]): boolean {
  if (tickets.length === 0) return false;
  return tickets.every((t) => ticketIsDone(t.status));
}

// ---------- Page Component ----------
// Shows ALL active orders for a table. If ?oc=ORDER_CODE is provided,
// that order is highlighted (but we still render all).
export default async function TableStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ oc?: string | string[] }>;
}) {
  // ✅ Await the new async params/searchParams
  const { tableId } = await params;
  const sp = await searchParams;
  const requestedOc = (Array.isArray(sp.oc) ? sp.oc[0] : sp.oc || "")
    .toUpperCase()
    .trim();

  const supabase = supaServer();

  // 1) Get ALL order_groups for this table (newest first)
  const { data: orderGroups, error: ogErr } = await supabase
    .from("order_groups")
    .select("*")
    .eq("table_id", tableId)
    .order("opened_at", { ascending: false })
    .returns<OrderGroup[]>();

  if (ogErr) throw ogErr;
  if (!orderGroups || orderGroups.length === 0) notFound();

  // Helper: build a renderable "card" from an order_group
  async function buildCard(og: OrderGroup) {
    const { data: ticketsRows, error: ticketsErr } = await supabase
      .from("tickets")
      .select("*")
      .eq("order_group_id", og.id)
      .order("created_at", { ascending: true })
      .returns<Ticket[]>();
    if (ticketsErr) throw ticketsErr;

    const ticketsSafe = ticketsRows ?? [];
    if (orderGroupIsDone(ticketsSafe)) return null; // skip completed groups

    const ticketIds = ticketsSafe.map((t) => t.id);

    let allLineItems: LineItem[] = [];
    if (ticketIds.length > 0) {
      const { data: lineItemsRows, error: lineItemsErr } = await supabase
        .from("line_items")
        .select("*")
        .in("ticket_id", ticketIds)
        .returns<LineItem[]>();
      if (lineItemsErr) throw lineItemsErr;
      allLineItems = lineItemsRows ?? [];
    }

    type FlatRow = {
      sku: string | null;
      name: string;
      qty: number;
      price_minor: number;
      notes: string | null;
      modifiers: unknown[];
    };

    const mergedRows: FlatRow[] = [];
    itemLoop: for (const li of allLineItems) {
      for (const row of mergedRows) {
        const sameSku = row.sku !== null && li.sku !== null && row.sku === li.sku;
        const bothNoSkuButSameIdent =
          row.sku === null && li.sku === null && row.name === li.name && row.price_minor === li.price_minor;
        const canMergeByCode = sameSku || bothNoSkuButSameIdent;
        const sameNotes = row.notes === li.notes;
        const sameModifiersJSON =
          JSON.stringify(row.modifiers ?? []) === JSON.stringify(li.modifiers ?? []);
        if (canMergeByCode && sameNotes && sameModifiersJSON) {
          row.qty += li.qty;
          continue itemLoop;
        }
      }
      mergedRows.push({
        sku: li.sku,
        name: li.name,
        qty: li.qty,
        price_minor: li.price_minor,
        notes: li.notes,
        modifiers: li.modifiers,
      });
    }

    const totalMinor = mergedRows.reduce((sum, row) => sum + row.qty * row.price_minor, 0);
    const headlineStatus = deriveOverallStatus(ticketsSafe);
    const specialNote = ticketsSafe.find((t) => t.metadata?.notes)?.metadata?.notes || null;

    return {
      orderGroup: og,
      headlineStatus,
      specialNote,
      mergedRows,
      totalMinor,
    };
  }

  // 2) Build cards for all active order groups
  const cardsRaw: Array<{
    orderGroup: OrderGroup;
    headlineStatus: string;
    specialNote: string | null;
    mergedRows: Array<{
      sku: string | null;
      name: string;
      qty: number;
      price_minor: number;
      notes: string | null;
      modifiers: unknown[];
    }>;
    totalMinor: number;
    __highlight?: boolean;
  }> = [];

  for (const og of orderGroups) {
    const built = await buildCard(og);
    if (built) cardsRaw.push(built);
  }

  if (cardsRaw.length === 0) notFound();

  // 3) If ?oc provided, put that card first and set a highlight flag
  const idx = requestedOc ? cardsRaw.findIndex((c) => c.orderGroup.order_code === requestedOc) : -1;
  let ocMismatchNote: string | null = null;

  const cards =
    idx > -1
      ? [cardsRaw[idx], ...cardsRaw.slice(0, idx), ...cardsRaw.slice(idx + 1)].map((c, i) => ({
          ...c,
          __highlight: i === 0,
        }))
      : cardsRaw.map((c) => ({ ...c, __highlight: false }));

  if (requestedOc && idx === -1) {
    ocMismatchNote = `Note: requested code ${requestedOc} not found for this table; showing all active orders instead.`;
  }

  // ---------- RENDER ----------
  return (
    <main className="mx-auto max-w-md p-4 space-y-6 text-zinc-100 bg-black min-h-screen">
      {/* Table header / identity */}
      <header className="text-center space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">TABLE</div>
        <div className="text-xl font-semibold text-zinc-100 break-all">
          {cards[0]?.orderGroup.table_id ?? "—"}
        </div>
        <div className="text-[12px] text-zinc-500">This shows all active orders for this table.</div>
        {ocMismatchNote && (
          <div className="mt-2 text-[11px] text-amber-300">{ocMismatchNote}</div>
        )}
      </header>

      {/* Active orders for this table */}
      {cards.map(
        ({ orderGroup, headlineStatus, specialNote, mergedRows, totalMinor, __highlight }) => (
          <section
            key={orderGroup.id}
            className={[
              "rounded-2xl border p-4 shadow-sm space-y-4",
              __highlight ? "border-amber-400" : "border-zinc-700",
            ].join(" ")}
          >
            {/* ORDER HEADER */}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] uppercase text-zinc-400 tracking-wide">ORDER CODE</div>
                <div className="text-lg font-semibold text-zinc-100 break-all">
                  {orderGroup.order_code}
                </div>
                <div className="mt-2 text-sm text-zinc-300">
                  {orderGroup.context === "dine-in"
                    ? "Dine-in"
                    : orderGroup.context === "room-service"
                    ? "Room service"
                    : "Pickup"}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  Opened at{" "}
                  {new Date(orderGroup.opened_at).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <div className="rounded-full border border-zinc-600 px-3 py-1 text-[11px] font-medium text-zinc-300 whitespace-nowrap">
                {headlineStatus}
              </div>
            </div>

            {/* SPECIAL NOTE */}
            {specialNote ? (
              <div className="text-[12px] text-zinc-400 italic">“{specialNote}”</div>
            ) : null}

            {/* ITEMS */}
            {mergedRows.length > 0 ? (
              <ul className="space-y-3">
                {mergedRows.map((row, i) => (
                  <li key={i} className="flex items-start justify-between text-sm">
                    <div>
                      <div className="font-medium text-zinc-100">
                        {row.qty}× {row.name}
                      </div>
                      {row.notes ? (
                        <div className="text-[11px] text-zinc-500 italic">{row.notes}</div>
                      ) : null}
                      {row.modifiers && (row.modifiers as unknown[]).length > 0 ? (
                        <div className="text-[11px] text-zinc-500">
                          {Array.isArray(row.modifiers) ? row.modifiers.join(", ") : ""}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right text-sm text-zinc-300">
                      {formatMoney(row.qty * row.price_minor)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[12px] text-zinc-500 italic">No items yet.</div>
            )}

            {/* TOTAL */}
            <div className="pt-2 text-right text-base font-medium text-zinc-100 border-t border-zinc-800">
              Total: {formatMoney(totalMinor)}
            </div>
          </section>
        )
      )}

      {/* CTA back to menu */}
      <a
        href={`/order?table_id=${encodeURIComponent(cards[0]?.orderGroup.table_id ?? "")}`}
        className="block w-full text-center rounded-xl bg-zinc-100 text-black font-semibold py-3 text-base"
      >
        Order more
      </a>

      <footer className="text-center text-[11px] text-zinc-500 pb-16">
        If anything is missing, please let your waiter know.
      </footer>
    </main>
  );
}
