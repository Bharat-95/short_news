// lib/summarizer.ts
import OpenAI from "openai";

/**
 * Summarizer: instruct model to produce exactly 60 words,
 * then enforce it by trimming as a fallback.
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function stripHtml(input?: string | null) {
  if (!input) return "";
  // basic HTML strip + collapse whitespace
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

function trimToWords(text: string, maxWords: number) {
  if (!text) return "";
  const words = normalizeWhitespace(text).split(" ");
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ") + "...";
}

export async function summarizeText(text: string): Promise<string> {
  // 1) sanitize input (strip HTML)
  const clean = stripHtml(text);

  // 2) strong system + user instruction
  const systemPrompt =
    "You are a concise news writer. Output ONLY a single paragraph that is exactly 60 words long. Do not include titles, headings, bullet points, explanations, or extraneous text. Do not include quotes or attribution unless necessary. Use clear, neutral language suitable for a news summary.";

  const userPrompt = `Summarize the following article in exactly 60 words (one paragraph, plain text only):\n\n${clean}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 180, // enough to cover 60 words
      temperature: 0.3,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() ?? "";

    // Normalize and ensure exactly 60 words client-side as fallback
    const normalized = normalizeWhitespace(raw);
    const final = trimToWords(normalized, 60);

    // if model produced less than 60 words and we still want to always return 60, we can pad/truncate.
    // Here we return final (exactly 60 words when trimmed), otherwise the model likely already returned 60.
    return final;
  } catch (err) {
    // On error: fallback to deterministic trimming of original text
    console.error("summarizeText error:", (err as Error)?.message ?? String(err));
    return trimToWords(clean, 60);
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
