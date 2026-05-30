// lib/news/fetcher.ts
import axios from "axios";
import * as cheerio from "cheerio";

export interface ExtractedArticle {
  title: string;
  description: string;
  link: string;
  image: string | null;
  pubDate: string | null;
  fullText: string;
  source: string;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; MauritiusNewsBot/1.0; +https://example.com)";

async function httpGet(url: string, timeout = 9000) {
  try {
    const res = await axios.get(url, {
      timeout,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" }
    });
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  } catch {
    return null;
  }
}

function absUrl(href: string | undefined, base: string) {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function strip(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

//
// Parse one article page — strong extractor for French news sites
//
export async function extractArticle(url: string, source: string) {
  const html = await httpGet(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  const metaTitle =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text() ||
    $("title").text() ||
    "";

  const metaDesc =
    $('meta[property="og:description"]').attr("content") ||
    $("meta[name=description]").attr("content") ||
    "";

  const metaImg =
    $('meta[property="og:image"]').attr("content") ||
    $("figure img").first().attr("src") ||
    $("img").first().attr("src") ||
    null;

  const paragraphs: string[] = [];
  $("article p, .post p, .entry-content p, .news-content p").each((_, el) => {
    const t = strip($(el).text());
    if (t.length > 20) paragraphs.push(t);
  });

  if (paragraphs.length < 3) {
    $("p").each((_, p) => {
      const t = strip($(p).text());
      if (t.length > 25) paragraphs.push(t);
    });
  }

  const fullText =
    paragraphs.join("\n\n").trim() || metaDesc || metaTitle || "";

  return {
    title: strip(metaTitle),
    description: strip(metaDesc),
    link: url,
    image: metaImg ? absUrl(metaImg, url) : null,
    pubDate: null,
    fullText,
    source
  } as ExtractedArticle;
}
