import { fetchESPN, RawArticle } from "@/lib/fetchers";
import { summarizeText, classifyCategory } from "@/lib/summarizer";
import { supabaseBrowser } from "@/lib/db"; // use service or anon client depending on context

interface NewsArticleInsert {
  title: string;
  summary: string;
  image_url?: string | null;
  source_url: string;
  source: string;
  category: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const espnArticles: RawArticle[] = await fetchESPN();

    for (const article of espnArticles) {
      // 1. Check if already exists
      const { data: existing, error: existingError } = await supabaseBrowser
        .from("news_articles")
        .select("id")
        .eq("source_url", article.link)
        .maybeSingle();

      if (existingError) {
        console.error("Supabase select error:", existingError.message);
        continue;
      }
      if (existing) continue;

      // 2. Summarize + categorize
      const summary: string = await summarizeText(
        article.description || article.title
      );
      const rawCategory: string = await classifyCategory(
        article.title + " " + article.description
      );

      // Clean category (remove "Category:" prefix if AI adds it)
      const category: string = rawCategory.replace(/^Category:/i, "").trim();

      // 3. Insert into DB
      const newArticle: NewsArticleInsert = {
        title: article.title,
        summary,
        image_url: article.image || null,
        source_url: article.link,
        source: article.source,
        category,
      };

      const { error: insertError } = await supabaseBrowser
        .from("news_articles")
        .insert(newArticle);

      if (insertError) {
        console.error("Insert error:", insertError.message);
      }
    }

    return new Response(JSON.stringify({ message: "News updated" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: unknown) {
  const message =
    e instanceof Error ? e.message : "Unknown error occurred";
  console.error("Handler error:", e);
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}
}
