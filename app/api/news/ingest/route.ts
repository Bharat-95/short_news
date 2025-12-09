import { NextResponse } from "next/server";
import { httpGet } from "@/lib/utils/http";
import { absoluteUrl, cleanUrl } from "@/lib/utils/url";
import { extractArticle } from "@/lib/extractors/articleExtractor";
import { summarizeNews } from "@/lib/services/summarizer";
import { classifyNews } from "@/lib/services/classifier";
import { generateHeadline } from "@/lib/services/headline";
import { isDuplicateTitle, isDuplicateUrl } from "@/lib/services/dedupe";
import { mapToAllowedCategory } from "@/lib/services/categoryMap";
import { supabaseBrowser } from "@/lib/db";

/* ----------------------------------------------------------
   MAURITIUS NEWS SOURCES
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
   GET RSS IMAGES FOR ACCURATE THUMBNAILS
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
   MATCH ARTICLES TO RSS IMAGES
------------------------------------------------------------- */
function findClosestRssImage(url: string, rssMap: Record<string, string>) {
  const cleaned = cleanUrl(url).toLowerCase();
  if (rssMap[cleaned]) return rssMap[cleaned];

  for (const key in rssMap) {
    const k = cleanUrl(key).toLowerCase();
    if (cleaned.includes(k) || k.includes(cleaned)) return rssMap[key];
  }

  // match slug
  const slug = cleaned.split("/").pop();
  for (const key in rssMap) {
    const slugK = cleanUrl(key).toLowerCase().split("/").pop();
    if (slug === slugK) return rssMap[key];
  }

  return null;
}

/* ----------------------------------------------------------
   SCRAPE HOMEPAGE → GET REAL ARTICLE LINKS ONLY
------------------------------------------------------------- */
async function getHomepageLinks(base: string): Promise<string[]> {
  const html = await httpGet(base);
  if (!html) return [];

  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;

    let abs = cleanUrl(absoluteUrl(href, base));
    if (!abs.startsWith(base)) return;

    // Accept only real articles
    if (
      /\/\d{4}\/\d{2}\/\d{2}\//.test(abs) ||   // dated articles
      /\/actualites\//i.test(abs) ||
      /\/news\//i.test(abs) ||
      /\/article\//i.test(abs) ||
      /-[0-9]{4,}$/i.test(abs)
    ) {
      links.add(abs);
    }
  });

  return [...links].slice(0, 12);
}

/* ----------------------------------------------------------
   MAIN INGEST HANDLER — MODE A (LATEST ONLY)
------------------------------------------------------------- */
export async function POST(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let diagnostics = [];
  
  for (const site of SITES) {
    try {
      const rssImages = await getRssImages(site.rss);
      const links = await getHomepageLinks(site.base);

      diagnostics.push({ site: site.source, found: links.length });

      for (const link of links) {
        const cleaned = cleanUrl(link);

        // URL DEDUPE
        if (await isDuplicateUrl(cleaned)) continue;

        const extracted = await extractArticle(cleaned, site.base);
        if (!extracted || !extracted.fullText) continue;

        // TITLE DEDUPE
        if (await isDuplicateTitle(extracted.title)) continue;

        // SUMMARY
        const summary = await summarizeNews(extracted.fullText);

        // CATEGORY
        const rawCat = await classifyNews(extracted.fullText);
        const category = mapToAllowedCategory(rawCat);

        // HEADLINE
        const headlineObj = await generateHeadline(
          extracted.title + "\n\n" + summary
        );

        // IMAGE
        const finalImg =
          findClosestRssImage(cleaned, rssImages) ||
          extracted.image ||
          null;

        // CATEGORY ARRAY
        const categoriesArr = ["Top Stories", category];
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
              message: "Inserted 1 latest article (Mode A)",
            },
            { status: 200 }
          );
        }
      }
    } catch (err) {
      diagnostics.push({ site: site.source, error: err });
      continue;
    }
  }

  return NextResponse.json(
    {
      ok: false,
      message: "No new article found",
      diagnostics,
    },
    { status: 422 }
  );
}
