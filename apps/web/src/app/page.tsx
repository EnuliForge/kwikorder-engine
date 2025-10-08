import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1>KwikOrder Engine</h1>
      <ul>
        <li><Link href="/demo">/demo</Link></li>
        <li><Link href="/status/TEST1">/status/TEST1</Link></li>
        <li><a href="/api/ping">/api/ping</a></li>
      </ul>
    </main>
  );
}
