// lib/services/dedupe.ts
import { supabaseBrowser } from "@/lib/db";
import { normalizeWhitespace } from "../utils/normalize";

function tokenize(s?: string | null) {
  if (!s) return [];
  return normalizeWhitespace(s)
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = tokenize(b);
  if (ta.size === 0 || tb.length === 0) return 0;

  let common = 0;
  for (const tok of tb) {
    if (ta.has(tok)) common++;
  }
  return common / Math.min(ta.size, tb.length);
}

/**
 * Check DB if title already exists (fuzzy)
 */
export async function isDuplicateTitle(
  title: string,
  threshold = 0.55
): Promise<boolean> {
  const { data, error } = await supabaseBrowser
    .from("news_articles")
    .select("title")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error || !data) return false;

  for (const row of data) {
    const ratio = tokenOverlap(title, row.title);
    if (ratio >= threshold) return true;
  }

  return false;
}

/**
 * Check if URL already exists
 */
export async function isDuplicateUrl(url: string): Promise<boolean> {
  const { data } = await supabaseBrowser
    .from("news_articles")
    .select("id")
    .eq("source_url", url)
    .limit(1)
    .maybeSingle();

  return !!data;
}
