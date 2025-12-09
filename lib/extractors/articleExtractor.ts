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

const ARTICLE_SELECTORS = [
  "article",
  ".article-body",
  ".article-content",
  ".article-details-page-content",
  ".post-content",
  ".entry-content",
  ".content-area",
  ".content-body",
  ".node__content",
  ".field--name-body",
  ".field--type-text-with-summary",
  ".post__content-wrapper",
  ".story-content",
  ".news-content",
  ".single-content",
  ".td-post-content",
];

const FOOTER_WORDS = [
  "disclaimer",
  "privacy policy",
  "abonnement",
  "advertisement",
  "cookies",
  "subscribe",
  "tel ",
  "email ",
  "contact",
];

function cleanParagraph(t: string) {
  const st = stripHtml(t).replace(/\s+/g, " ").trim();
  if (st.length < 40) return "";
  if (FOOTER_WORDS.some(w => st.toLowerCase().includes(w))) return "";
  return st;
}

export async function extractArticle(url: string, base: string) {
  const html = await httpGet(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim();

  const description =
    $('meta[property="og:description"]').attr("content") ||
    $("meta[name='description']").attr("content") ||
    "";

  const metaImage =
    $('meta[property="og:image"]').attr("content") ||
    $("figure img").first().attr("src") ||
    null;

  const pubDateRaw =
    $('meta[property="article:published_time"]').attr("content") ||
    $("time[datetime]").attr("datetime") ||
    null;

  const pubDate = pubDateRaw ? new Date(pubDateRaw).toISOString() : null;

  let paragraphs: string[] = [];

  for (const sel of ARTICLE_SELECTORS) {
    const block = $(sel);
    if (!block.length) continue;

    block.find("script, style, noscript, .ads, .advert").remove();

    block.find("p, div, span").each((_, el) => {
      const txt = cleanParagraph($(el).text());
      if (txt) paragraphs.push(txt);
    });

    if (paragraphs.length >= 4) break;
  }

  if (paragraphs.length < 2) return null;

  const fullText = paragraphs.join(" ");

  return {
    title,
    description,
    image: metaImage ? absoluteUrl(metaImage, base) : null,
    pubDate,
    fullText,
  };
}
