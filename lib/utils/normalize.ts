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
export function cleanText(input?: string | null) {
  if (!input) return "";

  return stripHtml(input)
    .replace(/[\u0000-\u001F]+/g, " ")   // remove control chars
    .replace(/\s+/g, " ")                // normalize spaces
    .trim();
}
