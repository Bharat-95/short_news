/* -----------------------------------------------------------
   INGEST SYSTEM — MODE A
   Mauritius remains unchanged in `news_articles`
   UAE goes to `uae_news`
   India goes to `indian_news`
------------------------------------------------------------ */

import { NextResponse } from "next/server";
import { httpGet, isHostHealthy } from "@/lib/utils/http";
import { absoluteUrl, cleanUrl } from "@/lib/utils/url";

import { extractArticle } from "@/lib/extractors/articleExtractor";
import { processArticle } from "@/lib/services/aiProcessor";

import { isDuplicateUrl, isDuplicateTitle } from "@/lib/services/dedupe";
import { supabaseBrowser } from "@/lib/db";
import type {
  FinalArticlePayload,
  NewsSourceConfig,
  NewsTable,
} from "@/lib/utils/types";

type RegionConfig = {
  region: "Mauritius" | "UAE" | "India";
  table: NewsTable;
  sources: NewsSourceConfig[];
};

type RegionResult =
  | {
      ok: true;
      region: string;
      table: NewsTable;
      inserted: FinalArticlePayload | Omit<FinalArticlePayload, "pub_date">;
      site: string;
      diagnostics: Diagnostic[];
      message: string;
    }
  | {
      ok: false;
      region: string;
      table: NewsTable;
      message: string;
      diagnostics: Diagnostic[];
    };

type Diagnostic =
  | { region: string; table: NewsTable }
  | { site: string; found: number }
  | { site: string; error: string }
  | { insertError: string; retryError: string }
  | {
      site: string;
      stats: {
        scanned: number;
        duplicateUrl: number;
        extractFailed: number;
        duplicateTitle: number;
        inserted: number;
      };
    };

const REGION_CONFIGS: RegionConfig[] = [
  {
    region: "Mauritius",
    table: "news_articles",
    sources: [
      { source: "NewsMoris", base: "https://newsmoris.com/category/news/", rss: "https://newsmoris.com/feed/" },
      //{ source: "Mauritius Broadcasting", base: "https://mbcradio.tv", rss: "https://mbcradio.tv/news/feed" },
      { source: "Defi Media Group", base: "https://defimedia.info", rss: "https://defimedia.info/rss.xml" },
      { source: "Maurice Info", base: "https://maurice-info.mu/", rss: "https://maurice-info.mu/feed" },
    ],
  },
  //Checking
  {
    region: "UAE",
    table: "uae_news",
    sources: [
      { source: "Khaleej Times", base: "https://www.khaleejtimes.com/uae", rss: "https://www.khaleejtimes.com/stories.rss" },
      //{ source: "Gulf News", base: "https://gulfnews.com/uae", rss: "https://news.google.com/rss/search?q=site:gulfnews.com&hl=en-US" },
      //{ source: "The National", base: "https://www.thenationalnews.com/uae", rss: "" },
      { source: "Emirates247", base: "https://www.emirates247.com/news", rss: "https://www.emirates247.com/rss/mobile/v2/flash-news.rss" },
    ],
  },
  {
    region: "India",
    table: "indian_news",
    sources: [
      { source: "India Today", base: "https://www.indiatoday.in/", rss: "https://www.indiatoday.in/rss/home" },
      { source: "NDTV", base: "https://www.ndtv.com/latest?pfrom=home-ndtv_mainnavigation", rss: "https://feeds.feedburner.com/ndtvnews-latest" },
      { source: "The Hindu", base: "https://www.thehindu.com", rss: "https://www.thehindu.com/news/national/feeder/default.rss" },
      { source: "Indian Express", base: "https://indianexpress.com", rss: "https://indianexpress.com/section/india/feed/" },
      
    ],
  },
];

function compactErr(msg: string): string {
  return msg.replace(/\s+/g, " ").trim().slice(0, 260);
}

function looksLikeSectionUrl(url: string) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const segments = pathname.split("/").filter(Boolean);

    if ([
      "/replay/news",
      "/uae",
      "/india",
      "/news",
      "/videos",
      "/latest-news",
      "/news/national",
    ].includes(pathname)) {
      return true;
    }

    if (pathname.includes("/video/") || pathname.includes("/videos/")) return true;
    if (/^\/india\/[a-z-]+$/.test(pathname)) return true;
    if (/^\/uae\/[a-z-]+$/.test(pathname)) return true;
    if (/^\/news\/[a-z-]+$/.test(pathname)) return true;
    if (segments.length <= 2 && !/\d{4}\/\d{2}\/\d{2}/.test(pathname) && !/article|story|news|ece|\/\d{3,}/.test(pathname)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function looksLikeSectionTitle(title: string) {
  return /top stories|latest news|news updates|updates \||\| gulf news|home page|replay|videos/i.test(title);
}

function hasLowQualityText(text: string) {
  const normalized = text.toLowerCase();
  const blockedPhrases = [
    "all rights reserved",
    "copyright",
    "powered by ict dept",
    "ask the law",
    "the view from india",
    "first day first show",
    "today's cache",
    "science for all",
    "newsletter",
    "sign up",
    "follow us on",
    "whatsapp channel",
    "recommended for you",
  ];

  if (blockedPhrases.some((phrase) => normalized.includes(phrase))) {
    return true;
  }

  const sentences = normalized
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 20);
  const uniqueSentences = new Set(sentences);

  return uniqueSentences.size < 2;
}

function shouldAddFinanceCategory(title: string, text: string, category: string) {
  const combined = `${title} ${text}`.toLowerCase();
  const negativeFinanceContext = [
    "war",
    "attack",
    "airstrike",
    "missile",
    "bomb",
    "military",
    "conflict",
    "crisis",
    "death",
    "killed",
    "injured",
    "hostage",
    "ceasefire",
    "israel",
    "iran",
    "gaza",
    "beirut",
    "hezbollah",
  ];

  if (negativeFinanceContext.some((keyword) => combined.includes(keyword))) {
    return false;
  }

  if (["Business", "Economy"].includes(category)) return true;

  const strongFinanceKeywords = [
    "stock market",
    "share market",
    "shares",
    "stocks",
    "investor",
    "investment",
    "funding",
    "startup funding",
    "banking",
    "loan",
    "credit",
    "gdp",
    "inflation",
    "fiscal",
    "monetary policy",
    "profit",
    "profits",
    "revenue",
    "earnings",
    "quarterly results",
    "ipo",
    "currency",
    "exchange rate",
    "rupee",
    "dollar",
    "dirham",
    "tax",
    "taxes",
    "tariff",
  ];

  const weakFinanceKeywords = [
    "economy",
    "economic",
    "business",
    "market",
    "markets",
    "trade",
    "trading",
    "bank",
    "fund",
  ];

  const strongMatches = strongFinanceKeywords.filter((keyword) => combined.includes(keyword)).length;
  const weakMatches = weakFinanceKeywords.filter((keyword) => combined.includes(keyword)).length;

  return strongMatches >= 1 || weakMatches >= 2;
}

function shouldAddGoodNewsCategory(title: string, text: string, category: string) {
  const combined = `${title} ${text}`.toLowerCase();
  const positiveKeywords = [
    "award",
    "awarded",
    "won",
    "win",
    "victory",
    "scholarship",
    "rescued",
    "recovery",
    "milestone",
    "record",
    "success",
    "achievement",
    "improved",
    "improvement",
    "breakthrough",
  ];

  const negativeKeywords = [
    "war",
    "killed",
    "dead",
    "death",
    "attack",
    "bomb",
    "crisis",
    "conflict",
    "accident",
    "crime",
    "arrested",
    "fraud",
    "protest",
    "injured",
    "violence",
    "outbreak",
    "fire",
    "blast",
  ];

  if (["Crime", "Accident", "Politics", "International"].includes(category)) {
    return false;
  }

  if (negativeKeywords.some((keyword) => combined.includes(keyword))) {
    return false;
  }

  return positiveKeywords.some((keyword) => combined.includes(keyword));
}

function isValidArticle(url: string, article: { title: string; fullText: string }) {
  if (!article.title.trim()) return false;
  if (looksLikeSectionUrl(url)) return false;
  if (looksLikeSectionTitle(article.title)) return false;
  if (article.fullText.trim().length < 140) return false;
  if (hasLowQualityText(article.fullText)) return false;
  return true;
}

async function getRssLinks(rssUrl: string): Promise<string[]> {
  if (!rssUrl) return [];
  try {
    const xml = await httpGet(rssUrl, { cache: true });
    if (!xml) return [];

    const cheerio = await import("cheerio");
    const $ = cheerio.load(xml, { xmlMode: true });

    const links: string[] = [];
    $("item").each((_, item) => {
      const link = cleanUrl($(item).find("link").text().trim());
      if (link) links.push(link);
    });

    return links.slice(0, 6);
  } catch {
    return [];
  }
}

async function getHomepageLinks(base: string): Promise<string[]> {
  const html = await httpGet(base, { cache: true });
  if (!html) return [];

  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);

  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const abs = cleanUrl(absoluteUrl(href, base));
    if (!abs.startsWith(base)) return;

    // Filter out section URLs and static information pages early
    if (looksLikeSectionUrl(abs)) return;

    const path = new URL(abs).pathname.toLowerCase();
    if (
      path.includes("/about") ||
      path.includes("/contact") ||
      path.includes("/privacy") ||
      path.includes("/terms") ||
      path.includes("/subscribe") ||
      path.includes("/careers")
    ) {
      return;
    }

    if (
      /\/\d{4}\/\d{2}\/\d{2}\//.test(abs) ||
      /article|news|actualite|india|uae|nation|business|world|story|stories|middle-east/i.test(abs) ||
      /-[0-9]{3,}$/i.test(abs)
    ) {
      links.add(abs);
    }
  });

  return [...links].slice(0, 10);
}

async function getCandidateLinks(site: NewsSourceConfig) {
  // Fetch both RSS and Homepage candidates in parallel to handle stale feeds
  const [rssLinks, homepageLinks] = await Promise.all([
    getRssLinks(site.rss),
    getHomepageLinks(site.base),
  ]);

  // Combine and deduplicate candidates. RSS links are prioritized at the front.
  const merged = new Set([...rssLinks, ...homepageLinks]);
  return [...merged].slice(0, 8);
}

async function getRssImages(rssUrl: string): Promise<Record<string, string>> {
  if (!rssUrl) return {};
  try {
    const xml = await httpGet(rssUrl, { cache: true });
    if (!xml) return {};

    const cheerio = await import("cheerio");
    const $ = cheerio.load(xml, { xmlMode: true });

    const map: Record<string, string> = {};

    $("item").each((_, item) => {
      const link = cleanUrl($(item).find("link").text().trim());
      const img =
        $(item).find("media\\:content").attr("url") ||
        $(item).find("enclosure").attr("url");

      if (link && img) map[link] = img;
    });

    return map;
  } catch {
    return {};
  }
}

function findClosestRssImage(url: string, rssMap: Record<string, string>) {
  const key = cleanUrl(url).toLowerCase();
  if (rssMap[key]) return rssMap[key];

  const last = key.split("/").pop() || "";
  for (const rssUrl in rssMap) {
    const cleaned = cleanUrl(rssUrl).toLowerCase();
    if (cleaned.endsWith(last)) return rssMap[rssUrl];
  }

  return null;
}

async function insertIntoTable(table: NewsTable, payload: FinalArticlePayload) {
  const { error } = await supabaseBrowser.from(table).insert(payload);

  if (!error) {
    return { ok: true as const, inserted: payload, message: "Inserted 1 latest article (Mode A)" };
  }

  const retryPayload = {
    title: payload.title,
    summary: payload.summary,
    image_url: payload.image_url,
    source_url: payload.source_url,
    source: payload.source,
    topics: payload.topics,
    categories: payload.categories,
    headline: payload.headline,
    bottom_line: payload.bottom_line,
  };

  const { error: retryErr } = await supabaseBrowser.from(table).insert(retryPayload);
  if (!retryErr) {
    return {
      ok: true as const,
      inserted: retryPayload,
      message: "Inserted 1 latest article (Fallback pub_date removed)",
    };
  }

  return {
    ok: false as const,
    insertError: compactErr(error.message),
    retryError: compactErr(retryErr.message),
  };
}

async function ingestRegion(config: RegionConfig): Promise<RegionResult> {
  const diagnostics: Diagnostic[] = [{ region: config.region, table: config.table }];

  // 1. Resolve all candidate links and RSS images in parallel for the region
  const sourceResults = await Promise.all(
    config.sources.map(async (site) => {
      try {
        if (!isHostHealthy(site.base) || (site.rss && !isHostHealthy(site.rss))) {
          return {
            site,
            ok: false as const,
            error: "Host is unhealthy (in cooldown)",
            links: [] as string[],
            rssImages: {} as Record<string, string>,
          };
        }

        const [links, rssImages] = await Promise.all([
          getCandidateLinks(site),
          getRssImages(site.rss),
        ]);

        return {
          site,
          ok: true as const,
          links,
          rssImages,
        };
      } catch (err) {
        return {
          site,
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
          links: [] as string[],
          rssImages: {} as Record<string, string>,
        };
      }
    })
  );

  // 2. Process candidate links sequentially to preserve the single-insert-exits rule
  for (const result of sourceResults) {
    const { site, ok, links, rssImages, error } = result;

    if (!ok || error) {
      diagnostics.push({ site: site.source, error: error || "unknown fetch error" });
      continue;
    }

    const siteStats = {
      scanned: 0,
      duplicateUrl: 0,
      extractFailed: 0,
      duplicateTitle: 0,
      inserted: 0,
    };

    diagnostics.push({ site: site.source, found: links.length });

    for (const url of links) {
      siteStats.scanned += 1;
      const cleaned = cleanUrl(url);

      if (await isDuplicateUrl(cleaned, config.table)) {
        siteStats.duplicateUrl += 1;
        continue;
      }

      if (!isHostHealthy(cleaned)) {
        siteStats.extractFailed += 1;
        continue;
      }

      const art = await extractArticle(cleaned, site.base);
      if (!art || !art.fullText || !isValidArticle(cleaned, art)) {
        siteStats.extractFailed += 1;
        continue;
      }

      if (await isDuplicateTitle(art.title, config.table)) {
        siteStats.duplicateTitle += 1;
        continue;
      }

      const processed = await processArticle(art.title, art.fullText);
      const { summary, category, headline: headlineObj, bottomLine } = processed;

      const finalImg =
        findClosestRssImage(cleaned, rssImages) ||
        art.image ||
        null;

      const categoriesArr: string[] = ["Top Stories"];

      if (shouldAddFinanceCategory(art.title, art.fullText, category)) {
        categoriesArr.push("Finance");
      }

      if (shouldAddGoodNewsCategory(art.title, art.fullText, category)) {
        categoriesArr.push("Good News");
      }

      const payload: FinalArticlePayload = {
        title: art.title,
        summary,
        image_url: finalImg,
        source_url: cleaned,
        source: site.source,
        topics: category,
        categories: categoriesArr,
        headline: headlineObj,
        bottom_line: bottomLine,
        pub_date: art.pubDate ?? null,
      };

      const insertResult = await insertIntoTable(config.table, payload);
      if (!insertResult.ok) {
        diagnostics.push({
          insertError: insertResult.insertError,
          retryError: insertResult.retryError,
        });
        continue;
      }

      siteStats.inserted += 1;
      diagnostics.push({ site: site.source, stats: siteStats });

      return {
        ok: true,
        region: config.region,
        table: config.table,
        inserted: insertResult.inserted,
        site: site.source,
        diagnostics,
        message: insertResult.message,
      };
    }

    diagnostics.push({ site: site.source, stats: siteStats });
  }

  return {
    ok: false,
    region: config.region,
    table: config.table,
    message: `No new valid article found for ${config.region}`,
    diagnostics,
  };
}

/* -----------------------------------------------------------
   MAIN INGEST HANDLER
------------------------------------------------------------ */
export async function POST(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestUrl = new URL(req.url);
  const dryRun = requestUrl.searchParams.get("dryRun") === "1";

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      message: "Ingest route is reachable and authorized",
      checks: {
        hasCronSecret: Boolean(process.env.CRON_SECRET),
        hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
        hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      },
    });
  }

  const results: RegionResult[] = [];

  for (const config of REGION_CONFIGS) {
    const result = await ingestRegion(config);
    results.push(result);
  }

  const insertedCount = results.filter((result) => result.ok).length;

  return NextResponse.json(
    {
      ok: insertedCount > 0,
      insertedCount,
      results,
      message:
        insertedCount > 0
          ? `Inserted ${insertedCount} latest article(s) across configured regions`
          : "No new valid article found",
    },
    { status: insertedCount > 0 ? 200 : 422 }
  );
}
