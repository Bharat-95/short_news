// lib/utils/normalize.ts

/** Remove HTML tags */
export function stripHtml(input?: string | null) {
  if (!input) return "";
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapse excessive whitespace */
export function normalizeWhitespace(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/** Trim to specific number of words */
export function trimToWords(text: string, maxWords: number) {
  if (!text) return "";
  const words = normalizeWhitespace(text).split(" ");
  return words.slice(0, maxWords).join(" ");
}

/** Return first N words */
export function firstNWords(text: string, n: number) {
  return normalizeWhitespace(text).split(" ").slice(0, n).join(" ");
}

/** Fully clean & sanitize extracted article text */
export function cleanText(s?: string | null) {
  if (!s) return "";

  const cleaned = stripHtml(s)
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")  // smart quotes
    .replace(/[^a-zA-Z0-9\s.,!?'"-]/g, " ")     // keep readable chars
    .replace(/\s+/g, " ")                       // collapse spaces
    .trim();

  return cleaned;
}
