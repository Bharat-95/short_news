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
You are an expert multilingual news summarizer. You produce complete, well-written summaries in the same language as the source text. Your summaries are factual, rewritten, and never copy wording from the original.

Rules:
- Maximum 60 words.
- One paragraph.
- No copying from the article.
- No ellipses or unfinished sentences.
- Must end cleanly with a full stop.
- Language must match the article (English → English, French → French).
`;

  const userPrompt = `
Summarize the following news article in no more than 60 words. Rewrite completely and ensure the summary ends cleanly:

${clean}
`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 200,
    presence_penalty: 1.0,
    frequency_penalty: 1.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });

  let out = normalizeWhitespace(response.choices?.[0]?.message?.content || "");
  if (!out.endsWith(".")) out += ".";
  return out;
}

export async function summarizeNews(rawText: string): Promise<string> {
  const clean = stripHtml(rawText).slice(0, 9000);

  try {
    let summary = await generateSummary(clean);
    summary = trimToWords(summary, MAX_WORDS);
    if (!summary.endsWith(".")) summary += ".";

    if (wordCount(summary) < 18 || looksCopied(summary, clean)) {
      let retry = await generateSummary(clean);
      retry = trimToWords(retry, MAX_WORDS);
      if (!retry.endsWith(".")) retry += ".";

      if (wordCount(retry) < 18 || looksCopied(retry, clean)) {
        let fallback = trimToWords(clean, MAX_WORDS);
        if (!fallback.endsWith(".")) fallback += ".";
        return fallback;
      }

      return retry;
    }

    return summary;
  } catch {
    let fallback = trimToWords(clean, MAX_WORDS);
    if (!fallback.endsWith(".")) fallback += ".";
    return fallback;
  }
}
