// lib/news/summarizer.ts
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/** REMOVE HTML */
function stripHtml(text: string) {
  if (!text) return "";
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop extra spaces */
function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/** Hard limit words ≤ 45 */
function trimTo45(text: string) {
  const words = normalize(text).split(" ");
  return words.slice(0, 45).join(" ");
}

//
// ✨ FINAL PRODUCTION SUMMARIZER
// French + English supported
// Never over 45 words
// No ellipsis
// Clean and readable
//
export async function summarizeText(text: string): Promise<string> {
  const clean = stripHtml(text);

  const systemPrompt = `
You summarize news professionally.
Write a short summary in **maximum 45 words** (never exceed).
Use natural French or English depending on input.
Do NOT add ellipses (...).
Do NOT break sentences unnaturally.
Return one clean paragraph.
  `;

  const userPrompt = `Summarize in max 45 words:\n\n${clean}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 140,
      temperature: 0.2
    });

    let summary = normalize(completion.choices[0].message.content || "");

    // enforce 45-word max
    summary = trimTo45(summary);

    // final cleanup
    summary = summary.replace(/\.\.\.$/, "").trim();

    return summary;
  } catch (err) {
    return trimTo45(clean);
  }
}
