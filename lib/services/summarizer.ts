import OpenAI from "openai";
import { stripHtml, normalizeWhitespace } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const MAX_WORDS = 60;

function trimToWords(text: string, max: number) {
  return normalizeWhitespace(text).split(" ").slice(0, max).join(" ");
}

function wordCount(text: string) {
  return normalizeWhitespace(text).split(" ").filter(Boolean).length;
}

function looksCopied(summary: string, article: string): boolean {
  const s = normalizeWhitespace(summary).toLowerCase();
  const a = normalizeWhitespace(article).toLowerCase();
  const first = s.split(" ").slice(0, 10).join(" ");
  return a.includes(first);
}

async function generateSummary(clean: string) {
  const systemPrompt = `
You are an expert multilingual news summarizer. You rewrite news in clear, factual language.

Rules:
- Maximum 60 words.
- One paragraph only.
- Rewrite fully; do not copy text.
- Keep the same language as the article (English → English, French → French).
- No ellipses, emojis, filler, or unfinished sentences.
- Always produce a complete, well-formed summary.
`;

  const userPrompt = `
Summarize the following news article in maximum 60 words. Rewrite fully.

${clean}
`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 180,
    presence_penalty: 1.0,
    frequency_penalty: 1.1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });

  return normalizeWhitespace(response.choices?.[0]?.message?.content || "");
}

export async function summarizeNews(rawText: string): Promise<string> {
  const clean = stripHtml(rawText).slice(0, 9000);

  try {
    let summary = await generateSummary(clean);
    summary = trimToWords(summary, MAX_WORDS);

    if (wordCount(summary) < 15 || looksCopied(summary, clean)) {
      let second = await generateSummary(clean);
      second = trimToWords(second, MAX_WORDS);

      if (wordCount(second) < 15 || looksCopied(second, clean)) {
        const fallback = trimToWords(clean, MAX_WORDS);
        return fallback.endsWith(".") ? fallback : fallback + ".";
      }

      return second.endsWith(".") ? second : second + ".";
    }

    return summary.endsWith(".") ? summary : summary + ".";
  } catch {
    const fallback = trimToWords(clean, MAX_WORDS);
    return fallback.endsWith(".") ? fallback : fallback + ".";
  }
}
