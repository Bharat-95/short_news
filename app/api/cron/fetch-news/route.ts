// app/api/cron/fetch-news/route.ts
export const runtime = "edge";

export async function GET() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL}/api/news`,
    { method: "POST" }
  );

  const json = await res.json();

  return new Response(JSON.stringify(json), {
    headers: { "Content-Type": "application/json" }
  });
}
