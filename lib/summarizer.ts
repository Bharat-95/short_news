// lib/summarizer.ts
import OpenAI from "openai";

/**
 * Summarizer: instruct model to produce exactly 60 words,
 * then enforce it by trimming as a fallback.
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function stripHtml(input?: string | null) {
  if (!input) return "";
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWhitespace(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

// For summaries - includes period
function trimToWordsWithPeriod(text: string, maxWords: number) {
  if (!text) return "";
  const words = normalizeWhitespace(text).split(" ");
  if (words.length <= maxWords) {
    const result = words.join(" ");
    return result.endsWith(".") ? result : result + ".";
  }
  const result = words.slice(0, maxWords).join(" ");
  return result.replace(/\.{2,}$/, "").trim() + ".";
}

// For headlines - NO period
function trimToWordsNoPeriod(text: string, maxWords: number) {
  if (!text) return "";
  const words = normalizeWhitespace(text).split(" ");
  if (words.length <= maxWords) {
    return words.join(" ").replace(/\.+$/, "").trim();
  }
  const result = words.slice(0, maxWords).join(" ");
  return result.replace(/\.+$/, "").trim();
}

export async function summarizeText(text: string): Promise<string> {
  const clean = stripHtml(text);

  const systemPrompt =
    "You are a concise news writer. Output ONLY a single paragraph that is exactly 60 words long. Do not include titles, headings, bullet points, explanations, or extraneous text. Do not include quotes or attribution unless necessary. Use clear, neutral language suitable for a news summary. **MUST END WITH A PERIOD (.) - NEVER with ellipsis (...)**";

  const userPrompt = `Summarize the following article in exactly 60 words (one paragraph, plain text only). Important: MUST END WITH A PERIOD, NOT ellipsis (...):\n\n${clean}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 180,
      temperature: 0.3,
    });

    let raw = completion.choices?.[0]?.message?.content?.trim() ?? "";
    
    raw = raw.replace(/\s*\.{2,}\s*$/, "").trim();
    
    if (!raw.endsWith(".")) {
      raw = raw + ".";
    }
    
    const normalized = normalizeWhitespace(raw);
    const words = normalized.split(" ");
    
    if (words.length === 60) {
      return normalized;
    } else if (words.length > 60) {
      return trimToWordsWithPeriod(normalized, 60);
    } else {
      return trimToWordsWithPeriod(clean, 60);
    }
    
  } catch (err) {
    console.error("summarizeText error:", (err as Error)?.message ?? String(err));
    return trimToWordsWithPeriod(clean, 60);
  }
}

export async function classifyCategory(text: string): Promise<string> {
  const clean = stripHtml(text);
  const prompt = `Classify this news into one category (choose exactly one): India, Business, Politics, Sports, Technology, Startups, Entertainment, International, Automobile, Science, Travel, Miscellaneous, Fashion, Education, Health & Fitness.\n\nNews: ${clean}\n\nRespond with only the category name.`;
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 20,
      temperature: 0.0,
    });
    const out = completion.choices?.[0]?.message?.content?.trim() ?? "Miscellaneous";
    return out.split("\n")[0].trim();
  } catch {
    return "Miscellaneous";
  }
}

// NEW: Check if article is finance-related
async function checkIfFinanceRelated(text: string, detailedCategory: string): Promise<boolean> {
  // First check: If detailed category is already financial
  const financeCategories = ["Business", "Startups"];
  if (financeCategories.includes(detailedCategory)) {
    return true;
  }
  
  // Second check: Ask AI if it's finance-related
  const prompt = `Analyze if this news article is about finance, economy, stocks, banking, money, investments, or business. 
  Respond ONLY with "YES" or "NO". Do not add any other text.
  
  Article: ${text.substring(0, 2000)}`;
  
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 10,
      temperature: 0.0,
    });
    
    const response = completion.choices?.[0]?.message?.content?.trim().toUpperCase() || "NO";
    return response === "YES" || response.includes("YES");
  } catch {
    // Fallback: Check for finance keywords
    const financeKeywords = [
      "stock", "market", "invest", "bank", "money", "economy", 
      "financial", "revenue", "profit", "loss", "share", "trading",
      "interest rate", "inflation", "GDP", "budget", "tax", "currency",
      "bitcoin", "crypto", "loan", "mortgage", "insurance", "fund",
      "investment", "banking", "economic", "dollar", "rupee", "wealth",
      "asset", "portfolio", "dividend", "IPO", "bond", "mutual fund"
    ];
    
    const lowerText = text.toLowerCase();
    return financeKeywords.some(keyword => lowerText.includes(keyword));
  }
}

// NEW: Check if article is positive/good news
async function checkIfGoodNews(text: string): Promise<boolean> {
  // Ask AI if this is positive/optimistic/good news
  const prompt = `Is this news article positive, optimistic, uplifting, or about good developments? 
  Consider if it's about achievements, progress, solutions, happy events, or positive outcomes.
  Respond ONLY with "YES" or "NO". Do not add any other text.
  
  Article: ${text.substring(0, 2000)}`;
  
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 10,
      temperature: 0.0,
    });
    
    const response = completion.choices?.[0]?.message?.content?.trim().toUpperCase() || "NO";
    return response === "YES" || response.includes("YES");
  } catch {
    // Fallback: Check for positive keywords
    const positiveKeywords = [
      "achievement", "success", "won", "victory", "breakthrough", "innovation",
      "growth", "improvement", "progress", "solution", "help", "aid", "donation",
      "recovery", "healing", "peace", "agreement", "treaty", "celebration",
      "record", "best", "first", "historic", "milestone", "positive", "good",
      "happy", "joy", "celebrate", "congratulations", "hope", "optimistic",
      "award", "prize", "honor", "thank", "grateful", "kindness", "generous",
      "donate", "charity", "volunteer", "save", "rescue", "hero", "brave",
      "discovery", "cure", "treatment", "healthy", "wellness", "clean",
      "green", "sustainable", "renewable", "eco-friendly", "solution"
    ];
    
    const lowerText = text.toLowerCase();
    return positiveKeywords.some(keyword => lowerText.includes(keyword));
  }
}

// NEW: Determine app-specific categories (Top Stories, Finance, Good News)
export async function determineAppCategories(text: string, detailedCategory: string): Promise<string[]> {
  const clean = stripHtml(text);
  
  // ALWAYS include "Top Stories" for all news
  const appCategories = ["Top Stories"];
  
  // Check if it's FINANCE-related
  const isFinanceRelated = await checkIfFinanceRelated(clean, detailedCategory);
  if (isFinanceRelated) {
    appCategories.push("Finance");
  }
  
  // Check if it's GOOD NEWS (positive)
  const isGoodNews = await checkIfGoodNews(clean);
  if (isGoodNews) {
    appCategories.push("Good News");
  }
  
  console.log(`✅ App categories determined: ${JSON.stringify(appCategories)}`);
  return appCategories;
}

// NEW: Main function that processes everything at once
export async function processFullArticle(text: string) {
  console.log("🚀 Processing full article...");
  
  // Process all components in parallel for speed
  const [summary, detailedCategory, headlineData] = await Promise.all([
    summarizeText(text),
    classifyCategory(text),
    generateHeadline(text)
  ]);
  
  console.log(`✅ Detailed category: ${detailedCategory}`);
  
  // Get app categories
  const appCategories = await determineAppCategories(text, detailedCategory);
  
  return {
    summary,                    // 60-word summary with period
    topics: detailedCategory,   // Single detailed category for "topics" column
    headline: headlineData,     // {headline: "...", subheadline: "..."}
    categories: appCategories   // Array for "categories" JSONB column
  };
}

export async function generateHeadline(text: string): Promise<{ headline: string; subheadline: string }> {
  console.log("🔍 [DEBUG] generateHeadline() STARTED");
  console.log(`🔍 [DEBUG] Input text length: ${text?.length || 0} chars`);
  
  const clean = stripHtml(text).slice(0, 4000);
  console.log(`🔍 [DEBUG] After stripHtml & slice length: ${clean?.length || 0} chars`);

  const system = `You are a professional news editor. Given article text, produce a compact headline and a short subheadline suitable for a news app. Return ONLY valid JSON with these two keys: {"headline":"...","subheadline":"..."} with no extra text. Headline must be 2-3 words. Subheadline must be 2-3 words. Use plain language and avoid punctuation (no periods at the end).`;

  const user = `Article (short):\n\n${clean}\n\nReturn only JSON: {"headline":"...","subheadline":"..."} without any commentary.`;

  try {
    console.log(`🔍 [DEBUG] Calling OpenAI API...`);
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 80,
      temperature: 0.25,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() ?? "";

    // try to extract JSON object from model output
    let parsed: any = null;
    try {
      const firstJsonMatch = raw.match(/\{[\s\S]*\}/);
      const jsonText = firstJsonMatch ? firstJsonMatch[0] : raw;
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error(`❌ [DEBUG] JSON parse error:`, (parseErr as Error)?.message);
      parsed = null;
    }

    const sanitize = (s: any) => (s ? String(s).replace(/["{}]/g, "").replace(/\.+$/, "").trim() : "");

    let headline = sanitize(parsed?.headline || "");
    let subheadline = sanitize(parsed?.subheadline || "");

    const wordCount = (s: string) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);

    const firstNWords = (source: string, n: number) => 
      normalizeWhitespace(source).split(" ").slice(0, n).join(" ").replace(/\.+$/, "");

    // Enforce 2-3 words for headline
    if (!headline) {
      headline = firstNWords(clean, 3);
    }
    
    const headlineWordCount = wordCount(headline);
    if (headlineWordCount > 3) {
      headline = firstNWords(headline, 3);
    }
    
    if (headlineWordCount < 2) {
      headline = firstNWords(clean, 2) || "News Update";
    }

    // Enforce 2-3 words for subheadline
    if (!subheadline) {
      const firstSentence = normalizeWhitespace(clean).split(".")[0] || "Details";
      subheadline = firstNWords(firstSentence, 3);
    }
    
    const subheadlineWordCount = wordCount(subheadline);
    if (subheadlineWordCount > 3) {
      subheadline = firstNWords(subheadline, 3);
    }
    
    if (subheadlineWordCount < 2) {
      subheadline = firstNWords(clean.split(".")[0] || clean, 2) || "Details";
    }

    // Final sanitize
    headline = headline.replace(/[\n\r]+/g, " ").replace(/["{}]/g, "").trim();
    subheadline = subheadline.replace(/[\n\r]+/g, " ").replace(/["{}]/g, "").trim();

    // Safety net
    if (!headline) headline = "News Update";
    if (!subheadline) subheadline = "Details inside";

    // Use the NO PERIOD version for headlines
    headline = trimToWordsNoPeriod(headline, 3);
    subheadline = trimToWordsNoPeriod(subheadline, 3);
    
    console.log(`🔍 [DEBUG] Final headline: "${headline}"`);
    console.log(`🔍 [DEBUG] Final subheadline: "${subheadline}"`);
    console.log(`🔍 [DEBUG] generateHeadline() COMPLETED`);
    
    return { headline, subheadline };
  } catch (err) {
    console.error("❌ [DEBUG] generateHeadline() CAUGHT ERROR:", (err as Error)?.message ?? String(err));
    
    if (err instanceof OpenAI.APIError) {
      console.error("❌ [DEBUG] OpenAI API Error:");
      console.error("  - Status:", err.status);
      console.error("  - Type:", err.type);
    }
    
    return { headline: "News Update", subheadline: "Details inside" };
  }
}