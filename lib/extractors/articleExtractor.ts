import * as cheerio from "cheerio";
import { httpGet } from "../utils/http";
import { absoluteUrl } from "../utils/url";
import { stripHtml, normalizeWhitespace } from "../utils/normalize";

export interface ExtractedArticle {
  title: string;
  description: string;
  image: string | null;
  pubDate: string | null;
  fullText: string;
}

/** Universal text cleaner */
function clean(text: string) {
  return normalizeWhitespace(stripHtml(text));
}

/** Universal article extractor — works for all Mauritian sites */
export async function extractArticle(url: string, base: string): Promise<ExtractedArticle | null> {
  const html = await httpGet(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  // -----------------------------
  // TITLE
  // -----------------------------
  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text() ||
    $("title").text() ||
    "";

  // -----------------------------
  // DESCRIPTION
  // -----------------------------
  const desc =
    $('meta[property="og:description"]').attr("content") ||
    $("meta[name=description]").attr("content") ||
    "";

  // -----------------------------
  // IMAGE
  // -----------------------------
  const img =
    $('meta[property="og:image"]').attr("content") ||
    $("figure img").first().attr("src") ||
    $("img").first().attr("src") ||
    null;

  const image = img ? absoluteUrl(img, base) : null;

  // -----------------------------
  // DATE
  // -----------------------------
  const pub =
    $('meta[property="article:published_time"]').attr("content") ||
    $("time").attr("datetime") ||
    null;

  // -----------------------------
  // UNIVERSAL FULL TEXT EXTRACTION
  // (works for ALL Mauritian news websites)
  // -----------------------------
  const TEXT_SELECTORS = [
    "article",
    ".article",
    ".content",
    ".content-area",
    ".entry-content",
    ".post-content",
    ".td-post-content",
    ".field--name-body",
    ".node__content",
    ".news-content",
    ".story-content",
    "#content",
    "#main-content"
  ];

  let paragraphs: string[] = [];

  for (const sel of TEXT_SELECTORS) {
    $(sel)
      .find("p")
      .each((_, p) => {
        const t = clean($(p).text());
        if (t.length > 25) paragraphs.push(t);
      });

    if (paragraphs.length > 3) break;
  }

  // Fallback: scan entire DOM
  if (paragraphs.length < 3) {
    $("p").each((_, p) => {
      const t = clean($(p).text());
      if (t.length > 25) paragraphs.push(t);
    });
  }

  let fullText = paragraphs.join("\n\n");

  // FINAL fallback: meta description
  if (fullText.length < 80) {
    fullText = clean(desc || title);
  }

  return {
    title: clean(title),
    description: clean(desc),
    image,
    pubDate: pub ? new Date(pub).toISOString() : null,
    fullText
  };
}
