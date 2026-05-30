// lib/services/headline.ts
import OpenAI from "openai";
import { decodeHtmlEntities, stripHtml, normalizeWhitespace } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function firstN(text: string, n: number) {
  return normalizeWhitespace(text).split(" ").slice(0, n).join(" ");
}

function cleanHeadlineText(text: string) {
  return decodeHtmlEntities(text)
    .replace(/\s*-\s*india today$/i, "")
    .replace(/\s*-\s*[^-]+$/i, "")
    .replace(/[^a-zA-ZÀ-ÿ0-9\s,'"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHeadlineWords(text: string, count: number) {
  const cleaned = cleanHeadlineText(text);
  return firstN(cleaned, count);
}

export async function generateHeadline(text: string) {
  const clean = decodeHtmlEntities(stripHtml(text)).slice(0, 2000);

  const system = `
You are a news editor.  
Return ONLY JSON:
{ "headline": "...", "subheadline": "..." }

Rules:
- Headline: 5 to 8 words, summarizing the main news event in an engaging and accurate way.
- Subheadline: 6 to 12 words, providing additional key context.
- Keep it clean, professional, and clear.
- No emojis.
`;

  const user = `Create headline + subheadline:\n${clean}`;

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 120,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const raw = res.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const obj =
      jsonMatch ? JSON.parse(jsonMatch[0]) : { headline: "", subheadline: "" };

    const headline = cleanHeadlineWords(obj.headline || clean, 8);
    const subheadline = cleanHeadlineWords(obj.subheadline || clean, 12);

    return { headline, subheadline };
  } catch {
    return {
      headline: cleanHeadlineWords(clean, 8),
      subheadline: cleanHeadlineWords(clean, 12),
    };
  }
}
