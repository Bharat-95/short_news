import OpenAI from "openai";
import { stripHtml, normalizeWhitespace } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const MIN_POINTS = 4;
const MAX_POINTS = 5;
const MAX_INPUT_CHARS = 9000;
const MAX_WORDS_PER_POINT = 26;

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
  return first.length > 20 && a.includes(first);
}

function isPublishMeta(line: string) {
  const l = normalizeWhitespace(line).toLowerCase();

  // Common publication metadata patterns (English/French + generic)
  return (
    /^published\b/.test(l) ||
    /^updated\b/.test(l) ||
    /^posted\b/.test(l) ||
    /^publié\b/.test(l) ||
    /^publiée\b/.test(l) ||
    /^mis à jour\b/.test(l) ||
    /\bpublished by\b/.test(l) ||
    /\bpublished at\b/.test(l) ||
    /\bpublié par\b/.test(l) ||
    /\bpublié le\b/.test(l) ||
    /\bmis à jour le\b/.test(l)
  );
}

function removePublishMeta(text: string) {
  const lines = text.split(/\r?\n/);

  const cleaned = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isPublishMeta(line));

  let out = cleaned.join("\n");

  // Remove inline leading publication tag if present in first sentence
  out = out.replace(
    /^(published|updated|posted|publié|publiée|mis à jour)\b[^.\n]{0,180}[.\n:]\s*/i,
    ""
  );

  return normalizeWhitespace(out);
}

/** Detect language from article text */
function detectLanguage(text: string): "fr" | "en" {
  const lower = text.toLowerCase();

  const frenchMarkers = [
    " le ",
    " la ",
    " les ",
    " des ",
    " une ",
    " un ",
    " à ",
    " au ",
    " aux ",
    " du ",
    " selon ",
    " ministre ",
    " rapport ",
    " député ",
    " gouvernement ",
  ];

  let score = 0;
  frenchMarkers.forEach((m) => {
    if (lower.includes(m)) score++;
  });

  return score >= 2 ? "fr" : "en";
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => normalizeWhitespace(s))
    .filter(Boolean);
}

function normalizeBullets(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => normalizeWhitespace(l))
    .filter(Boolean);

  const bullets: string[] = [];

  for (const line of lines) {
    const cleaned = line.replace(/^(\d+[\).\-\s]+|[-•*]\s*)/, "").trim();
    if (!cleaned) continue;
    if (isPublishMeta(cleaned)) continue;

    const trimmed = trimToWords(cleaned, MAX_WORDS_PER_POINT);
    const withDot = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    bullets.push(withDot);
  }

  return bullets;
}

function formatBulletList(points: string[]) {
  return points.map((p) => `- ${p}`).join("\n");
}

function fallbackPoints(clean: string): string {
  const sentences = splitSentences(clean).filter((s) => !isPublishMeta(s));

  const selected: string[] = [];
  for (const s of sentences) {
    if (selected.length >= MAX_POINTS) break;
    if (wordCount(s) < 6) continue;
    selected.push(trimToWords(s, MAX_WORDS_PER_POINT));
  }

  // Ensure at least 4 points
  if (selected.length < MIN_POINTS) {
    const words = normalizeWhitespace(clean).split(" ").filter(Boolean);
    const chunkSize = Math.max(12, Math.floor(words.length / MIN_POINTS));
    while (selected.length < MIN_POINTS && words.length) {
      const chunk = words.splice(0, chunkSize).join(" ");
      if (!chunk) break;
      selected.push(trimToWords(chunk, MAX_WORDS_PER_POINT));
    }
  }

  const finalPoints = selected.slice(0, MAX_POINTS).map((p) => {
    const t = normalizeWhitespace(p);
    return /[.!?]$/.test(t) ? t : `${t}.`;
  });

  return formatBulletList(finalPoints);
}

async function generateSummaryPoints(
  clean: string,
  lang: "fr" | "en"
): Promise<string> {
  const system =
    lang === "fr"
      ? `
Vous êtes un journaliste professionnel.
Résumez l'article en 4 à 5 points clairs.

Règles strictes :
- Répondez uniquement en français.
- 4 à 5 puces (format "- ").
- Chaque puce doit être reformulée (pas de copie de phrase).
- N'incluez jamais "Publié", "Publié par", "Publié à", dates de publication, auteur, ou métadonnées.
- Chaque puce doit se terminer par un point.
`
      : `
You are a professional journalist.
Summarize the article into 4 to 5 clear bullet points.

Strict rules:
- Reply only in English.
- 4 to 5 bullets (format "- ").
- Each bullet must be rewritten (no copied sentence).
- Never include "Published", "Published by", "Published at", publication date/time, author line, or metadata.
- Every bullet must end with a period.
`;

  const user =
    lang === "fr"
      ? `Résumez cet article en 4 à 5 points, totalement reformulés :\n\n${clean}`
      : `Summarize this article in 4 to 5 fully rewritten bullet points:\n\n${clean}`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.35,
    max_tokens: 350,
    presence_penalty: 0.8,
    frequency_penalty: 1.0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const out = normalizeWhitespace(res.choices[0].message.content || "");
  const points = normalizeBullets(out).slice(0, MAX_POINTS);
  return formatBulletList(points);
}

function isValidPointSummary(summary: string, source: string): boolean {
  const points = summary
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));

  if (points.length < MIN_POINTS || points.length > MAX_POINTS) return false;

  for (const p of points) {
    const plain = p.replace(/^- /, "").trim();
    if (wordCount(plain) < 5) return false;
    if (isPublishMeta(plain)) return false;
    if (looksCopied(plain, source)) return false;
  }

  return true;
}

export async function summarizeNews(rawText: string): Promise<string> {
  const cleaned = removePublishMeta(stripHtml(rawText));
  const clean = cleaned.slice(0, MAX_INPUT_CHARS);

  const lang = detectLanguage(clean);

  try {
    let s = await generateSummaryPoints(clean, lang);

    if (!isValidPointSummary(s, clean)) {
      let r = await generateSummaryPoints(clean, lang);
      if (isValidPointSummary(r, clean)) return r;
      return fallbackPoints(clean);
    }

    return s;
  } catch {
    return fallbackPoints(clean);
  }
}
