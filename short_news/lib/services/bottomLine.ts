import OpenAI from "openai";
import { decodeHtmlEntities, normalizeWhitespace, stripHtml } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function sanitizeBottomLine(text: string) {
  return normalizeWhitespace(text)
    .replace(/^\s*[•\-–—]+\s*/, "")
    .replace(/[“”"`]+/g, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([.!?]){2,}$/g, "$1")
    .trim();
}

function trimIncompleteBottomLine(text: string) {
  const trailing = new Set([
    "a",
    "an",
    "the",
    "to",
    "for",
    "with",
    "on",
    "in",
    "at",
    "from",
    "after",
    "before",
    "during",
    "outside",
    "inside",
    "into",
    "over",
    "under",
    "of",
    "and",
    "or",
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

function finalizeBottomLine(text: string) {
  const cleaned = trimIncompleteBottomLine(sanitizeBottomLine(text));
  if (!cleaned) return "Tap to know more";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function fallbackBottomLine(text: string) {
  const sentence = decodeHtmlEntities(normalizeWhitespace(text))
    .replace(/\s*-\s*india today$/i, "")
    .replace(/\s*-\s*[^-]+$/i, "")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .find((part) => part.length > 40);

  if (!sentence) return "Tap to know more";

  const words = sentence.split(" ").slice(0, 14).join(" ");
  return finalizeBottomLine(words);
}

export async function generateBottomLine(text: string) {
  const clean = decodeHtmlEntities(stripHtml(text))
    .replace(/\s*-\s*india today$/i, "")
    .replace(/\s*-\s*[^-]+$/i, "")
    .slice(0, 1800);

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 50,
      messages: [
        {
          role: "system",
          content: `
You create a short mobile news bottom strip.
Return ONLY one line of text.
Rules:
- 8 to 14 words
- Natural sentence or phrase
- No emojis
- No hashtags
- No quotes
- Must feel like a teaser for the article
`,
        },
        {
          role: "user",
          content: `Create one bottom line for this story:\n${clean}`,
        },
      ],
    });

    const output = normalizeWhitespace(res.choices?.[0]?.message?.content || "");
    if (!output) return fallbackBottomLine(clean);

    const words = sanitizeBottomLine(output)
      .split(" ")
      .slice(0, 14)
      .join(" ")
      .trim();
    return finalizeBottomLine(words);
  } catch {
    return fallbackBottomLine(clean);
  }
}
