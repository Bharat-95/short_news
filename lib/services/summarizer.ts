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
  const system = `
You are a multilingual journalist. 
Rewrite the article into a *complete*, *factual*, *fully rewritten* summary.

Rules:
- Maximum 60 words.
- Same language as the article (English → English, French → French).
- No copying from the article.
- Must end with a full stop.
- One paragraph only.
`;

  const user = `
Summarize this article in MAX 60 words. Rewrite fully and end cleanly:

${clean}
`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 200,
    presence_penalty: 1.0,
    frequency_penalty: 1.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  let out = normalizeWhitespace(res.choices[0].message.content || "");
  if (!out.endsWith(".")) out += ".";
  return out;
}

export async function summarizeNews(rawText: string): Promise<string> {
  const clean = stripHtml(rawText).slice(0, 9000);

  try {
    let s = await generateSummary(clean);
    s = trimToWords(s, MAX_WORDS);
    if (!s.endsWith(".")) s += ".";

    if (wordCount(s) < 18 || looksCopied(s, clean)) {
      let r = await generateSummary(clean);
      r = trimToWords(r, MAX_WORDS);
      if (!r.endsWith(".")) r += ".";

      if (wordCount(r) < 18 || looksCopied(r, clean)) {
        let fallback = trimToWords(clean, MAX_WORDS);
        if (!fallback.endsWith(".")) fallback += ".";
        return fallback;
      }

      return r;
    }

    return s;
  } catch {
    let fallback = trimToWords(clean, MAX_WORDS);
    if (!fallback.endsWith(".")) fallback += ".";
    return fallback;
  }
}
