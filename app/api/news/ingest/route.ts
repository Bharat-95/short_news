import { NextResponse } from "next/server";
import { httpGet } from "@/lib/utils/http";
import { absoluteUrl, cleanUrl } from "@/lib/utils/url";
import { logError, logSiteStep } from "@/lib/utils/logging";
import { extractArticle } from "@/lib/extractors/articleExtractor";
import { summarizeNews } from "@/lib/services/summarizer";
import { classifyNews } from "@/lib/services/classifier";
import { generateHeadline } from "@/lib/services/headline";
import { isDuplicateTitle, isDuplicateUrl } from "@/lib/services/dedupe";
import { mapToAllowedCategory } from "@/lib/services/categoryMap";
import { supabaseBrowser } from "@/lib/db";

/* ----------------------------------------------
   NEWS SOURCES (Updated Mauritius list)
------------------------------------------------ */
const SITES = [
  {
    source: "Defi Media Group",
    base: "https://defimedia.info",
    rss: "https://defimedia.info/rss.xml",
  },
  {
    source: "Mauritius Broadcasting",
    base: "https://mbc.intnet.mu",
    rss: "https://mbc.intnet.mu/feed/",
  },
  {
    source: "Le Mauricien",
    base: "https://lemauricien.com",
    rss: "https://www.lemauricien.com/feed/",
  },
  {
    source: "Inside News",
    base: "https://inside-news.mu",
    rss: "https://inside-news.mu/feed/",
  },
  {
    source: "NewsMoris",
    base: "https://newsmoris.com",
    rss: "https://newsmoris.com/feed/",
  },
];

/* ----------------------------------------------
   RSS IMAGE FETCHER
------------------------------------------------ */
async function getRssImages(rssUrl: string) {
  try {
    const xml = await httpGet(rssUrl);
    if (!xml) return {};

    const cheerio = await import("cheerio");
    const $ = cheerio.load(xml, { xmlMode: true });

    const map: Record<string, string> = {};
    $("item").each((_, item) => {
      const link = cleanUrl($(item).find("link").text().trim());
      const enclosure = $(item).find("enclosure").attr("url");
      const media = $(item).find("media\\:content").attr("url");
      const img = media || enclosure;
      if (link && img) map[link] = img;
    });

    return map;
  } catch {
    return {};
  }
}

/* ----------------------------------------------
   MATCH ARTICLE → RSS IMAGE
------------------------------------------------ */
function findClosestRssImage(url: string, rssMap: Record<string, string>) {
  const cleaned = cleanUrl(url).toLowerCase();
  if (rssMap[cleaned]) return rssMap[cleaned];

  for (const key in rssMap) {
    const k = cleanUrl(key).toLowerCase();
    if (cleaned.includes(k) || k.includes(cleaned)) return rssMap[key];
  }

  const end = cleaned.split("/").pop();
  for (const key in rssMap) {
    const endK = cleanUrl(key).toLowerCase().split("/").pop();
    if (end === endK) return rssMap[key];
  }

  return null;
}

/* ----------------------------------------------
   HOMEPAGE SCRAPER (real articles only)
------------------------------------------------ */
async function getHomepageLinks(base: string): Promise<string[]> {
  const html = await httpGet(base);
  if (!html) return [];

  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);

  const links = new Set<string>();

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let abs = cleanUrl(absoluteUrl(href, base));
    if (!abs.startsWith(base)) return;

    // Accept real articles, avoid listing pages
    if (
      /\/\d{4}\/\d{2}\/\d{2}\//.test(abs) ||
      /\/actualites\//i.test(abs) ||
      /\/news\//i.test(abs) ||
      /\/article\//i.test(abs) ||
      /-[0-9]{3,}$/i.test(abs)
    ) {
      links.add(abs);
    }
  });

  return [...links].slice(0, 15);
}

/* ----------------------------------------------
   MAIN INGEST — MODE B (Insert ALL new articles)
------------------------------------------------ */
export async function POST(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let inserted: any[] = [];
  let diagnostics: any[] = [];

  for (const site of SITES) {
    try {
      /* 1) Get RSS images */
      const rssImages = await getRssImages(site.rss);

      /* 2) Fetch homepage links */
      const links = await getHomepageLinks(site.base);
      diagnostics.push({ site: site.source, found: links.length });

      for (const link of links) {
        const cleaned = cleanUrl(link);

        if (await isDuplicateUrl(cleaned)) continue;

        const extracted = await extractArticle(cleaned, site.base);
        if (!extracted || !extracted.fullText) continue;

        if (await isDuplicateTitle(extracted.title)) continue;

        /* SUMMARY */
        const summary = await summarizeNews(extracted.fullText);

        /* CATEGORY */
        const rawCat = await classifyNews(
          extracted.fullText || extracted.title
        );
        const category = mapToAllowedCategory(rawCat);

        /* HEADLINE */
        const headlineObj = await generateHeadline(
          extracted.title + "\n\n" + summary
        );

        /* IMAGE SELECTION */
        const finalImg =
          findClosestRssImage(cleaned, rssImages) ||
          extracted.image ||
          null;

        /* CATEGORY ARRAY */
        const categoriesArr: string[] = ["Top Stories", category];
        if (category === "Business") categoriesArr.push("Finance");
        if (/\b(win|award|success|growth|improved)\b/i.test(extracted.fullText)) {
          categoriesArr.push("Good News");
        }

        /* FINAL PAYLOAD */
        const payload = {
          title: extracted.title,
          summary,
          image_url: finalImg,
          source_url: cleaned,
          source: site.source,
          topics: category,
          categories: categoriesArr,
          headline: headlineObj,
          pub_date: extracted.pubDate ?? null,
        };

        const { error } = await supabaseBrowser
          .from("news_articles")
          .insert(payload);

        if (!error) {
          inserted.push(payload);
        }
      }
    } catch (err) {
      logError(site.source, "SITE FAILED", err);
      continue;
    }
  }

  if (inserted.length > 0) {
    return NextResponse.json(
      {
        ok: true,
        count: inserted.length,
        inserted,
        diagnostics,
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      message: "No new article found in any site",
      diagnostics,
    },
    { status: 422 }
  );
}
