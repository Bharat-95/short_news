// lib/utils/normalize.ts

function decodeNumericEntity(entity: string) {
  const isHex = entity.toLowerCase().startsWith("x");
  const value = isHex ? parseInt(entity.slice(1), 16) : parseInt(entity, 10);
  if (Number.isNaN(value)) return null;
  try {
    return String.fromCodePoint(value);
  } catch {
    return null;
  }
}

export function decodeHtmlEntities(input?: string | null) {
  if (!input) return "";

  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    rsquo: "'",
    lsquo: "'",
    ldquo: '"',
    rdquo: '"',
    mdash: "-",
    ndash: "-",
  };

  return input
    .replace(/&#(x?[0-9a-fA-F]+);/g, (_match, entity) => decodeNumericEntity(entity) ?? _match)
    .replace(/&([a-zA-Z]+);/g, (match, entity) => named[entity] ?? match);
}

/** Remove HTML tags */
export function stripHtml(input?: string | null) {
  if (!input) return "";
  return decodeHtmlEntities(input)
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
