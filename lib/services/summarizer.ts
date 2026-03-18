import OpenAI from "openai";
import { stripHtml, normalizeWhitespace } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MIN_BULLETS = 4;
const MAX_BULLETS = 4;
const MAX_WORDS_PER_BULLET = 28;

function protectAbbreviations(text: string) {
  return text
    .replace(/\ba\.m\./gi, (m) => m.replace(/\./g, "__DOT__"))
    .replace(/\bp\.m\./gi, (m) => m.replace(/\./g, "__DOT__"))
    .replace(/\bmr\./gi, (m) => m.replace(/\./g, "__DOT__"))
    .replace(/\bmrs\./gi, (m) => m.replace(/\./g, "__DOT__"))
    .replace(/\bms\./gi, (m) => m.replace(/\./g, "__DOT__"))
    .replace(/\bdr\./gi, (m) => m.replace(/\./g, "__DOT__"))
    .replace(/\bprof\./gi, (m) => m.replace(/\./g, "__DOT__"))
    .replace(/\bno\./gi, (m) => m.replace(/\./g, "__DOT__"))
    .replace(/\bu\.s\./gi, (m) => m.replace(/\./g, "__DOT__"))
    .replace(/\bu\.k\./gi, (m) => m.replace(/\./g, "__DOT__"));
}

function restoreAbbreviations(text: string) {
  return text.replace(/__DOT__/g, ".");
}

function trimToWords(text: string, max: number) {
  return normalizeWhitespace(text).split(" ").slice(0, max).join(" ");
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

function stripPublishedNoise(text: string): string {
  return normalizeWhitespace(text)
    .replace(
      /\bpublished\s+\d+\s+\w+\s+ago\s+on\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+by\s+[a-z0-9 .,'-]+/gi,
      " "
    )
    .replace(
      /\bpubli[eé]\s+il\s+y\s+a\s+\d+\s+\w+\s+le\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+par\s+[a-z0-9 .,'-]+/gi,
      " "
    )
    .replace(
      /\bpublished\b[\s\S]{0,120}?\bby\b[\s\S]{0,80}?(?=(published\b|publi[eé]\b|[.!?]|$))/gi,
      " "
    )
    .replace(
      /\bpubli[eé]\b[\s\S]{0,120}?\bpar\b[\s\S]{0,80}?(?=(published\b|publi[eé]\b|[.!?]|$))/gi,
      " "
    )
    .replace(/\bby\s+[a-z0-9 .,'-]+\s+editor\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toBullets(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const extracted = lines
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);

  return extracted;
}

function normalizeBulletKey(text: string) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim();
}

function uniqueBullets(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const key = normalizeBulletKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function normalizeBulletSequence(items: string[]) {
  const merged: string[] = [];
  let carry = "";

  for (const rawItem of items) {
    const item = normalizeWhitespace(`${carry} ${rawItem}`.trim());
    carry = "";
    if (!item) continue;

    const isFragment =
      item.length <= 8 ||
      /^(mr|mrs|ms|dr|prof|shri|smt|k|v|b)\.$/i.test(item) ||
      /^[a-z]\.$/i.test(item);

    if (isFragment) {
      carry = item;
      continue;
    }

    merged.push(item);
  }

  if (carry && merged.length > 0) {
    merged[merged.length - 1] = normalizeWhitespace(`${merged[merged.length - 1]} ${carry}`);
  }

  return merged;
}

function trimIncompleteTail(text: string, lang: "fr" | "en"): string {
  const trailing = lang === "fr"
    ? new Set(["de", "du", "des", "la", "le", "les", "et", "ou", "dans", "sur", "avec", "pour", "par", "en", "été", "avait", "ont"])
    : new Set(["of", "to", "the", "and", "or", "in", "on", "with", "for", "by", "at", "from", "have", "has", "had", "been", "being", "were", "was"]);

  let out = text
    .trim()
    .replace(/^["'`“”‘’.,:;\-()\[\]]+/, "")
    .replace(/[,:;]+$/g, "")
    .trim();
  const words = out.split(" ").filter(Boolean);
  while (
    words.length > 6 &&
    trailing.has(words[words.length - 1].toLowerCase().replace(/[.!?,"'`“”‘’]+$/g, ""))
  ) {
    words.pop();
  }
  out = words.join(" ").trim();
  return out;
}

function finalizeBullet(item: string, lang: "fr" | "en"): string {
  let clean = stripPublishedNoise(normalizeWhitespace(item));
  if (!clean) return "";

  const words = clean.split(" ").filter(Boolean);
  if (words.length > MAX_WORDS_PER_BULLET) {
    const capped = words.slice(0, MAX_WORDS_PER_BULLET).join(" ");
    const punctPositions = [capped.lastIndexOf("."), capped.lastIndexOf("!"), capped.lastIndexOf("?"), capped.lastIndexOf(";"), capped.lastIndexOf(":")];
    const bestPunct = Math.max(...punctPositions);
    clean = bestPunct > Math.floor(capped.length * 0.55) ? capped.slice(0, bestPunct + 1) : capped;
  }

  clean = trimIncompleteTail(clean, lang);
  clean = clean.replace(/^["'`“”‘’]+/, "").trim();
  if (!clean) return "";
  if (!/[.!?]$/.test(clean)) clean += ".";
  return clean;
}

function enforceBulletSummary(raw: string, lang: "fr" | "en"): string {
  const items = normalizeBulletSequence(uniqueBullets(toBullets(raw)));
  const sliced = items
    .map((item) => finalizeBullet(item, lang))
    .filter((item) => item.length > 0);

  return normalizeBulletSequence(uniqueBullets(sliced))
    .slice(0, MAX_BULLETS)
    .map((item) => `• ${item}`)
    .join("\n");
}

function buildFallbackBullets(clean: string, lang: "fr" | "en"): string {
  const protectedText = protectAbbreviations(stripPublishedNoise(clean));
  const fallbackParts = normalizeBulletSequence(uniqueBullets(
    protectedText
    .split(/(?<=[.!?])\s+/)
    .map((part) => normalizeWhitespace(restoreAbbreviations(part)))
    .map((part) => finalizeBullet(part, lang))
    .filter((part) => part.length > 0)
  )).slice(0, MIN_BULLETS);

  const padded = [...fallbackParts];
  while (padded.length < MIN_BULLETS) {
    const fallback = finalizeBullet(trimToWords(clean, MAX_WORDS_PER_BULLET), lang);
    if (fallback) padded.push(fallback);
    else padded.push(lang === "fr" ? "Résumé indisponible." : "Summary unavailable.");
  }

  return normalizeBulletSequence(uniqueBullets(padded))
    .map((line) => finalizeBullet(line, lang))
    .filter((line) => line.length > 0)
    .slice(0, MAX_BULLETS)
    .map((line) => `• ${line}`)
    .join("\n");
}

function hasMalformedBullets(summary: string, lang: "fr" | "en") {
  const bullets = toBullets(summary);
  if (bullets.length < MIN_BULLETS) return true;

  const badTailPatterns =
    lang === "fr"
      ? [
          /\b(selon|avec|pour|dans|sur|par|en|au|aux|du|des|le|la|les)\.$/i,
          /["“][^"”]*$/i,
        ]
      : [
          /\b(to the|to a|according to the|said the|told the|with the|for the|in the|on the)\.$/i,
          /["“][^"”]*$/i,
        ];

  return bullets.some((bullet) => {
    const normalized = normalizeWhitespace(bullet);
    const wordCount = normalized.split(" ").filter(Boolean).length;
    if (wordCount < 5) return true;
    if (/^[^a-zA-ZÀ-ÿ0-9]*$/.test(normalized)) return true;
    if (badTailPatterns.some((pattern) => pattern.test(normalized))) return true;
    return false;
  });
}

async function generateSummary(clean: string, lang: "fr" | "en") {
  const system =
    lang === "fr"
      ? `
Vous êtes un journaliste professionnel. 
Réécrivez l'article sous forme de résumé *complet*, *précis* et *totalement reformulé*.

Règles :
- Répondez avec 4 à 5 puces uniquement, chaque ligne commence par "•".
- Chaque puce doit contenir 8 à 22 mots.
- Résumé uniquement en français.
- Aucune copie de phrases du texte original.
`
      : `
You are a professional journalist. 
Rewrite the article into a *complete*, *accurate* and *fully rewritten* summary.

Rules:
- Return 4 to 5 bullet points only, each line must start with "•".
- Each bullet should be 8 to 22 words.
- Summary must be in English only.
- No copying any original sentences.
`;

  const user =
    lang === "fr"
      ? `
Résumez cet article en 4-5 puces, en français, totalement réécrit :

${clean}
`
      : `
Summarize this article in 4-5 bullet points, in English, fully rewritten:

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

  const raw = res.choices[0].message.content || "";
  return enforceBulletSummary(raw, lang);
}

export async function summarizeNews(rawText: string): Promise<string> {
  const clean = stripPublishedNoise(stripHtml(rawText)).slice(0, 9000);

  const lang = detectLanguage(clean); // ← ★ Auto language detection

  try {
    const s = await generateSummary(clean, lang);
    const enforced = enforceBulletSummary(s, lang);
    const bullets = toBullets(enforced);

    if (bullets.length < MIN_BULLETS || looksCopied(enforced, clean) || hasMalformedBullets(enforced, lang)) {
      const r = await generateSummary(clean, lang);
      const retryEnforced = enforceBulletSummary(r, lang);
      const retryBullets = toBullets(retryEnforced);

      if (
        retryBullets.length < MIN_BULLETS ||
        looksCopied(retryEnforced, clean) ||
        hasMalformedBullets(retryEnforced, lang)
      ) {
        return buildFallbackBullets(clean, lang);
      }

      return retryEnforced;
    }

    return enforced;
  } catch {
    return buildFallbackBullets(clean, lang);
  }
}
