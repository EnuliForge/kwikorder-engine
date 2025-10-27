"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ModifierOption = {
  id: string;
  label: string;
  price_delta_minor: number;
  sort_order: number;
};

type ModifierGroup = {
  id: string;
  name: string;
  prompt: string;
  type: "single" | "multi";
  required: boolean;
  sort_order: number;
  options: ModifierOption[];
};

export type MenuItem = {
  id: string;
  name: string;
  sku: string;
  stream: "kitchen" | "bar" | "special";
  price_minor: number;
  modifier_groups: ModifierGroup[];
};

type CartItem = {
  id: string;
  signature: string;
  sku: string;
  name: string;
  qty: number;
  stream: "kitchen" | "bar" | "special";
  base_price_minor: number;
  final_price_minor: number;
  modifiers: string[];
};

export default function OrderClient({
  tenantId,
  tableId,
  menu,
}: {
  tenantId: string;
  tableId: string;
  menu: MenuItem[];
}) {
  const router = useRouter();

  // modal
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});

  // cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [cartOpen, setCartOpen] = useState(false);

  // local flash for + buttons
  const [flashSig, setFlashSig] = useState<string | null>(null);
  const [flashMenuId, setFlashMenuId] = useState<string | null>(null);

  function formatMoney(cents: number) {
    return `${(cents / 100).toFixed(2)} ZMW`;
  }

  function closeModal() {
    setActiveItem(null);
    setSelections({});
  }

  function toggleSelection(group: ModifierGroup, optionLabel: string) {
    setSelections((prev) => {
      const current = prev[group.id] || [];
      if (group.type === "single") {
        return { ...prev, [group.id]: [optionLabel] };
      } else {
        if (current.includes(optionLabel)) {
          return {
            ...prev,
            [group.id]: current.filter((o) => o !== optionLabel),
          };
        } else {
          return {
            ...prev,
            [group.id]: [...current, optionLabel],
          };
        }
      }
    });
  }

  // add/merge cart line
  function addLineToCart(item: MenuItem, chosen: Record<string, string[]>) {
    // required groups
    const missing = item.modifier_groups?.filter(
      (g) => g.required && (!chosen[g.id] || chosen[g.id].length === 0)
    );
    if (missing && missing.length > 0) {
      alert(
        "Please select: " +
          missing.map((g) => `"${g.prompt}"`).join(", ")
      );
      return;
    }

    // modifiers as strings
    const modifierStrings: string[] = [];
    item.modifier_groups?.forEach((g) => {
      const picked = chosen[g.id] || [];
      picked.forEach((label) => {
        modifierStrings.push(label);
      });
    });

    // final/unit price
    let finalPrice = item.price_minor;
    item.modifier_groups?.forEach((g) => {
      const picked = chosen[g.id] || [];
      picked.forEach((label) => {
        const opt = g.options.find((o) => o.label === label);
        if (opt && opt.price_delta_minor) {
          finalPrice += opt.price_delta_minor;
        }
      });
    });

    // signature
    const signature = JSON.stringify({
      sku: item.sku,
      modifiers: modifierStrings.slice().sort(),
      finalPrice,
    });

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (line) => line.signature === signature
      );

      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          qty: updated[existingIndex].qty + 1,
        };

        // trigger blink on cart + button
        setFlashSig(signature);
        setTimeout(() => setFlashSig(null), 180);

        return updated;
      }

      // new line
      const newCart = [
        ...prev,
        {
          id: crypto.randomUUID(),
          signature,
          sku: item.sku,
          name: item.name,
          stream: item.stream,
          qty: 1,
          base_price_minor: item.price_minor,
          final_price_minor: finalPrice,
          modifiers: modifierStrings,
        },
      ];

      // blink for this new line
      setFlashSig(signature);
      setTimeout(() => setFlashSig(null), 180);

      return newCart;
    });

    // blink for menu card +
    setFlashMenuId(item.id);
    setTimeout(() => setFlashMenuId(null), 180);

    closeModal();
  }

  function incrementQty(signature: string) {
    setCart((prev) =>
      prev.map((line) =>
        line.signature === signature
          ? { ...line, qty: line.qty + 1 }
          : line
      )
    );

    // blink on +
    setFlashSig(signature);
    setTimeout(() => setFlashSig(null), 180);
  }

  function decrementQty(signature: string) {
    setCart((prev) =>
      prev
        .map((line) =>
          line.signature === signature
            ? { ...line, qty: line.qty - 1 }
            : line
        )
        .filter((line) => line.qty > 0)
    );
  }

  async function submitOrder() {
    if (cart.length === 0) {
      alert("Your order is empty.");
      return;
    }

    const roundNote = notes;

    const res = await fetch("/api/place-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        table_id: tableId,
        context: "dine-in",
        notes: roundNote,
        cart: cart.map((line) => ({
          sku: line.sku,
          name: line.name,
          stream: line.stream,
          qty: line.qty,
          price_minor: line.final_price_minor,
          modifiers: line.modifiers,
          notes: roundNote,
        })),
      }),
    });

   if (!res.ok) {
  const errText = await res.text();
  console.error("ORDER SUBMIT FAILED", res.status, errText);
  alert(`There was a problem sending your order.\n${res.status}: ${errText}`);
  return;
}




    const data = await res.json();
    setCart([]);
    router.push(`/status/${data.table_id}`);
  }

  // open modal OR auto-add
  function startAdd(item: MenuItem) {
    if (!item.modifier_groups || item.modifier_groups.length === 0) {
      addLineToCart(item, {}); // instant
      return;
    }
    setActiveItem(item);
    setSelections({});
  }

  // build menu sections
  const foodItems = menu.filter((m) => m.stream === "kitchen");
  const drinkItems = menu.filter((m) => m.stream === "bar");
  const specialItems = menu.filter((m) => m.stream === "special");

  // inline Section so it can call addLineToCart
  function Section({ title, items }: { title: string; items: MenuItem[] }) {
    return (
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-center mb-4 text-white">
          {title}
        </h2>

        <div className="space-y-4">
          {items.map((item) => {
            const flashThis = flashMenuId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.modifier_groups.length > 0) {
                    startAdd(item);
                  } else {
                    addLineToCart(item, {});
                  }
                }}
                className="w-full rounded-2xl border border-gray-700 bg-white p-4 text-left shadow-sm active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* left side */}
                  <div className="flex flex-col flex-1 text-left">
                    <div className="text-lg font-semibold text-gray-900">
                      {item.name}
                    </div>
                    <div className="text-lg font-semibold text-gray-900">
                      {formatMoney(item.price_minor)}
                    </div>
                    <div className="text-sm text-gray-500 mt-2">
                      {item.modifier_groups.length > 0
                        ? "Tap to choose details"
                        : "Add to order"}
                    </div>
                  </div>

                  {/* + button (only if no modifiers) */}
                  {item.modifier_groups.length === 0 && (
                    <div
                      className={[
                        "w-10 h-10 rounded-xl border border-gray-900 text-xl font-semibold flex items-center justify-center active:scale-[0.97] transition-colors duration-150",
                        flashThis
                          ? "bg-white text-black"
                          : "bg-black text-white",
                      ].join(" ")}
                      onClick={(e) => {
                        e.stopPropagation();
                        addLineToCart(item, {});
                      }}
                    >
                      +
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  // total
  const cartTotal = cart.reduce(
    (sum, l) => sum + l.final_price_minor * l.qty,
    0
  );

  return (
    <main className="max-w-md mx-auto p-4 pb-40 bg-black text-white min-h-screen">
      {/* Header */}
      <header className="text-center mb-8">
        <div className="text-sm text-white mb-1">Table</div>
        <div className="text-3xl font-semibold tracking-tight text-white">
          {tableId}
        </div>
      </header>

      {/* Sections */}
      {foodItems.length > 0 && (
        <Section title="Food" items={foodItems} />
      )}

      {drinkItems.length > 0 && (
        <Section title="Drinks" items={drinkItems} />
      )}

      {specialItems.length > 0 && (
        <Section title="Bottle Service" items={specialItems} />
      )}

      {/* Notes */}
      <div className="mt-10">
        <label className="block text-base font-medium mb-2 text-white text-center">
          Notes for this order
        </label>
        <textarea
          className="w-full border border-gray-300 rounded-lg p-3 text-base text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/20"
          rows={3}
          placeholder="All drinks no ice, etc."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Cart drawer */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-black text-white shadow-[0_-20px_40px_rgba(0,0,0,0.4)]">
          <div className="max-w-md mx-auto">
            {/* collapsed header */}
            <button
              className="w-full flex items-center justify-between px-4 py-4 active:scale-[0.99]"
              onClick={() => setCartOpen((o) => !o)}
            >
              <div className="text-left">
                <div className="text-sm font-semibold">
                  Your Order ({cart.length}{" "}
                  {cart.length === 1 ? "item" : "items"})
                </div>
                <div className="text-xs opacity-80">
                  Total {formatMoney(cartTotal)}
                </div>
              </div>

              <div className="text-sm font-semibold border border-white/40 rounded-lg px-3 py-1">
                {cartOpen ? "Hide" : "View"}
              </div>
            </button>

            {/* expanded content */}
            {cartOpen && (
              <div className="bg-white text-gray-900 px-4 pb-4 space-y-4 rounded-t-2xl">
                <ul className="space-y-2 max-h-[60vh] overflow-y-auto text-base">
                  {cart.map((line) => {
                    const flashing = flashSig === line.signature;

                    return (
                      <li
                        key={line.id}
                        className={[
                          // 30% tighter: smaller padding, smaller text
                          "rounded-xl border border-gray-200 bg-gray-50",
                          "px-3 py-3",
                          "transition-colors duration-150",
                          flashing
                            ? "bg-white border-black"
                            : "bg-gray-50 border-gray-200",
                        ].join(" ")}
                      >
                        {/* name + total */}
                        <div className="flex justify-between mb-1">
                          <div className="font-semibold text-black text-[15px] leading-tight">
                            {line.name}
                          </div>
                          <div className="font-semibold text-amber-600 text-[15px] leading-tight">
                            {formatMoney(
                              line.final_price_minor * line.qty
                            )}
                          </div>
                        </div>

                        {/* modifiers */}
                        {line.modifiers.length > 0 && (
                          <div className="text-gray-700 text-[13px] mb-2 leading-snug">
                            {line.modifiers.join(", ")}
                          </div>
                        )}

                        {/* qty row */}
                        <div className="flex items-center justify-between">
                          <div className="text-[12px] text-gray-600">
                            {formatMoney(
                              line.final_price_minor
                            )}{" "}
                            each
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() =>
                                decrementQty(line.signature)
                              }
                              className="w-8 h-8 rounded-lg border border-gray-300 bg-white text-lg font-semibold flex items-center justify-center active:scale-[0.97]"
                            >
                              –
                            </button>

                            <div className="min-w-[2ch] text-center text-base font-semibold text-gray-900">
                              {line.qty}
                            </div>

                            <button
                              onClick={() =>
                                incrementQty(line.signature)
                              }
                              className={[
                                "w-8 h-8 rounded-lg border text-lg font-semibold flex items-center justify-center active:scale-[0.97] transition-colors duration-150",
                                flashing
                                  ? "bg-white text-black border-black"
                                  : "bg-black text-white border-gray-900",
                              ].join(" ")}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <button
                  onClick={submitOrder}
                  className="w-full bg-black text-white py-3 rounded-xl text-center text-base font-semibold active:scale-[0.99]"
                >
                  Send Order
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Customization Modal */}
      {activeItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-6 shadow-xl max-h-[90vh] overflow-y-auto text-gray-900">
            {/* title / price */}
            <div className="text-center space-y-1">
              <div className="text-xl font-semibold">
                {activeItem.name}
              </div>
              <div className="text-base text-gray-600">
                {formatMoney(activeItem.price_minor)} base
              </div>
            </div>

            {/* choices */}
            {activeItem.modifier_groups.map((group) => (
              <div key={group.id} className="space-y-3">
                <div className="text-base font-medium text-gray-800 text-center">
                  {group.prompt}
                  {group.required && (
                    <span className="text-red-500"> *</span>
                  )}
                </div>

                <div className="space-y-2">
                  {group.options.map((opt) => {
                    const chosen =
                      selections[group.id]?.includes(opt.label) ||
                      false;
                    return (
                      <button
                        key={opt.id}
                        onClick={() =>
                          toggleSelection(group, opt.label)
                        }
                        className={`w-full rounded-xl border p-4 text-base font-medium text-center ${
                          chosen
                            ? "bg-black text-white border-black"
                            : "bg-white text-gray-900 border-gray-300"
                        }`}
                      >
                        <div className="flex flex-col items-center justify-center gap-1">
                          <span className="text-center">
                            {opt.label}
                          </span>
                          {opt.price_delta_minor > 0 && (
                            <span className="text-sm font-normal opacity-80">
                              +{formatMoney(opt.price_delta_minor)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={closeModal}
                className="flex-1 border border-gray-300 rounded-xl py-3 text-base font-medium text-gray-700 bg-white active:scale-[0.99]"
              >
                Cancel
              </button>
              <button
                onClick={() => addLineToCart(activeItem, selections)}
                className="flex-1 bg-black text-white rounded-xl py-3 text-base font-semibold active:scale-[0.99]"
              >
                Add to order
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
