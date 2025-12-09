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
    base: "https://www.insideedition.com/",
    rss: "https://www.insideedition.com/rss",
  },
  {
    source: "NewsMoris",
    base: "https://newsmoris.com",
    rss: "https://newsmoris.com/feed/",
  },
];

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

/* ----------------------------------------------------------
   MATCH ARTICLE → RSS IMAGE
------------------------------------------------------------- */
function findClosestRssImage(url: string, rssMap: Record<string, string>) {
  const cleaned = cleanUrl(url).toLowerCase();

  if (rssMap[cleaned]) return rssMap[cleaned];

  // fuzzy match
  for (const key in rssMap) {
    const k = cleanUrl(key).toLowerCase();
    if (cleaned.includes(k) || k.includes(cleaned)) return rssMap[key];
  }

  // match last slug
  const end = cleaned.split("/").pop();
  for (const key in rssMap) {
    const endK = cleanUrl(key).toLowerCase().split("/").pop();
    if (end === endK) return rssMap[key];
  }

  return null;
}

/* ----------------------------------------------------------
   HOMEPAGE SCRAPER — returns up to 10 real article URLs
------------------------------------------------------------- */
async function getHomepageLinks(base: string): Promise<string[]> {
  const html = await httpGet(base);
  if (!html) return [];

  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);

  const links = new Set<string>();
  const patterns = [
    "/\\d{4}/\\d{2}/\\d{2}/",  // dated
    "news",
    "article",
    "actualite",
    "politique",
    "societe",
    "sport",
    "econom",   // economy
    "culture",
    "faits-divers",
    "-\\d{3,}$", // trailing ID
  ];

  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    let abs = cleanUrl(absoluteUrl(href, base));
    if (!abs.startsWith(base)) return;

    for (const p of patterns) {
      if (new RegExp(p, "i").test(abs)) {
        links.add(abs);
        break;
      }
    }
  });

  return [...links].slice(0, 12); // up to 12 links per site
}


/* ----------------------------------------------------------
   MAIN ENDPOINT
------------------------------------------------------------- */
export async function POST(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let diagnostics: any[] = [];

  // MODE A: STOP AFTER FIRST SUCCESSFUL INSERT
  for (const site of SITES) {
    try {
      logSiteStep(site.source, "FETCHING RSS IMAGES");
      const rssImages = await getRssImages(site.rss);

      logSiteStep(site.source, "FETCHING HOMEPAGE");
      const links = await getHomepageLinks(site.base);

      diagnostics.push({ site: site.source, found: links.length });

      for (const link of links) {
        const cleaned = cleanUrl(link);

        // skip if URL exists
        if (await isDuplicateUrl(cleaned)) continue;

        logSiteStep(site.source, "TRY ARTICLE", cleaned);

        const extracted = await extractArticle(cleaned, site.base);
        if (!extracted || !extracted.fullText) continue;

        // skip if title exists
        if (await isDuplicateTitle(extracted.title)) continue;

        // summarise → classify → headline
        const summary = await summarizeNews(extracted.fullText);

        const rawCat = await classifyNews(
          extracted.fullText || extracted.title
        );

        const category = mapToAllowedCategory(rawCat);

        const headlineObj = await generateHeadline(
          extracted.title + "\n\n" + summary
        );

        const finalImg =
          findClosestRssImage(cleaned, rssImages) ||
          extracted.image ||
          null;

        const categoriesArr: string[] = ["Top Stories", category];

        if (category === "Business") categoriesArr.push("Finance");

        if (/\b(win|award|success|growth|improved)\b/i.test(extracted.fullText)) {
          categoriesArr.push("Good News");
        }

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
          return NextResponse.json(
            {
              ok: true,
              inserted: payload,
              site: site.source,
              diagnostics,
              message: "Inserted ONE article and stopped (Mode A)",
            },
            { status: 200 }
          );
        }

        logError(site.source, "INSERT FAILED", error);
      }
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
