import { fetchESPN } from "@/lib/fetchers";
import { summarizeText, classifyCategory } from "@/lib/summarizer";
import { supabaseBrowser } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const espnArticles = await fetchESPN();

    for (const article of espnArticles) {
      const { data: existing } = await supabaseBrowser
        .from("news_articles")
        .select("id")
        .eq("source_url", article.link)
        .maybeSingle();

      if (existing) continue;

      const summary = await summarizeText(article.description || article.title);
      const category = await classifyCategory(article.title + " " + article.description);

      await supabaseBrowser.from("news_articles").insert({
        title: article.title,
        summary,
        image_url: article.image,
        source_url: article.link,
        source: article.source,
        category,
      });
    }

    return new Response(JSON.stringify({ message: "News updated" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
