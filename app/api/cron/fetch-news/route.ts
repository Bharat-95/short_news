// app/api/cron/fetch-news/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
  const res = await fetch(`${baseUrl}/api/news`, { method: "POST" });
  const json = await res.json();

  return NextResponse.json({
    ok: true,
    triggered: new Date().toISOString(),
    newsResponse: json
  });
}
