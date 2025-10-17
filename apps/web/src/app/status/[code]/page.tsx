export const dynamic = "force-dynamic";

// Your Next types currently want `params` as a Promise, so keep that:
export default async function StatusPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <main style={{ padding: 24 }}>
      <h1>Status route OK</h1>
      <p>Code: <code>{code}</code></p>
    </main>
  );
}
