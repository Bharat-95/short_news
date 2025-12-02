// lib/fetchers.ts
import axios from "axios";
import * as cheerio from "cheerio";
import { processFullArticle } from "./summarizer"; // Import the new processing function

export interface RawArticle {
  originalTitle: string;
  title: string;
  description: string;
  link: string;
  image?: string | null;
  source: string;
  category: string;
  pubDate?: string | null;
  fullText?: string | null;
  topics?: string;
  categories?: string[];
  headline?: { headline: string; subheadline: string };
}

const REQUEST_TIMEOUT = 10000;
const USER_AGENT = "Mozilla/5.0 (compatible; NewsFetcher/1.0; +https://example.com)";

async function httpGet(url: string) {
  try {
    const res = await axios.get(url, {
      timeout: REQUEST_TIMEOUT,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      maxBodyLength: 10 * 1024 * 1024,
    });
    return res.data as string;
  } catch (e) {
    console.error("httpGet failed for", url, e);
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

function takeFirstNonEmpty(...vals: Array<string | null | undefined>) {
  for (const v of vals) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

// Updated: Remove ellipsis, use the function from summarizer
function trimToWords(text: string, maxWords: number) {
  if (!text) return "";
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (words.length <= maxWords) return words.join(" ");
  // Remove ellipsis, just return the words
  return words.slice(0, maxWords).join(" ");
}

async function extractArticlePage(url: string, base: string) {
  console.log(`📄 Extracting article from: ${url}`);
  const html = await httpGet(url);
  if (!html) {
    console.log(`❌ Failed to fetch HTML from: ${url}`);
    return null;
  }
  
  const $ = cheerio.load(html);

  const metaTitle = takeFirstNonEmpty(
    $('meta[property="og:title"]').attr("content"),
    $('meta[name="twitter:title"]').attr("content"),
    $("title").first().text()
  );

  const metaDesc = takeFirstNonEmpty(
    $('meta[property="og:description"]').attr("content"),
    $('meta[name="description"]').attr("content"),
    $("meta[name='twitter:description']").attr("content"),
    ""
  );

  const metaImage = takeFirstNonEmpty(
    $('meta[property="og:image"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
    $("figure img").first().attr("src"),
    $("img").first().attr("src"),
    null
  );

  const timeMeta = takeFirstNonEmpty(
    $('meta[property="article:published_time"]').attr("content"),
    $('meta[name="pubdate"]').attr("content"),
    $('time[datetime]').attr("datetime"),
    $("time").first().text()
  );

  const articleSelectors = [
    "article",
    ".article",
    ".post",
    ".post-content",
    ".entry-content",
    ".news-content",
    ".story-content",
    "#content",
    ".node__content",
    ".field--name-body",
  ];

  const paragraphs: string[] = [];
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
  
  if (fullText.length < 100) {
    console.log(`⚠️ Article text too short (${fullText.length} chars), skipping`);
    return null;
  }

  const imageUrl = metaImage ? makeAbsolute(metaImage, base) : null;
  const title = metaTitle || $("h1").first().text().trim() || $("h2").first().text().trim() || "";

  console.log(`✅ Extracted: "${title.substring(0, 50)}..." (${fullText.length} chars)`);

  return {
    title,
    description: metaDesc || paragraphs.slice(0, 2).join(" "),
    image: imageUrl,
    pubDate: timeMeta ? new Date(timeMeta).toISOString() : null,
    fullText,
  };
}

async function scrapeHomepageForLinks(baseUrl: string) {
  console.log(`🌐 Scraping homepage: ${baseUrl}`);
  const html = await httpGet(baseUrl);
  if (!html) {
    console.log(`❌ Failed to fetch homepage: ${baseUrl}`);
    return [];
  }
  
  const $ = cheerio.load(html);

  const links = new Set<string>();

  const anchors = $("a").slice(0, 1000);
  anchors.each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href) return;
    const abs = makeAbsolute(href, baseUrl);
    try {
      const u = new URL(abs);
      const sameHost = u.hostname === new URL(baseUrl).hostname;
      if (!sameHost) return;
      const clean = abs.split("#")[0].split("?")[0];
      if (
        /\/\d{4}\/\d{2}\/\d{2}\/|\/\d{4}\/|\/news\/|\/article\/|\/story\/|\/post\/|\/actualites\/|\/node\/\d+|\/article\/\d+/i.test(
          clean
        ) ||
        /-[0-9]{4,}/i.test(clean) ||
        /\/[a-z0-9-]+-\d+\.html$/i.test(clean)
      ) {
        links.add(clean);
      }
    } catch {
      return;
    }
  });

  if (links.size === 0) {
    const selectors = [".top-news a", ".headline a", ".article-list a", ".news-list a", ".lead a", "a[href*='/news/']"];
    for (const sel of selectors) {
      const els = $(sel).slice(0, 100);
      els.each((_, el) => {
        const href = $(el).attr("href") || "";
        if (!href) return;
        const abs = makeAbsolute(href, baseUrl).split("#")[0].split("?")[0];
        try {
          const u = new URL(abs);
          if (u.hostname !== new URL(baseUrl).hostname) return;
        } catch {}
        links.add(abs);
      });
      if (links.size > 0) break;
    }
  }

  console.log(`🔗 Found ${links.size} potential article links`);
  return Array.from(links).slice(0, 60);
}

// UPDATED: Main function with full article processing
export async function fetchAndScrapeSites(
  sites: { source: string; base: string }[],
  limit = 20
): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  console.log(`🚀 Starting to scrape ${sites.length} sites, limit: ${limit}`);

  for (const s of sites) {
    console.log(`\n📰 Processing source: ${s.source} (${s.base})`);
    
    try {
      const normalized = s.base.startsWith("http") 
        ? s.base.replace(/\/+$/, "") 
        : `https://${s.base.replace(/\/+$/, "")}`;
      
      const links = await scrapeHomepageForLinks(normalized);
      console.log(`🔗 Found ${links.length} links to process`);
      
      for (const link of links) {
        if (out.length >= limit) {
          console.log(`⏹️ Reached limit of ${limit} articles, stopping`);
          break;
        }
        
        try {
          console.log(`\n📖 Processing article: ${link}`);
          const page = await extractArticlePage(link, normalized);
          
          if (!page || !page.fullText) {
            console.log(`⚠️ Skipping - no content extracted`);
            continue;
          }

          // NEW: Process the full article with AI
          console.log(`🤖 Processing with AI (summarizing, categorizing, headline generation)...`);
          let processed;
          try {
            processed = await processFullArticle(page.fullText);
            console.log(`✅ AI processing completed`);
            console.log(`   - Category: ${processed.topics}`);
            console.log(`   - App Categories: ${JSON.stringify(processed.categories)}`);
            console.log(`   - Headline: ${processed.headline.headline} / ${processed.headline.subheadline}`);
          } catch (aiError) {
            console.error(`❌ AI processing failed:`, aiError);
            // Fallback: use basic processing
            processed = {
              summary: trimToWords(page.fullText, 60) + ".",
              topics: "Miscellaneous",
              categories: ["Top Stories"],
              headline: { headline: "News Update", subheadline: "Details inside" }
            };
          }

          const source = s.source;
          const originalTitle = page.title || "";
          
          // Use the AI-generated summary (already 60 words with period)
          const shortSummary = processed.summary;
          
          // Use AI-generated headline for title, or fallback
          const rewrittenTitle = processed.headline.headline || 
                                 trimToWords(page.title || page.description || originalTitle, 10);
          
          out.push({
            originalTitle,
            title: rewrittenTitle,
            description: shortSummary,  // AI-generated 60-word summary
            link,
            image: page.image ?? null,
            source,
            category: processed.topics,  // Detailed category from AI
            pubDate: page.pubDate ?? null,
            fullText: page.fullText,
            // NEW: Additional fields for database
            topics: processed.topics,          // For 'topics' column
            categories: processed.categories,  // For 'categories' JSONB column
            headline: processed.headline       // For 'headline' JSONB column
          });

          console.log(`✅ Added article: "${rewrittenTitle}"`);
          console.log(`   Summary length: ${shortSummary.split(' ').length} words`);
          
        } catch (articleError) {
          console.error(`❌ Error processing article ${link}:`, articleError);
          continue;
        }
      }
    } catch (siteError) {
      console.error(`❌ Error processing site ${s.source}:`, siteError);
      continue;
    }
    
    if (out.length >= limit) break;
  }

  console.log(`\n🎉 Completed! Fetched ${out.length} articles`);
  return out.slice(0, limit);
}

// NEW: Function to save articles to Supabase
export async function saveArticlesToSupabase(articles: RawArticle[], supabaseClient: any) {
  console.log(`💾 Saving ${articles.length} articles to Supabase...`);
  
  let savedCount = 0;
  let skippedCount = 0;
  const errors = [];
  
  for (const article of articles) {
    try {
      // Check if article already exists (unique source_url constraint)
      const { data: existing } = await supabaseClient
        .from('news_articles')
        .select('id')
        .eq('source_url', article.link)
        .maybeSingle();

      if (existing) {
        console.log(`⏭️ Skipping duplicate: ${article.title.substring(0, 50)}...`);
        skippedCount++;
        continue;
      }

   
      const articleData = {
        title: article.title,
        summary: article.description, 
        image_url: article.image,
        source_url: article.link,
        source: article.source,
        topics: article.topics,       
        published_at: article.pubDate || new Date().toISOString(),
        pub_date: article.pubDate || new Date().toISOString(),
        notified: false,
        categories: article.categories || ["Top Stories"],  // App categories
        headline: article.headline || { headline: "News Update", subheadline: "Details inside" }
      };

      // Insert into Supabase
      const { data, error } = await supabaseClient
        .from('news_articles')
        .insert(articleData)
        .select();

      if (error) {
        console.error(`❌ Error saving article:`, error);
        errors.push({ article: article.title, error: error.message });
      } else {
        console.log(`✅ Saved: ${article.title.substring(0, 50)}...`);
        savedCount++;
      }
      
    } catch (error) {
      console.error(`❌ Unexpected error saving article:`, error);
      errors.push({ article: article.title, error: String(error) });
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   - Saved: ${savedCount}`);
  console.log(`   - Skipped (duplicates): ${skippedCount}`);
  console.log(`   - Errors: ${errors.length}`);
  
  if (errors.length > 0) {
    console.log(`\n❌ Errors:`);
    errors.forEach(err => console.log(`   - ${err.article}: ${err.error}`));
  }
  
  return { savedCount, skippedCount, errors };
}

// NEW: Example usage function
export async function runNewsFetchingPipeline(
  sites: { source: string; base: string }[],
  supabaseClient: any,
  limit = 20
) {
  try {
    console.log("🚀 Starting news fetching pipeline...");
    
    // 1. Fetch and scrape articles
    const articles = await fetchAndScrapeSites(sites, limit);
    
    if (articles.length === 0) {
      console.log("⚠️ No articles fetched");
      return { success: false, message: "No articles fetched" };
    }
    
    // 2. Save to Supabase
    const saveResult = await saveArticlesToSupabase(articles, supabaseClient);
    
    return {
      success: saveResult.errors.length === 0,
      message: `Pipeline completed. ${saveResult.savedCount} new articles added.`,
      details: saveResult
    };
    
  } catch (error) {
    console.error("❌ Pipeline failed:", error);
    return {
      success: false,
      message: `Pipeline failed: ${error}`,
      details: null
    };
  }
}