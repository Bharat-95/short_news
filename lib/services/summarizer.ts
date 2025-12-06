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

/** Detect if summary copied article intro */
function looksCopied(summary: string, article: string): boolean {
  const cleanSummary = normalizeWhitespace(summary).toLowerCase();
  const cleanArticle = normalizeWhitespace(article).toLowerCase();

  const firstWords = cleanSummary.split(" ").slice(0, 12).join(" ");
  return cleanArticle.includes(firstWords);
}

/** Core LLM summarizer */
async function generateSummary(clean: string) {
  const systemPrompt = `
You are an expert multilingual news summarizer.
You handle English, French, Creole, and mixed-language articles.

RULES:
- Rewrite the article into a **concise, factual summary**.
- MUST be **fresh wording**, no copying from the article.
- NO MORE THAN 60 WORDS.
- Use the SAME LANGUAGE as the original article (French → French summary).
- ONE paragraph only.
- No ellipses (...), no emojis, no filler.
- Include only the essential facts.
`;

  const userPrompt = `
Summarize the following article in **max 60 words**.
Do NOT copy sentences. Rewrite fully.

Article:
${clean}
`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 160,
    presence_penalty: 0.8,
    frequency_penalty: 1.1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return normalizeWhitespace(response.choices?.[0]?.message?.content || "");
}

/** Main exported summarizer */
export async function summarizeNews(rawText: string): Promise<string> {
  const clean = stripHtml(rawText).slice(0, 8000);

  try {
    // First attempt
    let summary = await generateSummary(clean);
    summary = trimToWords(summary, MAX_WORDS);

    // Regenerate if too short or copied
    if (wordCount(summary) < 15 || looksCopied(summary, clean)) {
      let second = await generateSummary(clean);
      second = trimToWords(second, MAX_WORDS);

      if (wordCount(second) < 12 || looksCopied(second, clean)) {
        // final fallback
        return trimToWords(clean, MAX_WORDS);
      }

      return second;
    }

    return summary;
  } catch (err) {
    return trimToWords(clean, MAX_WORDS);
  }
}
