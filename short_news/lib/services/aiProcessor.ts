import OpenAI from "openai";
import { decodeHtmlEntities, stripHtml, normalizeWhitespace } from "../utils/normalize";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY || "dummy-key";
  return new OpenAI({ apiKey });
}

export const CATEGORY_LABELS = [
  "Politics",
  "Business",
  "Economy",
  "Tourism",
  "Crime",
  "Accident",
  "Sports",
  "Technology",
  "Health",
  "Education",
  "Environment",
  "Weather",
  "International",
  "Entertainment",
  "Lifestyle",
  "Traffic",
  "Miscellaneous"
];

export interface ProcessedArticleResult {
  summary: string;
  category: string;
  headline: {
    headline: string;
    subheadline: string;
  };
  bottomLine: string;
}

// Simple and highly reliable language detector
function detectLanguage(text: string): "fr" | "en" {
  const lower = text.toLowerCase();
  const frenchMarkers = [
    "le ", "la ", "les ", "des ", "une ", "un ",
    "à ", "au ", "aux ", "du ",
    "selon", "ministre", "rapport", "député", "gouvernement",
  ];

  let score = 0;
  frenchMarkers.forEach(m => {
    if (lower.includes(m)) score++;
  });

  return score >= 2 ? "fr" : "en";
}

function cleanHeadlineText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/\s*-\s*india today$/i, "")
    .replace(/\s*-\s*[^-]+$/i, "")
    .replace(/[^a-zA-ZÀ-ÿ0-9\s,'"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHeadlineWords(text: string, count: number): string {
  const cleaned = cleanHeadlineText(text);
  return normalizeWhitespace(cleaned).split(" ").slice(0, count).join(" ");
}

function sanitizeBottomLine(text: string): string {
  return normalizeWhitespace(text)
    .replace(/^\s*[•\-–—]+\s*/, "")
    .replace(/[“”"`]+/g, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([.!?]){2,}$/g, "$1")
    .trim();
}

function trimIncompleteBottomLine(text: string): string {
  const trailing = new Set([
    "a", "an", "the", "to", "for", "with", "on", "in", "at", "from",
    "after", "before", "during", "outside", "inside", "into", "over",
    "under", "of", "and", "or"
  ]);

  const stripped = text.replace(/[.!?]+$/g, "").trim();
  const words = stripped.split(" ").filter(Boolean);

  while (
    words.length > 5 &&
    trailing.has(words[words.length - 1].toLowerCase())
  ) {
    words.pop();
  }

  return words.join(" ").trim();
}

function finalizeBottomLine(text: string): string {
  const cleaned = trimIncompleteBottomLine(sanitizeBottomLine(text));
  if (!cleaned) return "Tap to know more";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function finalizeBullet(bullet: string): string {
  let cleaned = normalizeWhitespace(bullet).trim();
  if (!cleaned) return "";
  cleaned = cleaned.replace(/^["'`“”‘’.,:;\-()\[\]•]+/, "").trim();
  cleaned = cleaned.replace(/[,:;]+$/g, "").trim();
  if (!cleaned) return "";
  if (!/[.!?]$/.test(cleaned)) cleaned += ".";
  return cleaned;
}

// Fallback logic in case of OpenAI API errors
export function getFallbackResults(title: string, fullText: string, lang: "fr" | "en"): ProcessedArticleResult {
  const cleanTitle = cleanHeadlineWords(title, 8);
  const cleanSub = cleanHeadlineWords(title, 12);
  const teaser = finalizeBottomLine(cleanTitle);

  const fallbackSummary = lang === "fr"
    ? "• Résumé indisponible.\n• Détails non trouvés.\n• Consultez le site source."
    : "• Summary unavailable.\n• Detailed info not found.\n• View the source article.";

  return {
    headline: {
      headline: cleanTitle || "Latest News",
      subheadline: cleanSub || "Click to view full story",
    },
    summary: fallbackSummary,
    category: "Miscellaneous",
    bottomLine: teaser,
  };
}

/**
 * Single prompt processor that fetches headline, subheadline, summary,
 * category, and bottomLine in a single OpenAI request.
 */
export async function processArticle(title: string, fullText: string): Promise<ProcessedArticleResult> {
  const cleanContent = decodeHtmlEntities(stripHtml(fullText)).slice(0, 7000);
  const cleanTitle = decodeHtmlEntities(stripHtml(title)).slice(0, 1000);
  const lang = detectLanguage(cleanContent || cleanTitle);

  const systemPrompt = `
You are a senior news editor. Analyze the provided news title and article content, then generate a structured JSON object containing a headline, subheadline, summary bullets, category, and bottom line.

Rules:
1. **headline**: 5 to 8 words summarizing the main news event. Engaging and accurate. In ${lang === "fr" ? "French" : "English"}. No emojis.
2. **subheadline**: 6 to 12 words providing additional key context. In ${lang === "fr" ? "French" : "English"}. No emojis.
3. **summaryBullets**: Exactly 3 bullet sentences. In ${lang === "fr" ? "French" : "English"}. Completely rewritten from scratch, do not copy sentences directly. Each bullet must contain between 10 and 18 words. The total word count of all 3 bullets combined must NOT exceed 60 words.
4. **category**: Classify the news into exactly one of these allowed categories: ${CATEGORY_LABELS.join(", ")}. Always choose the clearest topic. Do not use "Miscellaneous" unless nothing fits.
5. **bottomLine**: 8 to 14 words bottom strip teaser. In ${lang === "fr" ? "French" : "English"}. Natural sentence or phrase, no emojis, no hashtags, no quotes.

Format your output strictly as a JSON object matching this schema:
{
  "headline": "string",
  "subheadline": "string",
  "summaryBullets": ["string", "string", "string"],
  "category": "string",
  "bottomLine": "string"
}
`;

  const userPrompt = `
Title: ${cleanTitle}

Content:
${cleanContent}
`;

  try {
    const client = getOpenAIClient();
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const raw = res.choices[0].message.content || "";
    const parsed = JSON.parse(raw);

    // Clean and validate headline/subheadline
    const finalHeadline = cleanHeadlineWords(parsed.headline || cleanTitle, 8);
    const finalSub = cleanHeadlineWords(parsed.subheadline || cleanTitle, 12);

    // Clean and validate summary bullets
    let bullets: string[] = Array.isArray(parsed.summaryBullets) ? parsed.summaryBullets : [];
    bullets = bullets
      .map(finalizeBullet)
      .filter((b) => b.length > 0)
      .slice(0, 3);

    // If we have fewer than 3 bullets, pad them
    while (bullets.length < 3) {
      bullets.push(lang === "fr" ? "Résumé non disponible." : "Summary not available.");
    }

    const summaryStr = bullets.map((b) => `• ${b}`).join("\n");

    // Clean and validate category
    let finalCategory = "Miscellaneous";
    const parsedCategory = String(parsed.category || "").toLowerCase();
    for (const c of CATEGORY_LABELS) {
      if (parsedCategory.includes(c.toLowerCase())) {
        finalCategory = c;
        break;
      }
    }

    // Clean and validate bottom line
    const finalBottomLine = finalizeBottomLine(parsed.bottomLine || cleanTitle);

    return {
      headline: {
        headline: finalHeadline,
        subheadline: finalSub,
      },
      summary: summaryStr,
      category: finalCategory,
      bottomLine: finalBottomLine,
    };
  } catch (error) {
    console.error("[AI Processor] Combined AI generation failed, falling back:", error);
    return getFallbackResults(title, fullText, lang);
  }
}
