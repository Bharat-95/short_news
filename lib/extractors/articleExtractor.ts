import * as cheerio from "cheerio";
import { httpGet } from "../utils/http";
import { absoluteUrl, cleanUrl } from "../utils/url";
import { stripHtml } from "../utils/normalize";

export interface ExtractedArticle {
  title: string;
  description: string;
  image: string | null;
  pubDate: string | null;
  fullText: string;
}

const ARTICLE_SELECTORS = [
  "article",
  ".article-body",
  ".post-content",
  ".entry-content",
  ".td-post-content",
  ".content-area",
  ".content-body",
  ".node__content",
  ".story-content",
  ".news-content",
  "#content",
  "#main-content",
];

function cleanText(s?: string | null): string {
  if (!s) return "";
  return stripHtml(s)
    .replace(/\s+/g, " ")
    .replace(/[^\w\s.,!?'"-]/g, " ")
    .trim();
}

export async function extractArticle(
  url: string,
  base: string
): Promise<ExtractedArticle | null> {
  const html = await httpGet(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  const title =
    $("meta[property='og:title']").attr("content") ||
    $("h1").first().text().trim() ||
    $("title").first().text().trim() ||
    "";

  const metaDesc =
    $("meta[property='og:description']").attr("content") ||
    $("meta[name='description']").attr("content") ||
    "";

  const metaImage =
    $("meta[property='og:image']").attr("content") ||
    $("figure img").attr("src") ||
    $("img").first().attr("src") ||
    null;

  const pubDate =
    $("meta[property='article:published_time']").attr("content") ||
    $("time[datetime]").attr("datetime") ||
    null;

  let paragraphs: string[] = [];

  for (const sel of ARTICLE_SELECTORS) {
    const block = $(sel);
    if (!block.length) continue;

    block.find("script, style, noscript, .ads, .share").remove();

    block.find("p").each((_, p) => {
      const t = $(p).text().trim();
      if (t.length > 20) paragraphs.push(t);
    });

    if (paragraphs.length >= 2) break;
  }

  // Super fallback: ALL <p> tags (but filtered)
  if (paragraphs.length < 2) {
    $("p").each((_, p) => {
      const t = $(p).text().trim();
      if (t.length > 25 && !t.includes("©") && !t.includes("cookie"))
        paragraphs.push(t);
    });
  }

  let fullText = cleanText(paragraphs.join("\n\n"));

  if (fullText.length < 100) {
    fullText = cleanText(metaDesc);
  }

 if (!fullText || fullText.length < 100) {
  // fallback: join all <p>
  const allText = $("p")
    .map((_, p) => $(p).text().trim())
    .get()
    .join(" ");

  if (allText.length > 120) {
    fullText = cleanText(allText);
  }
}


  return {
    title: stripHtml(title),
    description: stripHtml(metaDesc),
    image: metaImage ? absoluteUrl(metaImage, base) : null,
    pubDate: pubDate ? new Date(pubDate).toISOString() : null,
    fullText,
  };
}
