/** Environment-agnostic UUID (prefers Web Crypto, falls back to Math.random) */
export function safeUUID(): string {
  try {
    // Use Web Crypto when available (browser / edge / some Node envs)
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    const maybe = g.crypto?.randomUUID?.();
    if (typeof maybe === "string") return maybe;
  } catch {
    /* ignore */
  }

  // RFC4122-ish v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

