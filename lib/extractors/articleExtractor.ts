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

const PUBLISHED_BYLINE_RE =
  /\b(published|publi[eé])\b[\s\S]{0,80}\b(by|par)\b[\s\S]{0,80}/i;

function cleanLeadingMeta(text: string) {
  return text
    .replace(
      /\bPublished\s+\d+\s+\w+\s+ago\s+on\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+By\s+[A-Za-z0-9 .,'-]+/gi,
      " "
    )
    .replace(
      /\bPubli[eé]\s+il\s+y\s+a\s+\d+\s+\w+\s+le\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+par\s+[A-Za-z0-9 .,'-]+/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function cleanParagraph(t: string) {
  const st = cleanLeadingMeta(stripHtml(t).replace(/\s+/g, " ").trim());
  if (st.length < 40) return "";
  if (FOOTER_WORDS.some(w => st.toLowerCase().includes(w))) return "";
  if (PUBLISHED_BYLINE_RE.test(st)) return "";
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

  const paragraphs: string[] = [];
  const seen = new Set<string>();

  for (const sel of ARTICLE_SELECTORS) {
    const block = $(sel);
    if (!block.length) continue;

    block.find("script, style, noscript, .ads, .advert").remove();

    block.find("p, li").each((_, el) => {
      const txt = cleanParagraph($(el).text());
      const key = txt.toLowerCase();
      if (txt && !seen.has(key)) {
        seen.add(key);
        paragraphs.push(txt);
      }
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
