/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { supabaseBrowser } from "@/lib/db";
import {
  summarizeText,
  classifyCategory,
  generateHeadline,
} from "@/lib/summarizer";

const SITE_PRIORITIES = [
  { source: "Defi Media Group", base: "https://defimedia.info" },
  { source: "Mauritius Broadcasting", base: "https://mbc.intnet.mu" },
  { source: "Le Mauricien", base: "https://lemauricien.com" },
  { source: "Inside News", base: "https://www.insideedition.com/" },
  { source: "NewsMoris", base: "https://newsmoris.com" },
];

type CheerioAPI = ReturnType<typeof cheerio.load>;

async function fetchText(url: string, timeoutMs = 8000) {
  try {
    const r = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NewsFetcher/1.0; +https://example.com)",
        Accept: "*/*",
      },
      maxBodyLength: 10 * 1024 * 1024,
    });
    return typeof r.data === "string" ? r.data : JSON.stringify(r.data);
  } catch (e: any) {
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

function normalizeText(s?: string | null) {
  if (!s) return "";
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapRatio(a?: string | null, b?: string | null) {
  const na = normalizeText(a).split(" ").filter(Boolean);
  const nb = normalizeText(b).split(" ").filter(Boolean);
  if (na.length === 0 || nb.length === 0) return 0;
  const setA = new Set(na);
  let common = 0;
  for (const t of nb) if (setA.has(t)) common++;
  return common / Math.min(na.length, nb.length);
}

function trimToWords(text: string, maxWords: number) {
  if (!text) return "";
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (words.length <= maxWords) return words.join(" ");
  return (
    words.slice(0, maxWords).join(" ") + (words.length > maxWords ? "..." : "")
  );
}

function parseFeedXml(xml: string, base: string) {
  const $: CheerioAPI = cheerio.load(xml, { xmlMode: true });
  const items: Array<any> = [];

  $("item").each((_, el) => {
    const $el = $(el);
    const title = ($el.find("title").first().text() || "").trim();
    let link = ($el.find("link").first().text() || "").trim();
    if (!link) link = ($el.find("guid").first().text() || "").trim();
    const enclosure =
      $el.find("enclosure").attr("url") ||
      $el.find("media\\:content").attr("url") ||
      null;
    const desc =
      (
        $el.find("description").first().text() ||
        $el.find("summary").first().text() ||
        ""
      ).trim() || null;
    const pubDate =
      (
        $el.find("pubDate").first().text() ||
        $el.find("published").first().text() ||
        $el.find("updated").first().text() ||
        ""
      ).trim() || null;
    items.push({
      title,
      link: link ? makeAbsolute(link, base) : "",
      description: desc,
      pubDate: pubDate ? new Date(pubDate).toISOString() : null,
      image: enclosure ? makeAbsolute(enclosure, base) : null,
    });
  });

  $("entry").each((_, el) => {
    const $el = $(el);
    const title = ($el.find("title").first().text() || "").trim();
    let link =
      $el.find("link[rel='alternate']").attr("href") ||
      $el.find("link").attr("href") ||
      "";
    const content =
      (
        $el.find("summary").first().text() ||
        $el.find("content").first().text() ||
        ""
      ).trim() || null;
    const pubDate =
      (
        $el.find("updated").first().text() ||
        $el.find("published").first().text() ||
        ""
      ).trim() || null;
    const media =
      $el.find("media\\:content").attr("url") ||
      $el.find("media\\:thumbnail").attr("url") ||
      null;
    items.push({
      title,
      link: link ? makeAbsolute(link, base) : "",
      description: content,
      pubDate: pubDate ? new Date(pubDate).toISOString() : null,
      image: media ? makeAbsolute(media, base) : null,
    });
  });

  return items;
}

async function probeFeedsForItems(base: string, timeoutMs = 7000) {
  const candidates = [
    "/rss",
    "/rss.xml",
    "/feed",
    "/feed.xml",
    "/feeds",
    "/feeds/rss.xml",
    "/index.xml",
    "/atom.xml",
    "/rss/all.xml",
    "/rss/latest.xml",
    "/sitemap.xml",
  ];
  for (const p of candidates) {
    const url = base.replace(/\/$/, "") + p;
    const xml = await fetchText(url, timeoutMs);
    if (!xml) continue;
    if (!/<rss|<feed|<item|<entry/i.test(xml)) continue;
    try {
      const items = parseFeedXml(xml, base);
      if (items && items.length) return items;
    } catch {
      continue;
    }
  }
  return [];
}

function pickCandidateFromHomepage(html: string, base: string): string | null {
  const $: CheerioAPI = cheerio.load(html);
  const selectors = [
    "article a[href]",
    ".top-news a[href]",
    ".headline a[href]",
    ".latest a[href]",
    "a[href*='/article/']",
    "a[href*='/news/']",
    "a[href*='/content/']",
    "a[href*='/actualite/']",
    "a[href*='/stories/']",
    "a[href*='/2025/']",
  ];

  const seen = new Set<string>();
  for (const sel of selectors) {
    const nodes = $(sel);
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes.eq(i);
      const href = a.attr("href") || "";
      if (!href) continue;
      const url = makeAbsolute(href, base).split("#")[0].split("?")[0];
      if (!url.startsWith(base)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      if (
        /(\/\d{4}\/\d{2}\/\d{2}\/|\/\d{4}\/|\/article|\/news|\/actualite|-[0-9]{4,})/i.test(
          url
        )
      ) {
        return url;
      }
    }
    if (seen.size > 0) return Array.from(seen)[0];
  }

  const first = $("a[href]")
    .get()
    .map((n) => makeAbsolute($(n).attr("href") || "", base))
    .find((u) => u && u.startsWith(base));
  return first || null;
}
function extractArticleFromHtml(html: string, base: string) {
  const $: CheerioAPI = cheerio.load(html);

  const metaTitle =
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "";

  const metaDesc =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    $("meta[name='twitter:description']").attr("content") ||
    "";

  const metaImage =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $("figure img").first().attr("src") ||
    $("img").first().attr("src") ||
    null;

  const timeMeta =
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[name="pubdate"]').attr("content") ||
    $("time[datetime]").attr("datetime") ||
    $("time").first().text() ||
    null;

  const articleSelectors = [
  "article",
  ".article",
  ".post",
  ".post-content",
  ".entry-content",
  ".entry-content.clearfix",
  ".news-content",
  ".story-content",
  ".content-body",
  ".article-content",
  ".node-content",
  ".field-item",
  ".field-items",
  ".text-content",
  ".post-body",
  ".page-content",
  "#content",
  "#main-content",
];

  let paragraphs: string[] = [];
  for (const sel of articleSelectors) {
    const el = $(sel);
    if (el.length) {
      el.find("script, style, .advert, .ads, .share, noscript").remove();
      el.find("p").each((_, p) => {
        const t = $(p).text().trim();
        if (t.length > 20) paragraphs.push(t);
      });
      if (paragraphs.length > 0) break;
    }
  }
  if (paragraphs.length === 0) {
    $("p").each((_, p) => {
      const t = $(p).text().trim();
      if (t.length > 30) paragraphs.push(t);
    });
  }
  const fullText = paragraphs.join("\n\n").trim() || metaDesc || "";

  return {
    title: metaTitle,
    description: metaDesc || paragraphs.slice(0, 2).join(" "),
    image: metaImage ? makeAbsolute(metaImage, base) : null,
    pubDate: timeMeta ? new Date(timeMeta).toISOString() : null,
    fullText,
  };
}

async function summarizeWithTimeout(text: string, ms = 10000) {
  return await Promise.race([
    (async () => {
      const s = await summarizeText(text);
      return s;
    })(),
    new Promise<string>((_, rej) =>
      setTimeout(() => rej(new Error("summarizer timeout")), ms)
    ),
  ]);
}

async function classifyWithTimeout(text: string, ms = 8000) {
  return await Promise.race([
    (async () => {
      const s = await classifyCategory(text);
      return s;
    })(),
    new Promise<string>((_, rej) =>
      setTimeout(() => rej(new Error("classifier timeout")), ms)
    ),
  ]);
}

async function isDuplicateTitle(
  candidateTitle: string,
  threshold = 0.85,
  recentLimit = 500
) {
  if (!candidateTitle) return false;
  try {
    const { data, error } = await supabaseBrowser
      .from("news_articles")
      .select("id,title")
      .order("created_at", { ascending: false })
      .limit(recentLimit);
    if (error) {
      console.error("Title dedupe select failed:", error);
      return false;
    }
    const rows: any[] = data || [];
    for (const row of rows) {
      const existingTitle = row.title || "";
      const ratio = tokenOverlapRatio(candidateTitle, existingTitle);
      if (ratio >= threshold) {
        return true;
      }
    }
    return false;
  } catch (e) {
    console.error("isDuplicateTitle error:", e);
    return false;
  }
}

const ALLOWED_CATEGORIES = [
  "India",
  "Business",
  "Politics",
  "Sports",
  "Technology",
  "Startups",
  "Entertainement",
  "International",
  "Automobile",
  "Science",
  "Travel",
  "Miscallenious",
  "fashion",
  "Education",
  "Health & Fitness",
  "Good News",
];

function mapToAllowedCategory(raw?: string | null) {
  if (!raw) return "Miscallenious";
  const r = String(raw).toLowerCase();
  for (const c of ALLOWED_CATEGORIES) {
    if (c.toLowerCase() === r) return c;
  }
  for (const c of ALLOWED_CATEGORIES) {
    if (r.includes(c.toLowerCase())) return c;
  }
  if (r.includes("business") || r.includes("econom")) return "Business";
  if (r.includes("polit") || r.includes("election") || r.includes("parliament"))
    return "Politics";
  if (r.includes("sport")) return "Sports";
  if (r.includes("tech") || r.includes("technology")) return "Technology";
  if (r.includes("startup")) return "Startups";
  if (r.includes("entertain") || r.includes("movie") || r.includes("celebr"))
    return "Entertainement";
  if (r.includes("international") || r.includes("world"))
    return "International";
  if (r.includes("auto") || r.includes("car")) return "Automobile";
  if (r.includes("science")) return "Science";
  if (r.includes("travel") || r.includes("tourism")) return "Travel";
  if (r.includes("fashion") || r.includes("style")) return "fashion";
  if (r.includes("education") || r.includes("school") || r.includes("teacher"))
    return "Education";
  if (
    r.includes("health") ||
    r.includes("covid") ||
    r.includes("disease") ||
    r.includes("fitness")
  )
    return "Health & Fitness";
  return "Miscallenious";
}

function autoAssignCategories(article: {
  title: string;
  description: string;
  fullText: string;
  chosenCategory: string;
}) {
  const categories = new Set<string>();

  // Always include the main chosen category
  categories.add(article.chosenCategory);

  const full = (
    (article.title || "") +
    " " +
    (article.description || "") +
    " " +
    (article.fullText || "")
  ).toLowerCase();

  // Finance detection
  if (
    full.includes("finance") ||
    full.includes("financial") ||
    full.includes("stocks") ||
    full.includes("economy") ||
    full.includes("inflation") ||
    full.includes("bank") ||
    full.includes("loan") ||
    full.includes("rupee") ||
    full.includes("market")
  ) {
    categories.add("Finance");
  }

  // Timeline-style story detection
  if (
    full.includes("timeline") ||
    full.includes("chronology") ||
    /\b\d{4}\b.*\b\d{4}\b/.test(full) || // Detect multiple years in story
    full.includes("in the past") ||
    full.includes("over the years")
  ) {
    categories.add("Timeline");
  }

  // Good news (more friendly version)
  const positivePattern =
    /\b(win|wins|won|award|awarded|success|improvement|improved|growth|record high|milestone|achievement|boon|benefit)\b/i;
  if (positivePattern.test(full)) {
    categories.add("Good News");
  }

  // Important / breaking category (Top Stories)
  if (
    full.includes("breaking") ||
    full.includes("urgent") ||
    full.includes("developing story") ||
    full.includes("major") ||
    full.includes("headline")
  ) {
    categories.add("Top Stories");
  }

  return Array.from(categories);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({} as any))) as {
      diagnostics?: boolean;
      probeTimeoutMs?: number;
      pageTimeoutMs?: number;
      summarizerTimeoutMs?: number;
      titleDedupeThreshold?: number;
      classifierTimeoutMs?: number;
    };

    const probeTimeout =
      typeof body.probeTimeoutMs === "number" ? body.probeTimeoutMs : 7000;
    const pageTimeout =
      typeof body.pageTimeoutMs === "number" ? body.pageTimeoutMs : 9000;
    const summarizerTimeout =
      typeof body.summarizerTimeoutMs === "number"
        ? body.summarizerTimeoutMs
        : 10000;
    const titleDedupeThreshold =
      typeof body.titleDedupeThreshold === "number"
        ? body.titleDedupeThreshold
        : 0.55;
    const classifierTimeout =
      typeof body.classifierTimeoutMs === "number"
        ? body.classifierTimeoutMs
        : 8000;

    let diagnostics: any = { triedSites: [] };

    for (const s of SITE_PRIORITIES) {
      const base = s.base.startsWith("http")
        ? s.base.replace(/\/+$/, "")
        : `https://${s.base.replace(/\/+$/, "")}`;
      const siteDiag: any = {
        site: base,
        feedFound: false,
        homeFetched: false,
        candidate: null,
        skipped: null,
      };
      diagnostics.triedSites.push(siteDiag);

      const feedItems = await probeFeedsForItems(base, probeTimeout);
      siteDiag.feedFound = feedItems && feedItems.length > 0;

      const homeHtml = await fetchText(base, probeTimeout);
      siteDiag.homeFetched = !!homeHtml;
      const candidateLink = homeHtml
        ? pickCandidateFromHomepage(homeHtml, base)
        : null;
      siteDiag.candidate = candidateLink;

      let matchedItem: any = null;
      if (feedItems && feedItems.length > 0) {
        matchedItem = feedItems[0];
        if (candidateLink) {
          const exact = feedItems.find(
            (it) =>
              it.link && it.link.split("?")[0] === candidateLink.split("?")[0]
          );
          if (exact) matchedItem = exact;
        }
      }
      let finalArticle: any = null;
      if (matchedItem) {
        finalArticle = {
          title: matchedItem.title || "",
          link: matchedItem.link || candidateLink || base,
          description: matchedItem.description || "",
          image: matchedItem.image || null,
          pubDate: matchedItem.pubDate || null,
          fullText: null,
          source: s.source,
        };

        try {
          if (finalArticle.link) {
            const pageHtml = await fetchText(finalArticle.link, pageTimeout);
            if (pageHtml) {
              const ext = extractArticleFromHtml(pageHtml, base);
              if (ext.fullText && ext.fullText.split(" ").length >= 20) {
                finalArticle.fullText = ext.fullText;
                if (!finalArticle.image && ext.image)
                  finalArticle.image = ext.image;
                if (
                  !finalArticle.description ||
                  finalArticle.description.length < 30
                ) {
                  finalArticle.description =
                    ext.description || trimToWords(ext.fullText, 60);
                }
                if (!finalArticle.title && ext.title)
                  finalArticle.title = ext.title;
                if (!finalArticle.pubDate && ext.pubDate)
                  finalArticle.pubDate = ext.pubDate;
              }
            }
          }
        } catch {
          // ignore page fetch errors
        }
      } else if (candidateLink) {
        const pageHtml = await fetchText(candidateLink, pageTimeout);
        if (!pageHtml) {
          siteDiag.skipped = "candidate fetch failed";
          continue;
        }
        const ext = extractArticleFromHtml(pageHtml, base);
        if (ext.fullText && ext.fullText.split(" ").length >= 20) {
          finalArticle = {
            title: ext.title || "",
            link: candidateLink,
            description: ext.description || trimToWords(ext.fullText, 60),
            image: ext.image || null,
            pubDate: ext.pubDate || null,
            fullText: ext.fullText,
            source: s.source,
          };
        } else {
          siteDiag.skipped = "no extractable fullText";
          continue;
        }
      } else {
        siteDiag.skipped = "no candidate";
        continue;
      }

      const urlToCheck = finalArticle.link;
      try {
        const { data: existingByUrl, error: selErr } = await supabaseBrowser
          .from("news_articles")
          .select("id")
          .eq("source_url", urlToCheck)
          .limit(1)
          .maybeSingle();

        if (selErr) {
          siteDiag.skipped = `supabase select error: ${
            selErr.message || selErr
          }`;
          continue;
        }
        if (existingByUrl) {
          siteDiag.skipped = "exists-by-url";
          continue;
        }
      } catch (e) {
        siteDiag.skipped = `url-check-exception:${String(e)}`;
        continue;
      }

      const candidateTitle = finalArticle.title || "";
      const isTitleDup = await isDuplicateTitle(
        candidateTitle,
        titleDedupeThreshold,
        500
      );
      if (isTitleDup) {
        siteDiag.skipped = "exists-by-title";
        continue;
      }

      let shortDescription = finalArticle.description || "";

      // FIX: summary should NOT have "..."
      // ---- FIXED SUMMARIZATION LOGIC ----
      try {
        const toSummarize =
          finalArticle.fullText ||
          finalArticle.description ||
          finalArticle.title ||
          "";

        // Always summarize if text has at least 10 words
        if (toSummarize && toSummarize.split(" ").length >= 10) {
          const s = await Promise.race([
            summarizeWithTimeout(toSummarize, summarizerTimeout),
            new Promise<string>((res) =>
              setTimeout(
                () => res(trimToWords(toSummarize, 35)),
                summarizerTimeout
              )
            ),
          ]);

          if (s && typeof s === "string") {
            shortDescription = s
              .replace(/\.\.\.$/, "")
              .replace(/\s+\.\.\.$/, "")
              .trim();
          }
        } else {
          // Even if text is very short, still summarize to standardize output
          const s = await summarizeWithTimeout(toSummarize, summarizerTimeout);
          if (s && typeof s === "string") {
            shortDescription = s.trim();
          }
        }
      } catch {
        // Safe fallback
        const trimmed = trimToWords(
          finalArticle.fullText ||
            finalArticle.description ||
            finalArticle.title,
          35
        );
        shortDescription = trimmed.replace(/\.\.\.$/, "").trim();
      }

      // FINAL CLEAN SUMMARY (no ...)
      shortDescription = shortDescription.replace(/\.\.\.$/, "").trim();

      let chosenCategory = "Miscallenious";
      try {
        const classifyInput = (
          finalArticle.fullText ||
          finalArticle.description ||
          finalArticle.title ||
          ""
        ).slice(0, 4000);
        if (classifyInput && classifyInput.length > 20) {
          const rawCat = await classifyWithTimeout(
            classifyInput,
            classifierTimeout
          ).catch(() => null);
          chosenCategory = mapToAllowedCategory(rawCat ?? null);
        } else {
          chosenCategory = "Miscallenious";
        }
      } catch (e) {
        chosenCategory = "Miscallenious";
      }

      // FIX: categories should only be the final mapped category
      const categoriesArr = autoAssignCategories({
        title: finalArticle.title || "",
        description: finalArticle.description || "",
        fullText: finalArticle.fullText || "",
        chosenCategory,
      });

      const positivePattern =
        /\b(win|wins|won|award|awarded|success|successful|benefit|benefits|improvement|improved|record high|record-low|reduced|saved|cut|growth|grows|growths|boon|positive)\b/i;
      const hay = (
        finalArticle.fullText ||
        finalArticle.description ||
        ""
      ).slice(0, 4000);
      if (positivePattern.test(hay)) {
        if (!categoriesArr.includes("Good news"))
          categoriesArr.push("Good news");
      }

      const headlineInput = `${
        finalArticle.title || ""
      }\n\n${shortDescription}\n\n${(finalArticle.fullText || "").slice(
        0,
        800
      )}`;
      let headlineObj;
      try {
        headlineObj = await generateHeadline(headlineInput);
      } catch {
        headlineObj = {
          headline: "News Update",
          subheadline: "Details inside",
        };
      }

      const payload: any = {
        title: finalArticle.title || "Untitled",
        summary:
          shortDescription ||
          trimToWords(
            finalArticle.description ||
              finalArticle.fullText ||
              finalArticle.title,
            60
          ).replace(/\.\.\.$/, ""),
        image_url: finalArticle.image ?? null,
        source_url: urlToCheck,
        source: finalArticle.source ?? s.source,

        // FIX: topics must be chosenCategory exactly
        topics: chosenCategory,

        categories: categoriesArr,
        headline: headlineObj,
      };
      if (finalArticle.pubDate) payload.pub_date = finalArticle.pubDate;
      const { error: insertError } = await supabaseBrowser
        .from("news_articles")
        .insert(payload);

      if (insertError) {
        const msg = String(insertError.message || insertError).toLowerCase();
        if (msg.includes("pub_date") || /column .* does not exist/.test(msg)) {
          const retry = { ...payload };
          delete retry.pub_date;

          const { error: retryErr } = await supabaseBrowser
            .from("news_articles")
            .insert(retry);

          if (retryErr) {
            siteDiag.skipped = `insert-retry-failed: ${
              retryErr.message || retryErr
            }`;
            continue;
          } else {
            siteDiag.inserted = true;
            siteDiag.insertedUrl = urlToCheck;
            return NextResponse.json(
              {
                ok: true,
                message: "Inserted latest article (without pub_date)",
                url: urlToCheck,
                title: payload.title,
                image: payload.image_url,
                description: payload.summary,
                topics: payload.topics,
                categories: payload.categories,
                diagnostics,
              },
              { status: 200 }
            );
          }
        } else {
          siteDiag.skipped = `insert-failed: ${
            insertError.message || insertError
          }`;
          continue;
        }
      } else {
        siteDiag.inserted = true;
        siteDiag.insertedUrl = urlToCheck;

        return NextResponse.json(
          {
            ok: true,
            message: "Inserted latest article",
            url: urlToCheck,
            title: payload.title,
            image: payload.image_url,
            description: payload.summary,
            topics: payload.topics,
            categories: payload.categories,
            diagnostics,
          },
          { status: 200 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,
        message:
          "No non-duplicate extractable article found across candidate sites.",
        diagnostics,
      },
      { status: 422 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "unknown" },
      { status: 500 }
    );
  }
}
