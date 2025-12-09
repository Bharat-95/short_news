/* -----------------------------------------------------------
   INGEST SYSTEM (MODE A — insert ONLY the LATEST valid article)
   Clean, stable, senior-engineer grade rewrite
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
   MAURITIUS NEWS SOURCES
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
   RSS → image map
------------------------------------------------------------ */
async function getRssImages(rss: string) {
  try {
    const xml = await httpGet(rss);
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
   Best-match image resolver
------------------------------------------------------------ */
function findClosestRssImage(url: string, rssMap: Record<string, string>) {
  const key = cleanUrl(url).toLowerCase();

  // Direct match
  if (rssMap[key]) return rssMap[key];

  // Extract last slug safely
  const parts = key.split("/");
  const last = parts.pop() || ""; // ensure string

  // Compare against RSS URLs
  for (const link in rssMap) {
    const cleaned = cleanUrl(link).toLowerCase();
    if (cleaned.endsWith(last)) {
      return rssMap[link];
    }
  }

  return null;
}

/* -----------------------------------------------------------
   Homepage → article link extractor
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

    if (
      /\/\d{4}\/\d{2}\/\d{2}\//.test(abs) || // typical article path
      /\/article\//i.test(abs) ||
      /\/news\//i.test(abs) ||
      /actualite/i.test(abs) ||
      /-[0-9]{3,}$/.test(abs) // slug ending with ID
    ) {
      links.add(abs);
    }
  });

  return [...links].slice(0, 10);
}


/* -----------------------------------------------------------
   MODE A — Insert ONLY 1 latest new article
------------------------------------------------------------ */
export async function POST(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let diagnostics: any[] = [];

  for (const site of SITES) {
    try {
      /* 1 — RSS images */
      const rssImages = await getRssImages(site.rss);

      /* 2 — Collect homepage article URLs */
      const links = await getHomepageLinks(site.base);

      diagnostics.push({ site: site.source, found: links.length });

      for (const url of links) {
        const cleaned = cleanUrl(url);

        /* Skip duplicates */
        if (await isDuplicateUrl(cleaned)) continue;

        /* Extract article */
        const art = await extractArticle(cleaned, site.base);
        if (!art || !art.fullText) continue;

        /* Skip: title duplicate */
        if (await isDuplicateTitle(art.title)) continue;

        /* Auto-summary (FR/EN) */
        const summary = await summarizeNews(art.fullText);

        /* Category */
        const rawCat = await classifyNews(art.fullText || art.title);
        const category = mapToAllowedCategory(rawCat);

        /* Headline */
        const headlineObj = await generateHeadline(
          art.title + "\n\n" + summary
        );

        /* Final image decision */
        const finalImg =
          findClosestRssImage(cleaned, rssImages) ||
          art.image ||
          null;

        /* Category array */
        const categoriesArr = ["Top Stories", category];

        if (category === "Business") categoriesArr.push("Finance");
        if (/\b(win|award|success|growth|improved)\b/i.test(art.fullText))
          categoriesArr.push("Good News");

        /* Payload */
        const payload = {
          title: art.title,
          summary,
          image_url: finalImg,
          source_url: cleaned,
          source: site.source,
          topics: category,
          categories: categoriesArr,
          headline: headlineObj,
          pub_date: art.pubDate ?? null,
        };

        /* Insert ONE article and stop */
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
