// lib/summarizer.ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/* ---------------------- UTILITIES ---------------------- */

function stripHtml(input?: string | null): string {
  if (!input) return "";
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export function trimToWords(text: string, maxWords: number) {
  const words = normalize(text).split(" ");
  return words.slice(0, maxWords).join(" ").trim();
}

/* ---------------------- SUMMARY (MAX 45 WORDS) ---------------------- */

export async function summarizeText(text: string): Promise<string> {
  const clean = stripHtml(text).slice(0, 6000);

  const system = `
You summarize news in MAX 45 words.
Write 1 short paragraph.
No ellipsis (...).
No filler.
Keep punctuation natural.
Do NOT rewrite proper names.
`;

  const user = `Summarize the following into MAX 45 words:\n\n${clean}`;

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 150,
      temperature: 0.25,
    });

    let summary = normalize(res.choices?.[0]?.message?.content || "");

    // Remove ellipsis
    summary = summary.replace(/\.\.\.$/, "").trim();

    // Ensure max 45 words
    summary = trimToWords(summary, 45);

    return summary;
  } catch {
    return trimToWords(clean, 45);
  }
}

/* ---------------------- CATEGORY CLASSIFIER ---------------------- */

export async function classifyCategory(text: string): Promise<string> {
  const clean = stripHtml(text).slice(0, 4000);

  const prompt = `
Classify this news into one category ONLY:

India, Business, Politics, Sports, Technology, Startups, Entertainment,
International, Automobile, Science, Travel, Miscellaneous, Fashion,
Education, Health & Fitness.

Text: ${clean}

Respond with ONLY the category.`;

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 10,
      temperature: 0,
    });

    return (res.choices?.[0]?.message?.content || "Miscellaneous").trim();
  } catch {
    return "Miscellaneous";
  }
}

/* ---------------------- HEADLINE GENERATOR ---------------------- */

export async function generateHeadline(text: string) {
  const clean = stripHtml(text).slice(0, 2000);

  const system = `
Return ONLY valid JSON:
{"headline":"...", "subheadline":"..."}
Headline: 2–3 words
Subheadline: 2–3 words`;

  const user = `Article:\n${clean}`;

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 60,
      temperature: 0.25,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const raw = res.choices?.[0]?.message?.content || "";

    const match = raw.match(/\{[\s\S]*\}/);
    const json = match ? match[0] : raw;

    const parsed = JSON.parse(json);

    return {
      headline: trimToWords(parsed.headline || "News Update", 3),
      subheadline: trimToWords(parsed.subheadline || "More Details", 3),
    };
  } catch {
    return {
      headline: "News Update",
      subheadline: "More details",
    };
  }
}
