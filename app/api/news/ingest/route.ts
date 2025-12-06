import { NextResponse } from "next/server";
import { httpGet } from "@/lib/utils/http";
import { absoluteUrl, cleanUrl } from "@/lib/utils/url";
import { logError, logSiteStep } from "@/lib/utils/logging";
import { extractArticle } from "@/lib/extractors/articleExtractor";
import { summarizeNews } from "@/lib/services/summarizer";
import { classifyNews } from "@/lib/services/classifier";
import { supabaseBrowser } from "@/lib/db";

const SITES = [
  {
    source: "Defi Media Group",
    base: "https://defimedia.info",
    rss: "https://defimedia.info/rss.xml"
  },
  {
    source: "Mauritius Broadcasting",
    base: "https://mbc.intnet.mu",
    rss: "https://mbc.intnet.mu/feed/"
  },
  {
    source: "Le Mauricien",
    base: "https://lemauricien.com",
    rss: "https://www.lemauricien.com/feed/"
  },
  {
    source: "Inside News",
    base: "https://www.insideedition.com/",
    rss: "https://www.insideedition.com/rss"
  },
  {
    source: "NewsMoris",
    base: "https://newsmoris.com",
    rss: "https://newsmoris.com/feed/"
  }
];

async function getRssImages(rssUrl: string) {
  try {
    const xml = await httpGet(rssUrl);
    if (!xml) return {};

    const cheerio = await import("cheerio");
    const $ = cheerio.load(xml, { xmlMode: true });

    const map: Record<string, string> = {};

    $("item").each((_, item) => {
      const link = $(item).find("link").first().text().trim();
      const media = $(item).find("media\\:content").attr("url");
      const enclosure = $(item).find("enclosure").attr("url");
      const img = media || enclosure;
      if (link && img) map[cleanUrl(link)] = img;
    });

    return map;
  } catch {
    return {};
  }
}

function findClosestRssImage(articleUrl: string, rssMap: Record<string,string>) {
  const a = cleanUrl(articleUrl).toLowerCase();
  if (rssMap[a]) return rssMap[a];

  for (const k in rssMap) {
    const key = cleanUrl(k).toLowerCase();
    if (a.includes(key) || key.includes(a)) return rssMap[k];
  }

  const endA = a.split("/").pop();
  for (const k in rssMap) {
    const endK = cleanUrl(k).toLowerCase().split("/").pop();
    if (endA === endK) return rssMap[k];
  }

  return null;
}

async function getHomepageLinks(base: string): Promise<string[]> {
  const html = await httpGet(base);
  if (!html) return [];

  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);

  const set = new Set<string>();

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let abs = absoluteUrl(href, base);
    abs = cleanUrl(abs);

    if (!abs.startsWith(base)) return;

    if (
      /\/\d{4}\/\d{2}\/\d{2}\//.test(abs) ||
      /\/news\//i.test(abs) ||
      /\/article\//i.test(abs) ||
      /-[0-9]{3,}$/.test(abs)
    ) {
      set.add(abs);
    }
  });

  return [...set].slice(0, 12);
}

export async function POST(req: Request) {
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let diagnostics = [];

  for (const site of SITES) {
    try {
      logSiteStep(site.source, "RSS IMAGES");
      const rssImages = site.rss ? await getRssImages(site.rss) : {};

      logSiteStep(site.source, "HOMEPAGE");
      const links = await getHomepageLinks(site.base);
      diagnostics.push({ site: site.source, links: links.length });

      for (const url of links) {
        const cleaned = cleanUrl(url);

        logSiteStep(site.source, "ARTICLE", cleaned);
        const extracted = await extractArticle(cleaned, site.base);
        if (!extracted || !extracted.fullText) continue;

        const summary = await summarizeNews(extracted.fullText);
        const topic = await classifyNews(extracted.fullText);

        const finalImage =
          findClosestRssImage(cleaned, rssImages) ||
          extracted.image ||
          null;

        const categories = ["Top Stories", topic];

        const payload = {
          title: extracted.title,
          summary,
          image_url: finalImage,
          source_url: cleaned,
          source: site.source,
          topics: topic,
          categories,
          headline: extracted.title,
          pub_date: extracted.pubDate ?? null
        };

        const { error } = await supabaseBrowser
          .from("news_articles")
          .insert(payload);

        if (!error) {
          return NextResponse.json(
            {
              ok: true,
              inserted: payload,
              diagnostics,
              message: "Inserted ONE article"
            },
            { status: 200 }
          );
        }
      }
    } catch (err) {
      continue;
    }
  }

  return NextResponse.json(
    { ok: false, diagnostics, message: "No new article" },
    { status: 422 }
  );
}
