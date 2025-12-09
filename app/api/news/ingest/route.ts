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

/* ----------------------------------------------------------
   MAURITIUS NEWS SOURCES — RSS FIRST
------------------------------------------------------------- */
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
    source: "NewsMoris",
    base: "https://newsmoris.com",
    rss: "https://newsmoris.com/feed/",
  },
];

/* ----------------------------------------------------------
   PARSE RSS FEED
------------------------------------------------------------- */
async function getRssItems(rssUrl: string) {
  try {
    const xml = await httpGet(rssUrl);
    if (!xml) return [];

    const cheerio = await import("cheerio");
    const $ = cheerio.load(xml, { xmlMode: true });

    const items: any[] = [];

    $("item").each((_, el) => {
      const link = cleanUrl($(el).find("link").first().text().trim());
      const title = $(el).find("title").first().text().trim();
      const desc = $(el).find("description").first().text().trim();
      const enclosure =
        $(el).find("enclosure").attr("url") ||
        $(el).find("media\\:content").attr("url") ||
        null;

      items.push({
        title,
        link,
        description: desc,
        image: enclosure,
      });
    });

    return items;
  } catch {
    return [];
  }
}

/* ----------------------------------------------------------
   FALLBACK: BASIC HOMEPAGE SCRAPER (ONLY IF RSS FAILS)
------------------------------------------------------------- */
async function getHomepageArticle(base: string): Promise<string | null> {
  const html = await httpGet(base);
  if (!html) return null;

  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);

  let found: string | null = null;

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const abs = cleanUrl(absoluteUrl(href, base));

    // Defimedia example: /article-name-slug
    if (/defimedia\.info\/[a-z0-9-]+$/i.test(abs)) {
      found = abs;
      return false;
    }

    // Le Mauricien: date-based
    if (/lemauricien\.com\/\d{4}\/\d{2}\/\d{2}\//i.test(abs)) {
      found = abs;
      return false;
    }

    // NewsMoris
    if (/newsmoris\.com\/\d{4}\//i.test(abs)) {
      found = abs;
      return false;
    }

    // Inside News example
    if (/inside-news\.mu\/[a-z0-9-]+$/i.test(abs)) {
      found = abs;
      return false;
    }
  });

  return found;
}

/* ----------------------------------------------------------
   MAIN INGEST ENDPOINT (MODE A — STOP AFTER FIRST INSERT)
------------------------------------------------------------- */
export async function POST(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let diagnostics: any[] = [];

  for (const site of SITES) {
    try {
      logSiteStep(site.source, "FETCHING RSS");

      /* ----------------------------------------------
         1) RSS → MAIN SOURCE
      ------------------------------------------------ */
      const rssItems = await getRssItems(site.rss);
      diagnostics.push({ site: site.source, rssCount: rssItems.length });

      let articleUrl: string | null = null;
      let rssMeta: any = null;

      if (rssItems.length > 0) {
        rssMeta = rssItems[0];
        articleUrl = rssMeta.link;
      }

      /* ----------------------------------------------
         2) HOMEPAGE FALLBACK ONLY IF RSS FAILS
      ------------------------------------------------ */
      if (!articleUrl) {
        logSiteStep(site.source, "FALLBACK HOMEPAGE SCRAPE");
        articleUrl = await getHomepageArticle(site.base);
      }

      if (!articleUrl) continue;
      const cleanedUrl = cleanUrl(articleUrl);

      /* ------------------------------------------------
         Skip if duplicate URL
      ------------------------------------------------ */
      if (await isDuplicateUrl(cleanedUrl)) {
        continue;
      }

      logSiteStep(site.source, "EXTRACT ARTICLE", cleanedUrl);

      /* ------------------------------------------------
         Extract article content
      ------------------------------------------------ */
      const extracted = await extractArticle(cleanedUrl, site.base);
      if (!extracted || !extracted.fullText) continue;

      /* ------------------------------------------------
         Skip duplicate title
      ------------------------------------------------ */
      if (await isDuplicateTitle(extracted.title)) {
        continue;
      }

      /* ------------------------------------------------
         Summarize & classify
      ------------------------------------------------ */
      const summary = await summarizeNews(extracted.fullText);
      const rawCat = await classifyNews(extracted.fullText);
      const category = mapToAllowedCategory(rawCat);

      const headlineObj = await generateHeadline(
        extracted.title + "\n\n" + summary
      );

      /* ------------------------------------------------
         Determine final image
      ------------------------------------------------ */
      const finalImage = rssMeta?.image || extracted.image || null;

      /* ------------------------------------------------
         Build categories array
      ------------------------------------------------ */
      const categoriesArr = ["Top News", category];

      if (category === "Business") categoriesArr.push("Finance");

      if (/\b(win|award|success|growth|improved)\b/i.test(extracted.fullText)) {
        categoriesArr.push("Good News");
      }

      /* ------------------------------------------------
         Construct payload
      ------------------------------------------------ */
      const payload = {
        title: extracted.title,
        summary,
        image_url: finalImage,
        source_url: cleanedUrl,
        source: site.source,
        topics: category,
        categories: categoriesArr,
        headline: headlineObj,
        pub_date: extracted.pubDate ?? null,
      };

      /* ------------------------------------------------
         Insert → stop after first
      ------------------------------------------------ */
      const { error } = await supabaseBrowser
        .from("news_articles")
        .insert(payload);

      if (!error) {
        return NextResponse.json(
          {
            ok: true,
            inserted: payload,
            site: site.source,
            diagnostics,
            message: "Inserted ONE article (RSS-first Mode A)",
          },
          { status: 200 }
        );
      }

      logError(site.source, "INSERT FAILED", error);
    } catch (err) {
      logError(site.source, "SITE FAILED", err);
      continue;
    }
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
