import { NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // ensure function, not static

export async function GET() {
  return NextResponse.json({ ok: true, t: new Date().toISOString() });
}
