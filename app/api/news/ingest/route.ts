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

async function getRssImages(rssUrl: string) {
  try {
    const xml = await httpGet(rssUrl);
    if (!xml) return {};

    const cheerio = await import("cheerio");
    const $ = cheerio.load(xml, { xmlMode: true });

    const map: Record<string, string> = {};

    $("item").each((_, item) => {
      const link = $(item).find("link").first().text().trim();
      const enclosure = $(item).find("enclosure").attr("url");
      const media = $(item).find("media\\:content").attr("url");
      const img = media || enclosure;
      if (link && img) map[cleanUrl(link)] = img;
    });

    return map;
  } catch {
    return {};
  }
}

function findClosestRssImage(articleUrl: string, rssMap: Record<string, string>) {
  const a = cleanUrl(articleUrl).toLowerCase();
  if (rssMap[a]) return rssMap[a];

  for (const key in rssMap) {
    const k = cleanUrl(key).toLowerCase();
    if (a.includes(k) || k.includes(a)) return rssMap[key];
  }

  const endA = a.split("/").pop();
  for (const key in rssMap) {
    const endK = cleanUrl(key).toLowerCase().split("/").pop();
    if (endA && endK && endA === endK) return rssMap[key];
  }

  return null;
}

async function getHomepageLinks(base: string): Promise<string[]> {
  const html = await httpGet(base);
  if (!html) return [];

  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);

  const links = new Set<string>();

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
      links.add(abs);
    }
  });

  return [...links].slice(0, 10);
}

export async function POST(req: Request) {
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let diagnostics: any[] = [];

  for (const site of SITES) {
    try {
      logSiteStep(site.source, "FETCHING RSS IMAGES");
      const rssImages = site.rss ? await getRssImages(site.rss) : {};

      logSiteStep(site.source, "FETCHING HOMEPAGE");
      const links = await getHomepageLinks(site.base);
      diagnostics.push({ site: site.source, found: links.length });

      for (const url of links) {
        const cleanedUrl = cleanUrl(url);

        if (await isDuplicateUrl(cleanedUrl)) continue;

        logSiteStep(site.source, "TRY ARTICLE", cleanedUrl);

        const extracted = await extractArticle(cleanedUrl, site.base);
        if (!extracted || !extracted.fullText) continue;

        if (await isDuplicateTitle(extracted.title)) continue;

        const summary = await summarizeNews(extracted.fullText);

        const rawCategory = await classifyNews(
          extracted.fullText || extracted.title
        );

        const category = mapToAllowedCategory(rawCategory);

        const headlineObj = await generateHeadline(
          extracted.title + "\n\n" + summary
        );

        const finalImage =
          findClosestRssImage(cleanedUrl, rssImages) ||
          extracted.image ||
          null;

        const categoriesArr: string[] = ["Top Stories", category];

        if (category === "Business") categoriesArr.push("Finance");

        const positivePattern =
          /\b(win|wins|won|award|awarded|success|successful|benefit|improvement|improved|record high|record low|positive|growth|gains|reduced|saved|cut)\b/i;
        if (positivePattern.test(extracted.fullText)) {
          categoriesArr.push("Good News");
        }

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

        const { error } = await supabaseBrowser
          .from("news_articles")
          .insert(payload);

        if (!error) {
          logSiteStep(site.source, "INSERTED", cleanedUrl);
          return NextResponse.json(
            {
              ok: true,
              inserted: payload,
              diagnostics,
              message: "Inserted ONE article and stopped",
            },
            { status: 200 }
          );
        }

        logError(site.source, "DB INSERT FAILED", error);
      }
    } catch (err) {
      logError(site.source, "SITE FAILED", err);
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
