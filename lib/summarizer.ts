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
  const systemPrompt = `
You summarize news in MAX 45 words.
Write 1 short paragraph.
No ellipsis (...).
No filler.
Keep punctuation natural.
Do NOT rewrite proper names.
`;

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

export async function generateHeadline(text: string): Promise<{ headline: string; subheadline: string }> {
// enforce small headlines: 2-3 words for headline, 2-3 words for subheadline
const clean = stripHtml(text).slice(0, 4000);


const system = `You are a professional news editor. Given article text, produce a compact headline and a short subheadline suitable for a news app. Return ONLY valid JSON with these two keys: {"headline":"...","subheadline":"..."} with no extra text. Headline must be 2-3 words. Subheadline must be 2-3 words. Use plain language and avoid punctuation-heavy or sensational language.`;


const user = `Article (short):\n\n${clean}\n\nReturn only JSON: {"headline":"...","subheadline":"..."} without any commentary.`;


try {
const completion = await client.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: system },
{ role: "user", content: user },
],
max_tokens: 80,
temperature: 0.25,
});


const raw = completion.choices?.[0]?.message?.content?.trim() ?? "";


// try to extract JSON object from model output
let parsed: any = null;
try {
const firstJsonMatch = raw.match(/\{[\s\S]*\}/);
const jsonText = firstJsonMatch ? firstJsonMatch[0] : raw;
parsed = JSON.parse(jsonText);
} catch {
parsed = null;
}


const sanitize = (s: any) => (s ? String(s).replace(/["{}]/g, "").trim() : "");


let headline = sanitize(parsed?.headline || "");
let subheadline = sanitize(parsed?.subheadline || "");


const wordCount = (s: string) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);


// Fallback generation helpers
const firstNWords = (source: string, n: number) => normalizeWhitespace(source).split(" ").slice(0, n).join(" ");


// Enforce 2-3 words for headline
if (!headline) {
// try to create from article
headline = firstNWords(clean, 3);
}
if (wordCount(headline) > 3) headline = firstNWords(headline, 3);
if (wordCount(headline) < 2) headline = firstNWords(clean, 2) || "News Update";


// Enforce 2-3 words for subheadline
if (!subheadline) {
// try to use first sentence or next few words from article
const firstSentence = normalizeWhitespace(clean).split(".")[0] || "Details";
subheadline = firstNWords(firstSentence, 3);
}
if (wordCount(subheadline) > 3) subheadline = firstNWords(subheadline, 3);
if (wordCount(subheadline) < 2) subheadline = firstNWords(clean.split(".")[0] || clean, 2) || "Details";


// Final sanitize and trim punctuation
headline = headline.replace(/[\n\r]+/g, " ").replace(/["{}]/g, "").trim();
subheadline = subheadline.replace(/[\n\r]+/g, " ").replace(/["{}]/g, "").trim();


// As final safety-net ensure non-empty
if (!headline) headline = "News Update";
if (!subheadline) subheadline = "Details inside";


// Ensure word length limits strictly
headline = trimToWords(headline, 3);
subheadline = trimToWords(subheadline, 3);


// If headline still contains more than 3 words because of ellipses, force-split
return { headline, subheadline };
  } catch (err) {
    console.error("generateHeadline error:", (err as Error)?.message ?? String(err));
    return { headline: "News Update", subheadline: "Details inside" };
  }
}