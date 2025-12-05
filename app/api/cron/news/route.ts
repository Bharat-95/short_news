// app/api/cron/news/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const ingestUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/news/ingest`;

    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    return NextResponse.json({ ok: true, triggered: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Cron failed" },
      { status: 500 }
    );
  }
}
