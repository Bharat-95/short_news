import { NextResponse } from "next/server";
import { httpGet } from "@/lib/utils/http";
import { absoluteUrl, cleanUrl } from "@/lib/utils/url";
import { extractArticle } from "@/lib/extractors/articleExtractor";
import { summarizeNews } from "@/lib/services/summarizer";
import { classifyNews } from "@/lib/services/classifier";
import { generateHeadline } from "@/lib/services/headline";
import { mapToAllowedCategory } from "@/lib/services/categoryMap";
import { isDuplicateUrl, isDuplicateTitle } from "@/lib/services/dedupe";
import { supabaseBrowser } from "@/lib/db";
import * as cheerio from "cheerio";

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

async function getRssMap(rssUrl: string) {
  try {
    const xml = await httpGet(rssUrl);
    if (!xml) return {};
    const $ = cheerio.load(xml, { xmlMode: true });
    const out: Record<string, string> = {};
    $("item").each((_, el) => {
      const link = $(el).find("link").first().text().trim();
      const enclosure = $(el).find("enclosure").attr("url");
      const media = $(el).find("media\\:content").attr("url");
      const img = media || enclosure;
      if (link && img) out[cleanUrl(link)] = img;
    });
    return out;
  } catch {
    return {};
  }
}

function findImage(url: string, map: Record<string, string>) {
  if (map[cleanUrl(url)]) return map[cleanUrl(url)];
  const last = cleanUrl(url).split("/").pop();
  for (const key in map) {
    const keyLast = cleanUrl(key).split("/").pop();
    if (keyLast === last) return map[key];
  }
  return null;
}

async function getHomepageLinks(base: string) {
  const html = await httpGet(base);
  if (!html) return [];
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

  for (const site of SITES) {
    try {
      const rssImages = site.rss ? await getRssMap(site.rss) : {};
      const links = await getHomepageLinks(site.base);

      for (const url of links) {
        const cleaned = cleanUrl(url);
        if (await isDuplicateUrl(cleaned)) continue;

        const extracted = await extractArticle(cleaned, site.base);
        if (!extracted || !extracted.fullText) continue;

        if (await isDuplicateTitle(extracted.title)) continue;

        const summary = await summarizeNews(extracted.fullText);

        const rawCat = await classifyNews(
          extracted.fullText || extracted.title
        );

        const category = mapToAllowedCategory(rawCat);

        const headline = await generateHeadline(
          extracted.title + "\n\n" + summary
        );

        const img =
          findImage(cleaned, rssImages) ||
          extracted.image ||
          null;

        const categoriesArr = [category];

        const isBreaking =
          extracted.title.toLowerCase().includes("breaking") ||
          summary.toLowerCase().includes("breaking") ||
          extracted.fullText.slice(0, 180).toLowerCase().includes("breaking");

        if (isBreaking) categoriesArr.push("Top News");

        if (category === "Business") categoriesArr.push("Finance");

        const positive = /\b(win|wins|award|success|growth|improved|positive|record high)\b/i;
        if (positive.test(extracted.fullText)) categoriesArr.push("Good News");

        const payload = {
          title: extracted.title,
          summary,
          image_url: img,
          source_url: cleaned,
          source: site.source,
          topics: category,
          categories: categoriesArr,
          headline,
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
              message: "Inserted one Mauritius article",
            },
            { status: 200 }
          );
        }
      }
    } catch {}
  }

  return NextResponse.json(
    { ok: false, message: "No new article found" },
    { status: 422 }
  );
}
