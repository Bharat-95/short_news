/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import {
  summarizeText,
  classifyCategory,
  generateHeadline,
  trimToWords,
} from "@/lib/summarizer";
import { supabaseBrowser } from "@/lib/db";

/* ------------------------------------------------------
   1. SITE DEFINITIONS
------------------------------------------------------ */
const SITE_PRIORITIES = [
  { source: "Defi Media Group", base: "https://defimedia.info" },
  { source: "Mauritius Broadcasting", base: "https://mbc.intnet.mu" },
  { source: "Le Mauricien", base: "https://lemauricien.com" },
  { source: "Inside News", base: "https://inside.news" },
  { source: "NewsMoris", base: "https://newsmoris.com" },
];

/* ------------------------------------------------------
   2. UTILITIES
------------------------------------------------------ */

type CheerioAPI = ReturnType<typeof cheerio.load>;

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        "User-Agent": "Mozilla/5.0 (News Fetcher)",
      },
    });
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  } catch {
    return null;
  }
}

function makeAbsolute(href: string, base: string) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function cleanText(t?: string | null) {
  if (!t) return "";
  return t.replace(/\s+/g, " ").trim();
}

function tokenOverlapRatio(a?: string | null, b?: string | null) {
  if (!a || !b) return 0;
  const A = cleanText(a).toLowerCase().split(" ");
  const B = cleanText(b).toLowerCase().split(" ");
  if (!A.length || !B.length) return 0;
  const setA = new Set(A);
  let common = 0;
  for (const w of B) if (setA.has(w)) common++;
  return common / Math.min(A.length, B.length);
}

/* ------------------------------------------------------
   3. FEED PARSER
------------------------------------------------------ */

function parseFeedXml(xml: string, base: string) {
  const $: CheerioAPI = cheerio.load(xml, { xmlMode: true });
  const items: any[] = [];

  $("item").each((_, el) => {
    const t = $(el).find("title").text().trim();
    let link = $(el).find("link").text().trim();
    if (!link) link = $(el).find("guid").text().trim();

    const desc =
      $(el).find("description").text().trim() ||
      $(el).find("summary").text().trim() ||
      null;

    items.push({
      title: t,
      link: link ? makeAbsolute(link, base) : "",
      description: desc,
    });
  });

  $("entry").each((_, el) => {
    const t = $(el).find("title").text().trim();
    const link =
      $(el).find("link[rel='alternate']").attr("href") ||
      $(el).find("link").attr("href") ||
      "";

    const content =
      $(el).find("summary").text().trim() ||
      $(el).find("content").text().trim() ||
      null;

    items.push({
      title: t,
      link: makeAbsolute(link, base),
      description: content,
    });
  });

  return items;
}

async function probeFeeds(base: string, timeout: number) {
  const paths = [
    "/rss",
    "/rss.xml",
    "/feed",
    "/feed.xml",
    "/index.xml",
    "/atom.xml",
  ];
  for (const p of paths) {
    const url = base + p;
    const xml = await fetchText(url, timeout);
    if (!xml) continue;
    if (/<(rss|feed|item|entry)/i.test(xml)) {
      try {
        const items = parseFeedXml(xml, base);
        if (items.length) return items;
      } catch {
        continue;
      }
    }
  }
  return [];
}

/* ------------------------------------------------------
   4. ARTICLE EXTRACTION
------------------------------------------------------ */

function extractArticleFromHtml(html: string, base: string) {
  const $: CheerioAPI = cheerio.load(html);

  const metaTitle =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().trim() ||
    $("h1").first().text().trim() ||
    "";

  const metaDesc =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "";

  const metaImage =
    $('meta[property="og:image"]').attr("content") ||
    $("img").first().attr("src") ||
    null;

  const selectors = [
    "article",
    ".article",
    ".post",
    ".entry-content",
    ".content",
    "#content",
  ];

  let paragraphs: string[] = [];

  for (const sel of selectors) {
    const el = $(sel);
    if (el.length) {
      el.find("script, style, .ads, .advert").remove();
      el.find("p").each((_, p) => {
        const t = cleanText($(p).text());
        if (t.length > 30) paragraphs.push(t);
      });
      if (paragraphs.length) break;
    }
  }

  if (!paragraphs.length) {
    $("p").each((_, p) => {
      const t = cleanText($(p).text());
      if (t.length > 30) paragraphs.push(t);
    });
  }

  const fullText = paragraphs.join("\n\n").trim() || metaDesc;

  return {
    title: metaTitle,
    description: metaDesc,
    image: metaImage ? makeAbsolute(metaImage, base) : null,
    fullText,
  };
}

/* ------------------------------------------------------
   5. NEWS API MAIN ROUTE
------------------------------------------------------ */

export async function POST(req: Request) {
  const diagnostics: any = { tried: [] };

  try {
    for (const site of SITE_PRIORITIES) {
      const base = site.base.replace(/\/$/, "");
      const diag: any = { site: base };
      diagnostics.tried.push(diag);

      /* 1. FEED FETCH */
      const feed = await probeFeeds(base, 7000);
      diag.feedCount = feed.length;

      /* 2. HOME FETCH */
      const homeHtml = await fetchText(base, 7000);
      if (!homeHtml) continue;

      /* 3. PICK FIRST FEED ITEM OR FALLBACK */
      let picked = feed[0];
      if (!picked) continue;

      diag.picked = picked.link;

      /* 4. FETCH ARTICLE PAGE */
      const page = await fetchText(picked.link, 9000);
      if (!page) continue;

      /* 5. PARSE ARTICLE */
      const ext = extractArticleFromHtml(page, base);

      if (!ext.fullText || ext.fullText.length < 60) {
        diag.skip = "empty-fullText";
        continue;
      }

      /* 6. DEDUPE BY URL */
      const urlCheck = await supabaseBrowser
        .from("news_articles")
        .select("id")
        .eq("source_url", picked.link)
        .maybeSingle();

      if (urlCheck.data) {
        diag.skip = "exists-by-url";
        continue;
      }

      /* 7. DEDUPE TITLE */
      const { data: allTitles } = await supabaseBrowser
        .from("news_articles")
        .select("title")
        .limit(300);

      if (allTitles?.length) {
        for (const row of allTitles) {
          const r = tokenOverlapRatio(ext.title, row.title);
          if (r >= 0.6) {
            diag.skip = "title-duplicate";
            continue;
          }
        }
      }

      /* 8. SUMMARY */
      const summary =
        (await summarizeText(ext.fullText)) ||
        trimToWords(ext.fullText, 45);

      /* 9. CATEGORY */
      const category = await classifyCategory(
        ext.fullText || ext.title || ""
      );

      /* 10. HEADLINE */
      const headline = await generateHeadline(
        `${ext.title}\n${summary}`
      );

      /* 11. INSERT INTO SUPABASE */
      const payload: any = {
        title: ext.title,
        summary,
        image_url: ext.image,
        source_url: picked.link,
        source: site.source,
        topics: category,
        categories: [category],
        headline,
      };

      const insert = await supabaseBrowser
        .from("news_articles")
        .insert(payload);

      if (insert.error) {
        diag.skip = `insert-error: ${insert.error.message}`;
        continue;
      }

      /* SUCCESS */
      diag.inserted = payload.source_url;

      return NextResponse.json(
        {
          ok: true,
          message: "Inserted article",
          article: payload,
          diagnostics,
        },
        { status: 200 }
      );
    }

    /* IF NOTHING INSERTED */
    return NextResponse.json(
      {
        ok: false,
        message: "No valid article found.",
        diagnostics,
      },
      { status: 422 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message, diagnostics },
      { status: 500 }
    );
  }
}
