import * as cheerio from "cheerio";
import { httpGet } from "../utils/http";
import { absoluteUrl } from "../utils/url";
import { stripHtml } from "../utils/normalize";

export interface ExtractedArticle {
  title: string;
  description: string;
  image: string | null;
  pubDate: string | null;
  fullText: string;
}

/* ----------------------------------------------------------
   BEST ARTICLE CONTENT SELECTORS (Covers All Mauritius Sites)
------------------------------------------------------------- */
const ARTICLE_SELECTORS = [
  "article",
  ".article-body",
  ".article-content",
  ".content-article",
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
  ".single-content",
  ".post-entry",
];

/* ----------------------------------------------------------
   CLEAN TEXT
------------------------------------------------------------- */
function cleanText(text?: string | null): string {
  if (!text) return "";
  return stripHtml(text)
    .replace(/\s+/g, " ")
    .replace(/[^\w\s.,!?'"-]/g, " ")
    .trim();
}

/* ----------------------------------------------------------
   GET BEST IMAGE FROM VARIOUS ATTRIBUTES
------------------------------------------------------------- */
function extractImage($: cheerio.CheerioAPI, base: string) {
  const selectors = [
    "meta[property='og:image']",
    "meta[name='twitter:image']",
    "picture source",
    "figure img",
    "img",
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    if (!el.length) continue;

    const src =
      el.attr("content") ||
      el.attr("srcset") ||
      el.attr("data-src") ||
      el.attr("data-lazy-src") ||
      el.attr("src");

    if (src && src.trim()) return absoluteUrl(src, base);
  }

  return null;
}

/* ----------------------------------------------------------
   STRONG ARTICLE EXTRACTOR (Final Version)
------------------------------------------------------------- */
export async function extractArticle(
  url: string,
  base: string
): Promise<ExtractedArticle | null> {
  const html = await httpGet(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  /* -------------------- TITLE -------------------- */
  const title =
    $("meta[property='og:title']").attr("content") ||
    $("h1").first().text().trim() ||
    $("title").first().text().trim() ||
    "";

  /* -------------------- DESCRIPTION -------------------- */
  const metaDesc =
    $("meta[property='og:description']").attr("content") ||
    $("meta[name='description']").attr("content") ||
    "";

  /* -------------------- IMAGE -------------------- */
  const metaImage = extractImage($, base);

  /* -------------------- PUBLISH DATE -------------------- */
  const pubDateRaw =
    $("meta[property='article:published_time']").attr("content") ||
    $("time[datetime]").attr("datetime") ||
    null;

  const pubDate = pubDateRaw ? new Date(pubDateRaw).toISOString() : null;

  /* -------------------- PARAGRAPHS -------------------- */
  let paragraphs: string[] = [];

  // Try best selectors first
  for (const sel of ARTICLE_SELECTORS) {
    const block = $(sel);
    if (!block.length) continue;

    // Remove garbage
    block.find("script, style, noscript, .ads, .advert, .share, .social").remove();

    block.find("p, span, div").each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 30 && !t.includes("cookie") && !t.includes("©")) {
        paragraphs.push(t);
      }
    });

    if (paragraphs.length >= 3) break;
  }

  // Fallback: ANY <p> tag on page
  if (paragraphs.length < 2) {
    $("p").each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 25 && !t.includes("cookie") && !t.includes("©")) {
        paragraphs.push(t);
      }
    });
  }

  // Fallback: even <span> text (used by Le Mauricien)
  if (paragraphs.length < 2) {
    $("span").each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 25) paragraphs.push(t);
    });
  }

  let fullText = cleanText(paragraphs.join(" "));

  // Emergency fallback: combine all text on page
  if (fullText.length < 100) {
    const allText = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim();

    if (allText.length > 150) {
      fullText = cleanText(allText);
    }
  }

  if (!fullText || fullText.length < 100) return null;

  /* -------------------- FINAL OUTPUT -------------------- */
  return {
    title: stripHtml(title),
    description: stripHtml(metaDesc),
    image: metaImage,
    pubDate,
    fullText,
  };
}
