import * as cheerio from "cheerio";
import { httpGet } from "../utils/http";
import { absoluteUrl } from "../utils/url";
import { normalizeWhitespace, stripHtml } from "../utils/normalize";

export interface ExtractedArticle {
  title: string;
  description: string;
  image: string | null;
  pubDate: string | null;
  fullText: string;
}

const ARTICLE_SELECTORS = [
  "article",
  "main article",
  ".article-body",
  ".article-content",
  ".article-content-wrapper",
  ".article-details-page-content",
  ".post-content",
  ".entry-content",
  ".story-body",
  ".content-area",
  ".content-body",
  ".wysiwyg",
  ".wysiwyg-content",
  ".story-container",
  ".story_details",
  ".itemFullText",
  ".node__content",
  ".field--name-body",
  ".field--type-text-with-summary",
  ".post__content-wrapper",
  ".story-content",
  ".news-content",
  ".single-content",
  ".td-post-content",
  "[data-testid='article-content']",
  "[data-module='ArticleBody']",
  ".articleBody",
];

const DOMAIN_SELECTORS: Array<{ match: RegExp; selectors: string[] }> = [
  {
    match: /thehindu\.com/i,
    selectors: [
      ".articlebodycontent",
      ".storyline",
      ".story-card",
      ".article-content",
    ],
  },
  {
    match: /indianexpress\.com/i,
    selectors: [
      ".full-details",
      ".articles",
      ".article-content",
      ".story_details",
    ],
  },
  {
    match: /indiatoday\.in/i,
    selectors: [
      ".description",
      ".story__content",
      ".strybody",
      ".detail-text",
    ],
  },
  {
    match: /deccanherald\.com/i,
    selectors: [
      ".content-details",
      ".article-detail-content",
      ".field-item",
      ".story-body",
    ],
  },
  {
    match: /khaleejtimes\.com/i,
    selectors: [
      "[data-testid='article-body']",
      ".article-body-wrapper",
      ".article-content",
    ],
  },
  {
    match: /gulfnews\.com/i,
    selectors: [
      ".article-content",
      ".content-body",
      ".story-body",
    ],
  },
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

const NOISE_PHRASES = [
  "all rights reserved",
  "copyright",
  "powered by ict dept",
  "the view from india",
  "first day first show",
  "today's cache",
  "science for all",
  "ask the law",
  "whatsapp channel",
  "follow us",
  "sign up",
  "newsletter",
  "recommended for you",
  "also read",
  "morning digest",
  "evening wrap",
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
  if (NOISE_PHRASES.some((w) => st.toLowerCase().includes(w))) return "";
  if (PUBLISHED_BYLINE_RE.test(st)) return "";
  return st;
}

function selectorsForUrl(url: string) {
  for (const entry of DOMAIN_SELECTORS) {
    if (entry.match.test(url)) {
      return [...entry.selectors, ...ARTICLE_SELECTORS];
    }
  }
  return ARTICLE_SELECTORS;
}

function tryParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function collectJsonLdNodes(input: unknown, bucket: Record<string, unknown>[]) {
  if (!input) return;
  if (Array.isArray(input)) {
    input.forEach((entry) => collectJsonLdNodes(entry, bucket));
    return;
  }
  if (typeof input !== "object") return;

  const node = input as Record<string, unknown>;
  bucket.push(node);

  if (Array.isArray(node["@graph"])) {
    collectJsonLdNodes(node["@graph"], bucket);
  }
}

function firstString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return firstString(obj.url) || firstString(obj["@id"]);
  }
  return null;
}

function extractJsonLd($: cheerio.CheerioAPI) {
  const nodes: Record<string, unknown>[] = [];

  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    const parsed = tryParseJson(raw);
    collectJsonLdNodes(parsed, nodes);
  });

  for (const node of nodes) {
    const rawType = node["@type"];
    const types = Array.isArray(rawType) ? rawType.map(String) : [String(rawType || "")];
    const isArticle = types.some((type) => /article|newsarticle|reportage/i.test(type));
    if (!isArticle) continue;

    const articleBody = normalizeWhitespace(String(node.articleBody || "")).trim();
    const headline = normalizeWhitespace(String(node.headline || "")).trim();
    const description = normalizeWhitespace(String(node.description || "")).trim();
    const image = firstString(node.image);
    const pubDate = firstString(node.datePublished);

    return {
      headline,
      description,
      articleBody,
      image,
      pubDate,
    };
  }

  return null;
}

export async function extractArticle(url: string, base: string) {
  const html = await httpGet(url);
  if (!html) return null;

  const $ = cheerio.load(html);
  const jsonLd = extractJsonLd($);

  const title =
    jsonLd?.headline ||
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    $("h1").first().text().trim();

  const description =
    jsonLd?.description ||
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="twitter:description"]').attr("content") ||
    $("meta[name='description']").attr("content") ||
    "";

  const metaImage =
    jsonLd?.image ||
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $("figure img").first().attr("src") ||
    null;

  const pubDateRaw =
    jsonLd?.pubDate ||
    $('meta[property="article:published_time"]').attr("content") ||
    $("time[datetime]").attr("datetime") ||
    null;

  const pubDate =
    pubDateRaw && !Number.isNaN(new Date(pubDateRaw).getTime())
      ? new Date(pubDateRaw).toISOString()
      : null;

  const paragraphs: string[] = [];
  const seen = new Set<string>();

  const pushParagraph = (value: string) => {
    const txt = cleanParagraph(value);
    const key = txt.toLowerCase();
    if (txt && !seen.has(key)) {
      seen.add(key);
      paragraphs.push(txt);
    }
  };

  const selectors = selectorsForUrl(url);

  for (const sel of selectors) {
    const block = $(sel);
    if (!block.length) continue;

    block
      .find("script, style, noscript, .ads, .advert, aside, nav, footer, .newsletter, .subscribe, .related-news")
      .remove();

    block.find("p, li").each((_, el) => {
      pushParagraph($(el).text());
    });

    if (paragraphs.length >= 4) break;
  }

  if (paragraphs.length < 2) {
    $("main p, article p, .main-content p, .content p, .article-content p, p").each((_, el) => {
      pushParagraph($(el).text());
    });
  }

  if (paragraphs.length < 2 && jsonLd?.articleBody) {
    jsonLd.articleBody
      .split(/\n+/)
      .map((part) => part.trim())
      .forEach((part) => pushParagraph(part));
  }

  let fullText = normalizeWhitespace(paragraphs.join(" "));

  if (fullText.length < 120) {
    const fallbackText = normalizeWhitespace(
      [description, jsonLd?.articleBody || ""].filter(Boolean).join(" ")
    );
    if (fallbackText.length >= 80) {
      fullText = fallbackText;
    }
  }

  if (fullText.length < 80) return null;

  return {
    title,
    description,
    image: metaImage ? absoluteUrl(metaImage, base) : null,
    pubDate,
    fullText,
  };
}
