// app/api/news/route.ts
import { NextResponse } from "next/server";
import { summarizeText } from "@/lib/summarizer";
import { extractArticle } from "@/lib/fetchers";
import { supabaseBrowser } from "@/lib/db";

const SITES = [
  { source: "Defi Media", base: "https://defimedia.info" },
  { source: "Ion News", base: "https://ionnews.mu" },
  { source: "Le Mauricien", base: "https://lemauricien.com" },
  { source: "Inside News", base: "https://insidenews.mu" },
  { source: "NewsMoris", base: "https://newsmoris.com" }
];

/** simple duplicate check */
async function urlExists(url: string) {
  const { data } = await supabaseBrowser
    .from("news_articles")
    .select("id")
    .eq("source_url", url)
    .limit(1);
  return !!data?.length;
}

/** title similarity */
function similar(a: string, b: string) {
  const A = a.toLowerCase().split(" ");
  const B = b.toLowerCase().split(" ");
  let count = 0;
  for (const w of A) if (B.includes(w)) count++;
  return count / Math.min(A.length, B.length);
}

export async function POST() {
  for (const site of SITES) {
    try {
      const homepage = await fetch(site.base);
      const html = await homepage.text();

      const linkMatch = html.match(/href="([^"]+\/\d{4}[^"]+)"/);
      if (!linkMatch) continue;

      const articleUrl = new URL(linkMatch[1], site.base).href;

      if (await urlExists(articleUrl)) continue;

      const article = await extractArticle(articleUrl, site.source);
      if (!article) continue;

      // summarize → max 45 words
      const summary = await summarizeText(article.fullText);

      // insert
      const { error } = await supabaseBrowser.from("news_articles").insert({
        title: article.title,
        summary,
        image_url: article.image,
        source_url: articleUrl,
        source: site.source,
        topics: "News",
        categories: ["News"],
        pub_date: article.pubDate
      });

      if (!error) {
        return NextResponse.json({
          ok: true,
          inserted: articleUrl,
          summary
        });
      }
    } catch (err) {
      continue;
    }
  }

  return NextResponse.json({ ok: false, message: "no new article found" });
}
