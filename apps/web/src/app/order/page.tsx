"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// IMPORTANT:
// we will import a server action from this same file via an inline "action".
// Next.js 15 supports exporting server functions with "use server".
// But client components can't directly call them like normal JS.
// We'll handle that by posting a <form> to the action for now (simplest, zero custom fetch).

// ------------------------------
// Types that mirror DB
// ------------------------------

type CartItem = {
  name: string;
  sku?: string;
  qty: number;
  price_minor: number; // cents
  stream: "kitchen" | "bar" | "special";
  notes?: string;
  modifiers?: string[];
};

const TABLE_ID = "HL_TB0034"; // this is your table/session ID
const TENANT_ID = "00000000-0000-0000-0000-000000000001";


// We'll keep a tiny pretend menu in-memory for now.
const MENU: Array<{
  name: string;
  sku: string;
  price_minor: number;
  stream: "kitchen" | "bar" | "special";
}> = [
  { name: "Cheeseburger", sku: "SKU-BURGER", price_minor: 9500, stream: "kitchen" },
  { name: "Fries",        sku: "SKU-FRIES",  price_minor: 3000, stream: "kitchen" },
  { name: "Cola",         sku: "SKU-COLA",   price_minor: 1500, stream: "bar" },
  { name: "Birthday Sparkler", sku: "SKU-SPARKLER", price_minor: 2000, stream: "special" },
];
// format cents to "ZMW 95.00"
function money(minor: number) {
  const kwacha = Math.floor(minor / 100);
  const ngwee = minor % 100;
  const ngweeStr = ngwee.toString().padStart(2, "0");
  return `ZMW ${kwacha}.${ngweeStr}`;
}

// We will progressively enhance this to submit.
// For v1 we'll do a hidden form post so we can keep server code colocated.

// We need a little client-side cart.
export default function OrderPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [specialNotes, setSpecialNotes] = useState<string>(""); // global note, optional
  const [isPending, startTransition] = useTransition();

  // add item (or increment qty if it's already in cart)
  function addToCart(sku: string) {
    const menuItem = MENU.find((m) => m.sku === sku);
    if (!menuItem) return;
    setCart((prev) => {
      const existing = prev.find((c) => c.sku === sku);
      if (existing) {
        return prev.map((c) =>
          c.sku === sku ? { ...c, qty: c.qty + 1 } : c
        );
      }
      return [
        ...prev,
        {
          name: menuItem.name,
          sku: menuItem.sku,
          qty: 1,
          price_minor: menuItem.price_minor,
           stream: menuItem.stream, // 👈 NEW
          notes: "",
          modifiers: [],
        },
      ];
    });
  }

  function decItem(sku: string) {
    setCart((prev) => {
      const existing = prev.find((c) => c.sku === sku);
      if (!existing) return prev;
      if (existing.qty === 1) {
        return prev.filter((c) => c.sku !== sku);
      }
      return prev.map((c) =>
        c.sku === sku ? { ...c, qty: c.qty - 1 } : c
      );
    });
  }

  const totalMinor = cart.reduce(
    (sum, item) => sum + item.qty * item.price_minor,
    0
  );

  // handle submit:
  // we'll POST the cart to our own page as a server action using fetch() for now.
  async function handlePlaceOrder() {
    if (cart.length === 0) return;

    // We'll call the /order API route we'll write next.
    startTransition(async () => {
      const res = await fetch("/api/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: TENANT_ID,
          context: "dine-in",
          table_id: TABLE_ID, // 🟢 required
          cart,
          notes: specialNotes,
        }),
      });

      if (!res.ok) {
        console.error("Order failed");
        return;
      }

      const data = (await res.json()) as { order_code: string };
      router.push(`/status/${data.table_id}`);

    });
  }

  return (
    <main className="mx-auto max-w-md p-4 space-y-8 text-zinc-100 bg-black min-h-screen">
      {/* MENU */}
      <section className="space-y-4">
        <h1 className="text-xl font-semibold text-zinc-100">Menu</h1>
        <ul className="space-y-3">
          {MENU.map((item) => (
            <li
              key={item.sku}
              className="flex items-start justify-between rounded-xl border border-zinc-700 p-4"
            >
              <div>
                <div className="text-zinc-100 font-medium text-base">
                  {item.name}
                </div>
                <div className="text-zinc-400 text-sm">
                  {money(item.price_minor)}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-zinc-600 px-2 py-1 text-sm text-zinc-200"
                  onClick={() => decItem(item.sku)}
                >
                  −
                </button>
                <div className="w-8 text-center text-zinc-100 text-sm">
                  {cart.find((c) => c.sku === item.sku)?.qty ?? 0}
                </div>
                <button
                  className="rounded-lg border border-zinc-600 px-2 py-1 text-sm text-zinc-200"
                  onClick={() => addToCart(item.sku)}
                >
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* CART */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-zinc-100">Your order</h2>

        {cart.length === 0 ? (
          <p className="text-zinc-500 text-sm">
            Nothing yet. Add items above.
          </p>
        ) : (
          <ul className="space-y-3">
            {cart.map((item) => (
              <li
                key={item.sku}
                className="flex items-start justify-between rounded-xl border border-zinc-700 p-4"
              >
                <div className="text-zinc-100 text-sm">
                  <div className="font-medium">
                    {item.qty}× {item.name}
                  </div>
                  {item.notes ? (
                    <div className="text-[11px] text-zinc-500 italic">
                      {item.notes}
                    </div>
                  ) : null}
                </div>
                <div className="text-right text-zinc-200 text-sm">
                  {money(item.qty * item.price_minor)}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="text-right text-zinc-300 text-base font-medium">
          Total: {money(totalMinor)}
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-zinc-400 uppercase tracking-wide">
            Notes for kitchen (optional)
          </label>
          <textarea
            className="w-full rounded-lg border border-zinc-700 bg-black p-2 text-sm text-zinc-100"
            rows={2}
            value={specialNotes}
            onChange={(e) => setSpecialNotes(e.target.value)}
            placeholder="No onions on the burger, extra salt on fries..."
          />
        </div>

        <button
          className="w-full rounded-xl bg-zinc-100 text-black font-semibold py-3 text-center text-base disabled:bg-zinc-700 disabled:text-zinc-400"
          disabled={cart.length === 0 || isPending}
          onClick={handlePlaceOrder}
        >
          {isPending ? "Sending..." : "Place order"}
        </button>

        <p className="text-[11px] text-center text-zinc-500">
          You’ll get a live status screen after you place the order.
        </p>
      </section>
    </main>
  );
}
