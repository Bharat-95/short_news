// lib/fetchers.ts
import axios from "axios";
import * as cheerio from "cheerio";

export interface RawArticle {
  originalTitle: string;
  title: string;
  description: string;
  link: string;
  image?: string | null;
  source: string;
  category: string;
  pubDate?: string | null;
  fullText?: string | null;
}

const REQUEST_TIMEOUT = 10000;
const USER_AGENT = "Mozilla/5.0 (compatible; NewsFetcher/1.0; +https://example.com)";

async function httpGet(url: string) {
  try {
    const res = await axios.get(url, {
      timeout: REQUEST_TIMEOUT,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      maxBodyLength: 10 * 1024 * 1024,
    });
    return res.data as string;
  } catch (e) {
    
    console.error("httpGet failed for",  e);
    return null;
  }
}

function makeAbsolute(href: string, base: string) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function takeFirstNonEmpty(...vals: Array<string | null | undefined>) {
  for (const v of vals) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function trimToWords(text: string, maxWords: number) {
  if (!text) return "";
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ") + "...";
}

async function extractArticlePage(url: string, base: string) {
  const html = await httpGet(url);
  if (!html) return null;
  const $ = cheerio.load(html);

  const metaTitle = takeFirstNonEmpty(
    $('meta[property="og:title"]').attr("content"),
    $('meta[name="twitter:title"]').attr("content"),
    $("title").first().text()
  );

  const metaDesc = takeFirstNonEmpty(
    $('meta[property="og:description"]').attr("content"),
    $('meta[name="description"]').attr("content"),
    $("meta[name='twitter:description']").attr("content"),
    ""
  );

  const metaImage = takeFirstNonEmpty(
    $('meta[property="og:image"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
    $("figure img").first().attr("src"),
    $("img").first().attr("src"),
    null
  );

  const timeMeta = takeFirstNonEmpty(
    $('meta[property="article:published_time"]').attr("content"),
    $('meta[name="pubdate"]').attr("content"),
    $('time[datetime]').attr("datetime"),
    $("time").first().text()
  );

  const articleSelectors = [
    "article",
    ".article",
    ".post",
    ".post-content",
    ".entry-content",
    ".news-content",
    ".story-content",
    "#content",
    ".node__content", // Drupal common
    ".field--name-body",
  ];

  const paragraphs: string[] = [];
  for (const sel of articleSelectors) {
    const el = $(sel);
    if (el.length) {
      el.find("script, style, .advert, .ads, .share, noscript").remove();
      el.find("p").each((_, p) => {
        const t = $(p).text().trim();
        if (t.length > 20) paragraphs.push(t);
      });
      if (paragraphs.length > 0) break;
    }
  }

  if (paragraphs.length === 0) {
    $("p").each((_, p) => {
      const t = $(p).text().trim();
      if (t.length > 30) paragraphs.push(t);
    });
  }

  const fullText = paragraphs.join("\n\n").trim() || metaDesc || "";

  const imageUrl = metaImage ? makeAbsolute(metaImage, base) : null;
  const title = metaTitle || $("h1").first().text().trim() || $("h2").first().text().trim() || "";

  return {
    title,
    description: metaDesc || paragraphs.slice(0, 2).join(" "),
    image: imageUrl,
    pubDate: timeMeta ? new Date(timeMeta).toISOString() : null,
    fullText,
  };
}

async function scrapeHomepageForLinks(baseUrl: string) {
  const html = await httpGet(baseUrl);
  if (!html) return [];
  const $ = cheerio.load(html);

  const links = new Set<string>();

  const anchors = $("a").slice(0, 1000);
  anchors.each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href) return;
    const abs = makeAbsolute(href, baseUrl);
    try {
      const u = new URL(abs);
      // Accept same host (irrespective of http/https) or same origin
      const sameHost = u.hostname === new URL(baseUrl).hostname;
      if (!sameHost) return;
      // Normalize by removing hash/query
      const clean = abs.split("#")[0].split("?")[0];
      // Heuristics for article paths
      if (
        /\/\d{4}\/\d{2}\/\d{2}\/|\/\d{4}\/|\/news\/|\/article\/|\/story\/|\/post\/|\/actualites\/|\/node\/\d+|\/article\/\d+/i.test(
          clean
        ) ||
        /-[0-9]{4,}/i.test(clean) ||
        /\/[a-z0-9-]+-\d+\.html$/i.test(clean)
      ) {
        links.add(clean);
      }
    } catch {
      return;
    }
  });

  // Fallback: also add top listing blocks if none found
  if (links.size === 0) {
    const selectors = [".top-news a", ".headline a", ".article-list a", ".news-list a", ".lead a", "a[href*='/news/']"];
    for (const sel of selectors) {
      const els = $(sel).slice(0, 100);
      els.each((_, el) => {
        const href = $(el).attr("href") || "";
        if (!href) return;
        const abs = makeAbsolute(href, baseUrl).split("#")[0].split("?")[0];
        try {
          const u = new URL(abs);
          if (u.hostname !== new URL(baseUrl).hostname) return;
        } catch {}
        links.add(abs);
      });
      if (links.size > 0) break;
    }
  }

  return Array.from(links).slice(0, 60);
}

export async function fetchAndScrapeSites(
  sites: { source: string; base: string }[],
  limit = 20,
  summarizer?: (text: string) => Promise<string>
): Promise<RawArticle[]> {
  const out: RawArticle[] = [];

  for (const s of sites) {
    try {
      const normalized = s.base.startsWith("http") ? s.base.replace(/\/+$/, "") : `https://${s.base.replace(/\/+$/, "")}`;
      const links = await scrapeHomepageForLinks(normalized);
      for (const link of links) {
        if (out.length >= limit) break;
        try {
          const page = await extractArticlePage(link, normalized);
          if (!page || !page.fullText) continue;
          const source = s.source;
          const originalTitle = page.title || "";
          let shortSummary = "";
          if (summarizer) {
            try {
              const sum = await summarizer(page.fullText);
              shortSummary = trimToWords(sum, 60);
            } catch {
              shortSummary = trimToWords(page.fullText, 60);
            }
          } else {
            shortSummary = trimToWords(page.fullText, 60);
          }
          const rewrittenTitle = trimToWords(page.title || page.description || originalTitle, 10);
          out.push({
            originalTitle,
            title: rewrittenTitle,
            description: shortSummary,
            link,
            image: page.image ?? null,
            source,
            category: "News",
            pubDate: page.pubDate ?? null,
            fullText: page.fullText,
          });
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
    if (out.length >= limit) break;
  }

  return out.slice(0, limit);
}
