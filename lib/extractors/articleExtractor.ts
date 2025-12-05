// lib/extractors/articleExtractor.ts

import * as cheerio from "cheerio";
import { httpGet } from "../utils/http";
import { absoluteUrl, cleanUrl } from "../utils/url";
import { stripHtml, normalizeWhitespace } from "../utils/normalize";
import { logError, logSiteStep } from "../utils/logging";

export interface ExtractedArticle {
  title: string;
  description: string;
  image: string | null;
  pubDate: string | null;
  fullText: string;
}

/** Acceptable article containers */
const ARTICLE_SELECTORS = [
  "article",
  ".article",
  ".post",
  ".post-content",
  ".entry-content",
  ".news-content",
  ".story-content",
  ".node__content",
  ".node-content",
  ".content-body",
  ".content-area",
  ".field--name-body",
  "#content",
  "#main-content",
];

/** Reject pages like "/category/news/" */
function isCategoryPage(url: string): boolean {
  return /\/category\//i.test(url) || /\/tag\//i.test(url) || /\/author\//i.test(url);
}

/** Clean and normalize extracted text */
function cleanText(s?: string | null): string {
  if (!s) return "";
  return stripHtml(s)
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^\w\s.,!?'"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ------------------ MAIN EXTRACTION --------------------- */
export async function extractArticle(
  url: string,
  sourceBase: string
): Promise<ExtractedArticle | null> {
  try {
    if (isCategoryPage(url)) {
      logSiteStep("extractArticle", "SKIPPED_CATEGORY", url);
      return null;
    }

    const html = await httpGet(url);
    if (!html) return null;

    const $ = cheerio.load(html);

    // --------------------------------------------------
    // TITLE
    // --------------------------------------------------
    const title =
      $("meta[property='og:title']").attr("content") ||
      $("meta[name='twitter:title']").attr("content") ||
      $("h1").first().text().trim() ||
      $("title").first().text().trim() ||
      "";

    // --------------------------------------------------
    // DESCRIPTION
    // --------------------------------------------------
    const metaDesc =
      $("meta[property='og:description']").attr("content") ||
      $("meta[name='description']").attr("content") ||
      $("meta[name='twitter:description']").attr("content") ||
      "";

    // --------------------------------------------------
    // IMAGE
    // --------------------------------------------------
    const metaImage =
      $("meta[property='og:image']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      $("figure img").first().attr("src") ||
      $("img").first().attr("src") ||
      null;

    const image = metaImage ? absoluteUrl(metaImage, sourceBase) : null;

    // --------------------------------------------------
    // PUBLISH DATE
    // --------------------------------------------------
    const timeMeta =
      $("meta[property='article:published_time']").attr("content") ||
      $("meta[name='pubdate']").attr("content") ||
      $("meta[itemprop='datePublished']").attr("content") ||
      $("time[datetime]").attr("datetime") ||
      null;

    const pubDate = timeMeta ? new Date(timeMeta).toISOString() : null;

    // --------------------------------------------------
    // FULL ARTICLE TEXT
    // --------------------------------------------------
    let paragraphs: string[] = [];

    // Try main selectors first
    for (const sel of ARTICLE_SELECTORS) {
      const block = $(sel);
      if (!block.length) continue;

      block.find("script, style, .advert, .ads, .share, .social, noscript").remove();

      block.find("p").each((_, p) => {
        const t = $(p).text().trim();
        if (t.length > 25) paragraphs.push(t);
      });

      if (paragraphs.length >= 3) break;
    }

    // Fallback: scan whole DOM
    if (paragraphs.length < 3) {
      $("p").each((_, p) => {
        const t = $(p).text().trim();
        if (t.length > 30) paragraphs.push(t);
      });
    }

    let fullText = paragraphs.join("\n\n").trim();

    // Fallback to meta description
    if (!fullText || fullText.length < 120) {
      fullText = metaDesc || "";
    }

    fullText = cleanText(fullText);

    // --------------------------------------------------
    // FINAL RETURN
    // --------------------------------------------------
    return {
      title: stripHtml(title) || "Untitled",
      description: stripHtml(metaDesc).trim(),
      image,
      pubDate,
      fullText,
    };
  } catch (err) {
    logError("extractArticle", url, err);
    return null;
  }
}
