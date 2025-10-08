export default function Home() {
  return (
    <main className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">KwikOrder Engine</h1>
      <ul className="list-disc pl-6 space-y-2">
        <li><a className="underline" href="/demo">/demo</a></li>
        <li><a className="underline" href="/status/TEST1">/status/TEST1</a></li>
        <li><a className="underline" href="/api/ping">/api/ping</a></li>
      </ul>
    </main>
  );
}
