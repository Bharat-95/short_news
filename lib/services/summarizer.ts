// lib/services/summarizer.ts
import OpenAI from "openai";
import { stripHtml, normalizeWhitespace } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/** MAX allowed words */
const MAX_WORDS = 60;

/** Utility to trim safely */
function trimToWords(text: string, max: number) {
  return normalizeWhitespace(text).split(" ").slice(0, max).join(" ");
}

/** Count words */
function wordCount(text: string) {
  return normalizeWhitespace(text).split(" ").filter(Boolean).length;
}

/** Detect if model copied article intro */
function looksCopied(summary: string, article: string): boolean {
  const cleanSummary = normalizeWhitespace(summary).toLowerCase();
  const cleanArticle = normalizeWhitespace(article).toLowerCase();

  // Check if first 10–15 words appear in order inside the article
  const firstWords = cleanSummary.split(" ").slice(0, 12).join(" ");

  return cleanArticle.includes(firstWords);
}

/** Core summarizer function */
async function generateSummary(clean: string) {
  const systemPrompt = `
You are an expert news summarizer.
Your job is to rewrite the entire article into a **concise factual summary**.

STRICT RULES:
- Output MUST be a rewritten summary, NOT copied sentences.
- ABSOLUTELY NO COPYING from the article.
- NO MORE THAN 60 WORDS.
- ONE paragraph only.
- Must rewrite in fresh journalistic language.
- No ellipses (...), no emojis, no filler.
- Include ONLY the key facts.
`;

  const userPrompt = `
Summarize the following news article into a maximum of 60 words.
Do NOT copy any sentences from the article. Write a fresh summary:

ARTICLE:
${clean}
`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.35,
    max_tokens: 140,
    presence_penalty: 0.8,  // discourage repetition
    frequency_penalty: 1.1, // discourage copying
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return normalizeWhitespace(response.choices?.[0]?.message?.content || "");
}

/** Main exported function */
export async function summarizeNews(rawText: string): Promise<string> {
  const clean = stripHtml(rawText).slice(0, 8000);

  try {
    // First attempt
    let summary = await generateSummary(clean);

    // Enforce word limit
    summary = trimToWords(summary, MAX_WORDS);

    // REGENERATE if:
    // - too short (bad summary)
    // - copied from article
    if (wordCount(summary) < 15 || looksCopied(summary, clean)) {
      const secondTry = await generateSummary(clean);
      summary = trimToWords(secondTry, MAX_WORDS);

      // If still bad → fallback rewrite method
      if (wordCount(summary) < 12 || looksCopied(summary, clean)) {
        // final safe fallback: compress manually
        const words = normalizeWhitespace(clean).split(" ").slice(0, MAX_WORDS);
        return words.join(" ");
      }
    }

    return summary;
  } catch (err) {
    // Last-resort fallback: trimmed article
    return trimToWords(clean, MAX_WORDS);
  }
}
