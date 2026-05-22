// app/api/cron/news/route.ts
import { NextResponse } from "next/server";

async function tryIngest(url: string) {
  try {
    const res = await fetch(url, {
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

    return { ok: true as const, res, data };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "fetch failed";
    return { ok: false as const, error: message };
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const requestUrl = new URL(req.url);
    const dryRun = requestUrl.searchParams.get("dryRun") === "1";
    const requestOrigin = requestUrl.origin;
    const isLocalRequest =
      requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1";

    const baseUrl = isLocalRequest
      ? requestOrigin
      : process.env.NEXT_PUBLIC_BASE_URL || requestOrigin;

    const ingestPath = dryRun ? "/api/news/ingest?dryRun=1" : "/api/news/ingest";
    const primaryIngestUrl = new URL(ingestPath, baseUrl).toString();
    const attempts = [primaryIngestUrl];

    if (isLocalRequest) {
      const localhostFallback = `${requestUrl.protocol}//127.0.0.1:${requestUrl.port}${ingestPath}`;
      if (!attempts.includes(localhostFallback)) attempts.push(localhostFallback);
    }

    let finalAttemptUrl = attempts[0];
    let attemptError: string | null = null;
    let parsed: unknown = null;
    let status = 0;

    for (const ingestUrl of attempts) {
      finalAttemptUrl = ingestUrl;
      const result = await tryIngest(ingestUrl);

      if (!result.ok) {
        attemptError = result.error;
        continue;
      }

      status = result.res.status;
      parsed = result.data;

      // 422 from ingest means "no new valid article found" and is expected.
      if (result.res.status === 422) {
        return NextResponse.json({
          ok: true,
          triggered: true,
          ingestStatus: 422,
          ingestUrl,
          data: parsed,
        });
      }

      if (!result.res.ok) {
        return NextResponse.json(
          { ok: false, triggered: true, status: result.res.status, ingestUrl, data: parsed },
          { status: 502 }
        );
      }

      return NextResponse.json({ ok: true, triggered: true, ingestUrl, data: parsed });
    }

    return NextResponse.json(
      {
        ok: false,
        error: attemptError || "fetch failed",
        attemptedIngestUrls: attempts,
        lastIngestUrl: finalAttemptUrl,
        lastStatus: status,
        lastData: parsed,
      },
      { status: 500 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Cron failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
