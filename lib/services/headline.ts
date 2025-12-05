// lib/services/headline.ts
import OpenAI from "openai";
import { stripHtml, normalizeWhitespace } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function firstN(text: string, n: number) {
  return normalizeWhitespace(text).split(" ").slice(0, n).join(" ");
}

export async function generateHeadline(text: string) {
  const clean = stripHtml(text).slice(0, 2000);

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
    let obj =
      jsonMatch ? JSON.parse(jsonMatch[0]) : { headline: "", subheadline: "" };

    // enforce 2-3 words
    let headline = firstN(obj.headline || clean, 3);
    let subheadline = firstN(obj.subheadline || clean, 3);

    return { headline, subheadline };
  } catch {
    return {
      headline: firstN(clean, 3),
      subheadline: firstN(clean, 3),
    };
  }
}
