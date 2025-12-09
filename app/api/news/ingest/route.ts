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
   NEWS SOURCES (MAURITIUS ONLY)
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

/* ----------------------------------------------------------
   BLOCK CATEGORY/LISTING PAGES
------------------------------------------------------------- */
function isListingOrCategory(url: string): boolean {
  return (
    /\/categorie\//i.test(url) ||
    /\/category\//i.test(url) ||
    /\/categories\//i.test(url) ||
    /\/tag\//i.test(url) ||
    /\/tags\//i.test(url) ||
    /\/author\//i.test(url) ||
    /\/section\//i.test(url) ||
    /\/topics\//i.test(url) ||
    /\/news\/category\//i.test(url) ||
    /\/news\/tags\//i.test(url)
  );
}

/* ----------------------------------------------------------
   RSS IMAGE FETCHER
------------------------------------------------------------- */
async function getRssImages(rssUrl: string) {
  try {
    const xml = await httpGet(rssUrl);
    if (!xml) return {};

    const cheerio = await import("cheerio");
    const $ = cheerio.load(xml, { xmlMode: true });

    const map: Record<string, string> = {};

    $("item").each((_, item) => {
      const link = cleanUrl($(item).find("link").text().trim());
      const media = $(item).find("media\\:content").attr("url");
      const enclosure = $(item).find("enclosure").attr("url");
      const img = media || enclosure;
      if (link && img) map[link] = img;
    });

    return map;
  } catch {
    return {};
  }
}

/* ----------------------------------------------------------
   MATCH ARTICLE → RSS IMAGE
------------------------------------------------------------- */
function findClosestRssImage(url: string, rssMap: Record<string, string>) {
  const cleaned = cleanUrl(url).toLowerCase();
  if (rssMap[cleaned]) return rssMap[cleaned];

  // fuzzy
  for (const key in rssMap) {
    const k = cleanUrl(key).toLowerCase();
    if (cleaned.includes(k) || k.includes(cleaned)) return rssMap[key];
  }

  // slug match
  const end = cleaned.split("/").pop();
  for (const key in rssMap) {
    const endK = cleanUrl(key).toLowerCase().split("/").pop();
    if (end === endK) return rssMap[key];
  }

  return null;
}

/* ----------------------------------------------------------
   HOMEPAGE SCRAPER — RETURNS UP TO 12 TRUE ARTICLE LINKS
------------------------------------------------------------- */
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

    if (isListingOrCategory(abs)) return;

    // Defimedia: slug ending
    if (/defimedia\.info\/[a-z0-9-]+$/i.test(abs)) links.add(abs);

    // Le Mauricien: dated
    if (/lemauricien\.com\/\d{4}\/\d{2}\/\d{2}\//i.test(abs)) links.add(abs);

    // NewsMoris
    if (/newsmoris\.com\/\d{4}\//i.test(abs)) links.add(abs);

    // Inside News: slug
    if (/inside-news\.mu\/[a-z0-9-]+$/i.test(abs)) links.add(abs);
  });

  return [...links].slice(0, 12);
}

/* ----------------------------------------------------------
   MAIN ENDPOINT
------------------------------------------------------------- */
export async function POST(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let diagnostics: any[] = [];

  for (const site of SITES) {
    try {
      logSiteStep(site.source, "FETCH RSS");
      const rssImages = await getRssImages(site.rss);

      logSiteStep(site.source, "FETCH HOMEPAGE");
      const links = await getHomepageLinks(site.base);

      diagnostics.push({ site: site.source, found: links.length });

      for (const link of links) {
        const clean = cleanUrl(link);

        if (await isDuplicateUrl(clean)) continue;

        logSiteStep(site.source, "TRY ARTICLE", clean);

        const extracted = await extractArticle(clean, site.base);
        if (!extracted || !extracted.fullText) continue;

        if (await isDuplicateTitle(extracted.title)) continue;

        const summary = await summarizeNews(extracted.fullText);
        const rawCat = await classifyNews(extracted.fullText);
        const category = mapToAllowedCategory(rawCat);

        const headlineObj = await generateHeadline(
          extracted.title + "\n\n" + summary
        );

        const finalImage =
          findClosestRssImage(clean, rssImages) || extracted.image || null;

        const categoriesArr = ["Top Stories", category];
        if (category === "Business") categoriesArr.push("Finance");
        if (/\b(win|award|success|growth|improved)\b/i.test(extracted.fullText))
          categoriesArr.push("Good News");

        const payload = {
          title: extracted.title,
          summary,
          image_url: finalImage,
          source_url: clean,
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
          return NextResponse.json(
            {
              ok: true,
              inserted: payload,
              site: site.source,
              diagnostics,
              message: "Inserted ONE article",
            },
            { status: 200 }
          );
        }
      }
    } catch (err) {
      logError(site.source, "SITE FAILED", err);
      continue;
    }
  }

  return NextResponse.json(
    { ok: false, message: "No new article found", diagnostics },
    { status: 422 }
  );
}
