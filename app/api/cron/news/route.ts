// app/api/cron/news/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const requestUrl = new URL(req.url);
    const requestOrigin = requestUrl.origin;
    const isLocalRequest =
      requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1";

    // For local testing, always call the local ingest route even if env points to Vercel.
    const baseUrl = isLocalRequest
      ? requestOrigin
      : process.env.NEXT_PUBLIC_BASE_URL || requestOrigin;
    const ingestUrl = new URL("/api/news/ingest", baseUrl).toString();

    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    const raw = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { nonJsonResponse: raw.slice(0, 500) };
    }

    // 422 from ingest means "no new valid article found" and is expected.
    if (res.status === 422) {
      return NextResponse.json({
        ok: true,
        triggered: true,
        ingestStatus: 422,
        ingestUrl,
        data,
      });
    }

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, triggered: true, status: res.status, ingestUrl, data },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, triggered: true, ingestUrl, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Cron failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
