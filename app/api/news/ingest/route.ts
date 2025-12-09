/* -----------------------------------------------------------
   INGEST SYSTEM — MODE A (Insert ONLY the latest valid article)
   Mauritius News — 20-Year Senior Developer Grade
------------------------------------------------------------ */

import { NextResponse } from "next/server";
import { httpGet } from "@/lib/utils/http";
import { absoluteUrl, cleanUrl } from "@/lib/utils/url";

import { extractArticle } from "@/lib/extractors/articleExtractor";
import { summarizeNews } from "@/lib/services/summarizer";
import { classifyNews } from "@/lib/services/classifier";
import { generateHeadline } from "@/lib/services/headline";

import { isDuplicateUrl, isDuplicateTitle } from "@/lib/services/dedupe";
import { mapToAllowedCategory } from "@/lib/services/categoryMap";

import { supabaseBrowser } from "@/lib/db";

/* -----------------------------------------------------------
   MAURITIUS SITE LIST
------------------------------------------------------------ */
const SITES = [
  {
    source: "Defi Media Group",
    base: "https://defimedia.info",
    rss: "https://defimedia.info/rss.xml",
  },
  {
    source: "Le Mauricien",
    base: "https://lemauricien.com",
    rss: "https://www.lemauricien.com/feed/",
  },
  {
    source: "Mauritius Broadcasting",
    base: "https://mbc.intnet.mu",
    rss: "https://mbc.intnet.mu/feed/",
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

/* -----------------------------------------------------------
   STEP 1 — Extract article URLs from RSS (MOST RELIABLE)
------------------------------------------------------------ */
async function getRssLinks(rssUrl: string): Promise<string[]> {
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

    return links.slice(0, 6); // Only newest 6
  } catch {
    return [];
  }
}

/* -----------------------------------------------------------
   STEP 2 — Fallback: Extract URLs from homepage
------------------------------------------------------------ */
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

    // Detect article-like URLs
    if (
      /\/\d{4}\/\d{2}\/\d{2}\//.test(abs) ||
      /article/i.test(abs) ||
      /news/i.test(abs) ||
      /actualite/i.test(abs) ||
      /-[0-9]{3,}$/i.test(abs)
    ) {
      links.add(abs);
    }
  });

  return [...links].slice(0, 6);
}

/* -----------------------------------------------------------
   STEP 3 — Hybrid: Use RSS first, fallback to homepage
------------------------------------------------------------ */
async function getCandidateLinks(site: { base: string; rss: string }) {
  const rssLinks = await getRssLinks(site.rss);
  if (rssLinks.length > 0) return rssLinks;

  return await getHomepageLinks(site.base);
}

/* -----------------------------------------------------------
   STEP 4 — RSS image lookup
------------------------------------------------------------ */
async function getRssImages(rssUrl: string): Promise<Record<string, string>> {
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

/* -----------------------------------------------------------
   STEP 5 — Best-match RSS image selection
------------------------------------------------------------ */
function findClosestRssImage(url: string, rssMap: Record<string, string>) {
  const key = cleanUrl(url).toLowerCase();
  if (rssMap[key]) return rssMap[key];

  const parts = key.split("/");
  const last = parts.pop() || "";

  for (const rssUrl in rssMap) {
    const cleaned = cleanUrl(rssUrl).toLowerCase();
    if (cleaned.endsWith(last)) return rssMap[rssUrl];
  }

  return null;
}

/* -----------------------------------------------------------
   MAIN INGEST HANDLER — MODE A
------------------------------------------------------------ */
export async function POST(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const diagnostics: any[] = [];

  for (const site of SITES) {
    try {
      /* A — Gather candidate URLs */
      const links = await getCandidateLinks(site);
      const rssImages = await getRssImages(site.rss);

      diagnostics.push({ site: site.source, found: links.length });

      /* B — Process newest → oldest */
      for (const url of links) {
        const cleaned = cleanUrl(url);

        // Skip duplicate URL
        if (await isDuplicateUrl(cleaned)) continue;

        // Extract article
        const art = await extractArticle(cleaned, site.base);
        if (!art || !art.fullText) continue;

        // Skip duplicate title
        if (await isDuplicateTitle(art.title)) continue;

        /* C — Summary */
        const summary = await summarizeNews(art.fullText);

        /* D — Category */
        const rawCat = await classifyNews(art.fullText || art.title);
        const category = mapToAllowedCategory(rawCat);

        /* E — Headline */
        const headlineObj = await generateHeadline(
          art.title + "\n\n" + summary
        );

        /* F — Image */
        const finalImg =
          findClosestRssImage(cleaned, rssImages) ||
          art.image ||
          null;

        /* G — Category array */
        const categoriesArr = ["Top Stories", category];

        if (category === "Business") categoriesArr.push("Finance");
        if (/\b(win|success|award|growth|improved)\b/i.test(art.fullText))
          categoriesArr.push("Good News");

        /* H — Payload */
        const payload = {
          title: art.title,
          summary,
          image_url: finalImg,
          source_url: cleaned,
          source: site.source,
          topics: category,
          categories: categoriesArr,
          headline: headlineObj,
          pub_date: art.pubDate,
        };

        /* I — Insert ONE and stop */
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
      diagnostics.push({ site: site.source, error: String(err) });
      continue;
    }
  }

  return NextResponse.json(
    {
      ok: false,
      message: "No new valid article found",
      diagnostics,
    },
    { status: 422 }
  );
}
