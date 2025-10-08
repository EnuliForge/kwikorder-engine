// apps/web/src/app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">KwikOrder Engine</h1>
      <ul className="list-disc pl-6 space-y-2">
        <li><Link className="underline" href="/demo">/demo</Link></li>
        <li><Link className="underline" href="/status/TEST1">/status/TEST1</Link></li>
        <li><Link className="underline" href="/api/ping">/api/ping</Link></li>
      </ul>
    </main>
  );
}
