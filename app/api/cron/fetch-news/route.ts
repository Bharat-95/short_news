// app/api/cron/fetch-news/route.ts
export const runtime = "edge";

export async function GET() {
  const url = `${process.env.NEXT_PUBLIC_BASE_URL}/api/news`;

  const res = await fetch(url, { method: "POST" });
  const json = await res.json();

  return new Response(JSON.stringify(json), {
    headers: { "Content-Type": "application/json" }
  });
}
