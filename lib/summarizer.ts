// lib/summarizer.ts
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* -----------------------------------------------------------
   UTILITIES
----------------------------------------------------------- */

function stripHtml(input?: string | null) {
  if (!input) return "";
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

// FIXED: No "..." addition
function trimToWords(text: string, maxWords: number) {
  if (!text) return "";
  const words = normalizeWhitespace(text).split(" ");
  return words.slice(0, maxWords).join(" ");
}

/* -----------------------------------------------------------
   SUMMARIZER (EXACTLY 45 WORDS)
----------------------------------------------------------- */

export async function summarizeText(text: string): Promise<string> {
  const clean = stripHtml(text);

  const systemPrompt = `
You are a news summarizer.
Write a concise summary of the text.
Target: 40–45 words.
It is OK if it is between 38 and 48 words.
Always end with a complete sentence.
Never copy the whole article.
  `;

  const userPrompt = `Text:\n${clean}\n\nWrite summary now.`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 200, // <-- FIXED (100 was too small)
      temperature: 0.2,
    });

    let summary = completion.choices?.[0]?.message?.content || "";
    summary = normalizeWhitespace(summary);

    // Soft word check
    const words = summary.split(/\s+/);

    if (words.length > 48) {
      // Trim to max 45–48 words, cut cleanly
      const trimmed = words.slice(0, 45).join(" ");
      const lastPeriod = trimmed.lastIndexOf(".");
      if (lastPeriod !== -1) summary = trimmed.slice(0, lastPeriod + 1);
      else summary = trimmed + ".";
    }

    // Guarantee a period
    if (!summary.endsWith(".")) summary += ".";

    return summary;
  } catch (err) {
    // Fallback extract first 40 words
    return clean.split(/\s+/).slice(0, 40).join(" ") + "...";
  }
}


/* -----------------------------------------------------------
   CATEGORY CLASSIFIER
----------------------------------------------------------- */

export async function classifyCategory(text: string): Promise<string> {
  const clean = stripHtml(text);

  const prompt = `Classify this news into exactly ONE category:

India, Business, Politics, Sports, Technology, Startups, Entertainment,
International, Automobile, Science, Travel, Miscellaneous,
Fashion, Education, Health & Fitness.

News: ${clean}

Respond with ONLY the category name.`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 20,
      temperature: 0.0,
    });

    const out =
      completion.choices?.[0]?.message?.content?.trim() || "Miscellaneous";

    return out.split("\n")[0].trim();
  } catch {
    return "Miscellaneous";
  }
}

/* -----------------------------------------------------------
   HEADLINE GENERATOR (2–3 WORDS)
----------------------------------------------------------- */

export async function generateHeadline(
  text: string
): Promise<{ headline: string; subheadline: string }> {
  const clean = stripHtml(text).slice(0, 4000);

  const system = `You are a professional news editor.
Return ONLY valid JSON: {"headline":"...","subheadline":"..."}.
Headline: 2-3 words.
Subheadline: 2-3 words.
No extra explanations.`;

  const user = `Article:\n\n${clean}\n\nReturn JSON ONLY.`;

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

    // Extract JSON
    let parsed: any = null;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      const jsonText = match ? match[0] : raw;
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = null;
    }

    const sanitize = (s: any) =>
      (s ? String(s).replace(/["{}]/g, "").trim() : "").trim();

    let headline = sanitize(parsed?.headline || "");
    let subheadline = sanitize(parsed?.subheadline || "");

    const wordCount = (s: string) =>
      s.split(/\s+/).filter(Boolean).length || 0;

    const firstN = (src: string, n: number) =>
      normalizeWhitespace(src).split(" ").slice(0, n).join(" ");

    /* Headline rules */
    if (!headline) headline = firstN(clean, 3);
    if (wordCount(headline) > 3) headline = firstN(headline, 3);
    if (wordCount(headline) < 2)
      headline = firstN(clean, 2) || "News Update";

    /* Subheadline rules */
    if (!subheadline) {
      const firstSentence = clean.split(".")[0];
      subheadline = firstN(firstSentence, 3);
    }
    if (wordCount(subheadline) > 3) subheadline = firstN(subheadline, 3);
    if (wordCount(subheadline) < 2)
      subheadline = firstN(clean, 2) || "Details";

    /* Final sanitize */
    headline = trimToWords(
      headline.replace(/[\n\r]+/g, " ").trim(),
      3
    );
    subheadline = trimToWords(
      subheadline.replace(/[\n\r]+/g, " ").trim(),
      3
    );

    if (!headline) headline = "News Update";
    if (!subheadline) subheadline = "Details inside";

    return { headline, subheadline };
  } catch (err) {
    return { headline: "News Update", subheadline: "Details inside" };
  }
}
