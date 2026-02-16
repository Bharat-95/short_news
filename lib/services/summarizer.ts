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

/** Detect language from article text */
function detectLanguage(text: string): "fr" | "en" {
  const lower = text.toLowerCase();

  // simple but HIGHLY reliable for news
  const frenchMarkers = [
    "le ", "la ", "les ", "des ", "une ", "un ",
    "à ", "au ", "aux ", "du ",
    "selon", "ministre", "rapport", "député", "gouvernement",
  ];

  let score = 0;
  frenchMarkers.forEach(m => {
    if (lower.includes(m)) score++;
  });

  return score >= 2 ? "fr" : "en";
}

async function generateSummary(clean: string, lang: "fr" | "en") {

  const system =
    lang === "fr"
      ? `
Vous êtes un journaliste professionnel. 
Réécrivez l'article sous forme de résumé *complet*, *précis* et *totalement reformulé*.

Règles :
- Maximum 60 mots.
- Résumé uniquement en français.
- Aucune copie de phrases du texte original.
- Un seul paragraphe.
- Terminez par un point.
`
      : `
You are a professional journalist. 
Rewrite the article into a *complete*, *accurate* and *fully rewritten* summary.

Rules:
- Maximum 60 words.
- Summary must be in English only.
- No copying any original sentences.
- One paragraph.
- Must end with a period.
`;

  const user =
    lang === "fr"
      ? `
Résumez cet article en MAX 60 mots, en français, totalement réécrit :

${clean}
`
      : `
Summarize this article in MAX 60 words, in English, fully rewritten:

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

  const lang = detectLanguage(clean); // ← ★ Auto language detection

  try {
    let s = await generateSummary(clean, lang);
    s = trimToWords(s, MAX_WORDS);
    if (!s.endsWith(".")) s += ".";

    if (wordCount(s) < 18 || looksCopied(s, clean)) {
      let r = await generateSummary(clean, lang);
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
