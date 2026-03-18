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
    .replace(/[:;,.!?()[\]"'`]+/g, " ")
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
- Headline: 2-3 words  
- Subheadline: 2-3 words  
- No emojis  
- No punctuation except letters  
`;

  const user = `Create headline + subheadline:\n${clean}`;

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 80,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const raw = res.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const obj =
      jsonMatch ? JSON.parse(jsonMatch[0]) : { headline: "", subheadline: "" };

    // enforce 2-3 words
    const headline = cleanHeadlineWords(obj.headline || clean, 3);
    const subheadline = cleanHeadlineWords(obj.subheadline || clean, 3);

    return { headline, subheadline };
  } catch {
    return {
      headline: cleanHeadlineWords(clean, 3),
      subheadline: cleanHeadlineWords(clean, 3),
    };
  }
}
