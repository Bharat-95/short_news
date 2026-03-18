/* -----------------------------------------------------------
   INGEST SYSTEM — MODE A
   Mauritius remains unchanged in `news_articles`
   UAE goes to `uae_news`
   India goes to `indian_news`
------------------------------------------------------------ */

import { NextResponse } from "next/server";
import { httpGet } from "@/lib/utils/http";
import { absoluteUrl, cleanUrl } from "@/lib/utils/url";

import { extractArticle } from "@/lib/extractors/articleExtractor";
import { summarizeNews } from "@/lib/services/summarizer";
import { classifyNews } from "@/lib/services/classifier";
import { generateHeadline } from "@/lib/services/headline";
import { generateBottomLine } from "@/lib/services/bottomLine";

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
      { source: "NewsMoris", base: "https://newsmoris.com", rss: "https://newsmoris.com/feed/" },
      //{ source: "Mauritius Broadcasting", base: "https://mbcradio.tv", rss: "https://mbcradio.tv/news/feed" },
      { source: "Defi Media Group", base: "https://defimedia.info", rss: "https://defimedia.info/rss.xml" },
      { source: "Le Mauricien", base: "https://lemauricien.com", rss: "https://www.lemauricien.com/feed/" },
    ],
  },
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
  if (["Business", "Economy"].includes(category)) return true;

  const combined = `${title} ${text}`.toLowerCase();
  const financeKeywords = [
    "finance",
    "financing",
    "economy",
    "economic",
    "economics",
    "business",
    "market",
    "markets",
    "stock",
    "stocks",
    "share",
    "shares",
    "investor",
    "investors",
    "investment",
    "investments",
    "trade",
    "trading",
    "bank",
    "banking",
    "loan",
    "loans",
    "credit",
    "inflation",
    "revenue",
    "profit",
    "profits",
    "loss",
    "losses",
    "gdp",
    "startup",
    "start-up",
    "funding",
    "fund",
    "funds",
    "oil price",
    "energy prices",
    "currency",
    "rupee",
    "dollar",
    "dirham",
    "fiscal",
    "monetary",
    "tariff",
    "tax",
    "taxes",
  ];

  return financeKeywords.some((keyword) => combined.includes(keyword));
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
    const xml = await httpGet(rssUrl);
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
  const html = await httpGet(base);
  if (!html) return [];

  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);

  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const abs = cleanUrl(absoluteUrl(href, base));
    if (!abs.startsWith(base)) return;

    if (
      /\/\d{4}\/\d{2}\/\d{2}\//.test(abs) ||
      /article|news|actualite|india|uae|nation|business|world|story|stories|middle-east/i.test(abs) ||
      /-[0-9]{3,}$/i.test(abs)
    ) {
      links.add(abs);
    }
  });

  return [...links].slice(0, 6);
}

async function getCandidateLinks(site: NewsSourceConfig) {
  const rssLinks = await getRssLinks(site.rss);
  if (rssLinks.length > 0) return rssLinks;
  return await getHomepageLinks(site.base);
}

async function getRssImages(rssUrl: string): Promise<Record<string, string>> {
  if (!rssUrl) return {};
  try {
    const xml = await httpGet(rssUrl);
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

  for (const site of config.sources) {
    try {
      const links = await getCandidateLinks(site);
      const rssImages = await getRssImages(site.rss);
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

        const art = await extractArticle(cleaned, site.base);
        if (!art || !art.fullText || !isValidArticle(cleaned, art)) {
          siteStats.extractFailed += 1;
          continue;
        }

        if (await isDuplicateTitle(art.title, config.table)) {
          siteStats.duplicateTitle += 1;
          continue;
        }

        const summary = await summarizeNews(art.fullText);
        const category = await classifyNews(art.fullText || art.title);
        const headlineObj = await generateHeadline(`${art.title}\n\n${summary}`);
        const bottomLine = await generateBottomLine(`${art.title}\n\n${summary}`);

        const finalImg =
          findClosestRssImage(cleaned, rssImages) ||
          art.image ||
          null;

        const categoriesArr: string[] = ["Top Stories"];

        if (shouldAddFinanceCategory(art.title, art.fullText, category)) {
          categoriesArr.push("Finance");
        }

        const goodNewsPattern =
          /\b(win|success|award|growth|profit|improved|record|milestone|boost|increase)\b/i;

        if (goodNewsPattern.test(art.fullText)) {
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
    } catch (err) {
      diagnostics.push({ site: site.source, error: String(err) });
    }
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
