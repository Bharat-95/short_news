import { normalizeWhitespace } from "./normalize";

export function trimToWords(text: string, maxWords: number) {
  if (!text) return "";
  const words = normalizeWhitespace(text).split(" ");
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

export function firstNWords(text: string, n: number) {
  return normalizeWhitespace(text).split(" ").slice(0, n).join(" ");
}
