"use client";
import { useState } from "react";

export default function Demo() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startDemo() {
    setBusy(true);
    setErr(null);
    try {
      const code = crypto.randomUUID().slice(0, 8).toUpperCase();
      const res = await fetch("/api/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, context: "dine-in" }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to start demo");
      const orderCode: string = json.order.order_code;
      location.href = `/status/${encodeURIComponent(orderCode)}`;
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Demo</h1>
      <p>Click to create a new order and jump to its live status page.</p>
      <button
        disabled={busy}
        onClick={startDemo}
        style={{ padding: 12, cursor: busy ? "not-allowed" : "pointer" }}
      >
        {busy ? "Starting…" : "Start Demo Order"}
      </button>
      {err && (
        <p style={{ color: "crimson", marginTop: 12 }}>
          {err}
        </p>
      )}
    </main>
  );
}
