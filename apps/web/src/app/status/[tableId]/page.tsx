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

// money formatter (minor units => "ZMW 95.00")
function formatMoney(minor: number) {
  const kwacha = Math.floor(minor / 100);
  const ngwee = minor % 100;
  const ngweeStr = ngwee.toString().padStart(2, "0");
  return `ZMW ${kwacha}.${ngweeStr}`;
}

// derive a single readable "status" for that order_group
function deriveOverallStatus(tickets: Ticket[]): string {
  const states = new Set(tickets.map((t) => t.status));

  if (states.has("received") || states.has("preparing")) {
    return "Being prepared";
  }
  if (states.has("ready")) {
    return "Ready to serve";
  }
  if (
    !states.has("received") &&
    !states.has("preparing") &&
    !states.has("ready") &&
    (states.has("delivered") ||
      states.has("completed") ||
      states.has("cancelled"))
  ) {
    return "Completed";
  }

  return "In progress";
}

// consider a single ticket "done" if it's delivered/completed/cancelled
function ticketIsDone(status: TicketStatus) {
  return (
    status === "delivered" ||
    status === "completed" ||
    status === "cancelled"
  );
}

// consider a whole order_group "done" if ALL its tickets are done
function orderGroupIsDone(tickets: Ticket[]): boolean {
  if (tickets.length === 0) {
    // if we somehow have no tickets we treat as done? or active?
    // let's say: if no tickets, it's not done (it just got created).
    return false;
  }
  return tickets.every((t) => ticketIsDone(t.status));
}

// ---------- Page Component ----------
//
// This page is now /status/[tableId], not /status/[code].
//
// We will:
// 1. Get tableId from params
// 2. Fetch ALL order_groups for that tableId
// 3. For each order_group, fetch its tickets + line_items
// 4. Filter out order_groups that are fully done
// 5. Render a card per active order_group
//
export default async function TableStatusPage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  const supabase = supaServer();

  // 1. Pull all order_groups for this table_id (newest first)
  const { data: orderGroups, error: ogErr } = await supabase
    .from("order_groups")
    .select("*")
    .eq("table_id", tableId)
    .order("opened_at", { ascending: false })
    .returns<OrderGroup[]>();

  if (ogErr) {
    throw ogErr;
  }

  if (!orderGroups || orderGroups.length === 0) {
    // no orders ever for this table
    notFound();
  }

  // We'll build an array of "cards" to render.
  // Each card = 1 order_group with {headlineStatus, mergedItems, total, ...}

  const cards: Array<{
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
  }> = [];

  // We'll hydrate each order_group sequentially.
  // (Could be parallel later, but this is fine for now)
  for (const og of orderGroups) {
    // 2. Fetch tickets for this order_group
    const { data: ticketsRows, error: ticketsErr } = await supabase
      .from("tickets")
      .select("*")
      .eq("order_group_id", og.id)
      .order("created_at", { ascending: true })
      .returns<Ticket[]>();

    if (ticketsErr) {
      throw ticketsErr;
    }

    const ticketsSafe = ticketsRows ?? [];

    // If all tickets are done, skip this order_group entirely (so it drops off the view)
    if (orderGroupIsDone(ticketsSafe)) {
      continue;
    }

    // 3. Fetch line items for this order_group's tickets
    const ticketIds = ticketsSafe.map((t) => t.id);

    let allLineItems: LineItem[] = [];
    if (ticketIds.length > 0) {
      const { data: lineItemsRows, error: lineItemsErr } = await supabase
        .from("line_items")
        .select("*")
        .in("ticket_id", ticketIds)
        .returns<LineItem[]>();

      if (lineItemsErr) {
        throw lineItemsErr;
      }

      allLineItems = lineItemsRows ?? [];
    }

    // 4. Merge items for guest display
    //
    // Rules for merging:
    // - Only merge lines if they are literally the same item code.
    //   We treat that as same sku OR same (name+price) when sku is null.
    // - Notes/modifiers must match too. If they differ, keep separate lines.
    //
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
        const sameSku =
          row.sku !== null &&
          li.sku !== null &&
          row.sku === li.sku;

        const bothNoSkuButSameIdent =
          row.sku === null &&
          li.sku === null &&
          row.name === li.name &&
          row.price_minor === li.price_minor;

        const canMergeByCode = sameSku || bothNoSkuButSameIdent;

        const sameNotes = row.notes === li.notes;

        const sameModifiersJSON =
          JSON.stringify(row.modifiers ?? []) ===
          JSON.stringify(li.modifiers ?? []);

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

    const totalMinor = mergedRows.reduce(
      (sum, row) => sum + row.qty * row.price_minor,
      0
    );

    // 5. "headline status" = combined status of all tickets in that order_group
    const headlineStatus = deriveOverallStatus(ticketsSafe);

    // 6. specialNote = first ticket.metadata.notes (if any)
    const specialNote =
      ticketsSafe.find((t) => t.metadata?.notes)?.metadata?.notes || null;

    // 7. Push card for rendering
    cards.push({
      orderGroup: og,
      headlineStatus,
      specialNote,
      mergedRows,
      totalMinor,
    });
  }

  // After building cards, if literally none are active, we 404
  // (You could choose to render "You're all done!" instead.)
  if (cards.length === 0) {
    notFound();
  }

  // ---------- RENDER ----------
  return (
    <main className="mx-auto max-w-md p-4 space-y-6 text-zinc-100 bg-black min-h-screen">
      {/* Table header / identity */}
      <header className="text-center space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">
          TABLE
        </div>
        <div className="text-xl font-semibold text-zinc-100 break-all">
          {cards[0]?.orderGroup.table_id ?? "—"}
        </div>
        <div className="text-[12px] text-zinc-500">
          This shows all active orders for this table.
        </div>
      </header>

      {/* Active orders for this table */}
      {cards.map(
        (
          { orderGroup, headlineStatus, specialNote, mergedRows, totalMinor },
          idx
        ) => (
          <section
            key={orderGroup.id}
            className="rounded-2xl border border-zinc-700 p-4 shadow-sm space-y-4"
          >
            {/* ORDER HEADER */}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] uppercase text-zinc-400 tracking-wide">
                  ORDER CODE
                </div>

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
              <div className="text-[12px] text-zinc-400 italic">
                “{specialNote}”
              </div>
            ) : null}

            {/* ITEMS */}
            {mergedRows.length > 0 ? (
              <ul className="space-y-3">
                {mergedRows.map((row, i) => (
                  <li
                    key={i}
                    className="flex items-start justify-between text-sm"
                  >
                    <div>
                      <div className="font-medium text-zinc-100">
                        {row.qty}× {row.name}
                      </div>

                      {row.notes ? (
                        <div className="text-[11px] text-zinc-500 italic">
                          {row.notes}
                        </div>
                      ) : null}

                      {row.modifiers &&
                      (row.modifiers as unknown[]).length > 0 ? (
                        <div className="text-[11px] text-zinc-500">
                          {Array.isArray(row.modifiers)
                            ? row.modifiers.join(", ")
                            : ""}
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
              <div className="text-[12px] text-zinc-500 italic">
                No items yet.
              </div>
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
        href={`/order?table_id=${encodeURIComponent(
          cards[0]?.orderGroup.table_id ?? ""
        )}`}
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
