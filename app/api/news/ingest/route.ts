/* -----------------------------------------------------------
   INGEST SYSTEM — MODE A (Insert ONLY the latest valid article)
   Mauritius News — Full Senior-Engineer Implementation
------------------------------------------------------------ */

import { NextResponse } from "next/server";
import { httpGet } from "@/lib/utils/http";
import { absoluteUrl, cleanUrl } from "@/lib/utils/url";

import { extractArticle } from "@/lib/extractors/articleExtractor";
import { summarizeNews } from "@/lib/services/summarizer";
import { classifyNews } from "@/lib/services/classifier";
import { generateHeadline } from "@/lib/services/headline";

import { isDuplicateUrl, isDuplicateTitle } from "@/lib/services/dedupe";
import { supabaseBrowser } from "@/lib/db";

/* -----------------------------------------------------------
   NEWS SOURCES
------------------------------------------------------------ */
const SITES = [
    { source: "NewsMoris", base: "https://newsmoris.com", rss: "https://newsmoris.com/feed/" },
    { source: "Mauritius Broadcasting", base: "https://mbc.intnet.mu", rss: "https://mbc.intnet.mu/feed/" },
  { source: "Defi Media Group", base: "https://defimedia.info", rss: "https://defimedia.info/rss.xml" },
  { source: "Le Mauricien", base: "https://lemauricien.com", rss: "https://www.lemauricien.com/feed/" },
  

];

/* -----------------------------------------------------------
   STEP 1 — Extract article URLs from RSS
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

    return links.slice(0, 6);
  } catch {
    return [];
  }
}

/* -----------------------------------------------------------
   STEP 2 — Homepage fallback
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
   STEP 3 — Hybrid URL selection
------------------------------------------------------------ */
async function getCandidateLinks(site: { base: string; rss: string }) {
  const rssLinks = await getRssLinks(site.rss);
  if (rssLinks.length > 0) return rssLinks;
  return await getHomepageLinks(site.base);
}

/* -----------------------------------------------------------
   STEP 4 — RSS images
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
   STEP 5 — Best-match RSS image
------------------------------------------------------------ */
function findClosestRssImage(url: string, rssMap: Record<string, string>) {
  const key = cleanUrl(url).toLowerCase();
  if (rssMap[key]) return rssMap[key];

  const last = key.split("/").pop() || "";
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
      const links = await getCandidateLinks(site);
      const rssImages = await getRssImages(site.rss);

      diagnostics.push({ site: site.source, found: links.length });

      for (const url of links) {
        const cleaned = cleanUrl(url);
        if (await isDuplicateUrl(cleaned)) continue;

        const art = await extractArticle(cleaned, site.base);
        if (!art || !art.fullText) continue;

        if (await isDuplicateTitle(art.title)) continue;

        const summary = await summarizeNews(art.fullText);
        const rawCat = await classifyNews(art.fullText || art.title);
        const category = rawCat;

        const headlineObj = await generateHeadline(
          art.title + "\n\n" + summary
        );

        const finalImg =
          findClosestRssImage(cleaned, rssImages) ||
          art.image ||
          null;

        /* ---------------- CATEGORY ARRAY LOGIC FIXED ---------------- */
        const categoriesArr: string[] = ["Top Stories"];

        if (["Business", "Economy"].includes(category)) {
          categoriesArr.push("Finance");
        }

        const goodNewsPattern =
          /\b(win|success|award|growth|profit|improved|record|milestone|boost|increase)\b/i;

        if (goodNewsPattern.test(art.fullText)) {
          categoriesArr.push("Good News");
        }

        /* -----------------------------------------------------------
           PAYLOAD
        ------------------------------------------------------------ */
        const payload: any = {
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

        /* -----------------------------------------------------------
           INSERT — WITH FALLBACK (NEVER FAIL)
        ------------------------------------------------------------ */
        const { error } = await supabaseBrowser
          .from("news_articles")
          .insert(payload);

        if (error) {
          const retryPayload = { ...payload };
          delete retryPayload.pub_date;

          const { error: retryErr } = await supabaseBrowser
            .from("news_articles")
            .insert(retryPayload);

          if (!retryErr) {
            return NextResponse.json(
              {
                ok: true,
                inserted: retryPayload,
                site: site.source,
                diagnostics,
                message: "Inserted 1 latest article (Fallback pub_date removed)",
              },
              { status: 200 }
            );
          }

          diagnostics.push({ insertError: error.message, retryError: retryErr.message });
          continue;
        }

        /* SUCCESS */
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
    } catch (err) {
      diagnostics.push({ site: site.source, error: String(err) });
      continue;
    }
  }

  return NextResponse.json(
    { ok: false, message: "No new valid article found", diagnostics },
    { status: 422 }
  );
}
