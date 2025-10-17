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

      if (!res.ok) {
        // Try to surface server error text if available
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { ok?: boolean; error?: string };
          if (j?.error) msg = j.error;
        } catch { /* ignore parse errors */ }
        throw new Error(msg);
      }

      const json = (await res.json()) as {
        ok: boolean;
        order: { order_code: string };
      };

      if (!json.ok || !json.order?.order_code) {
        throw new Error("Failed to start demo");
      }

      const orderCode = json.order.order_code;
      location.href = `/status/${encodeURIComponent(orderCode)}`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
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
