// lib/services/categoryMap.ts

export const ALLOWED_CATEGORIES = [
  "Business",
  "Politics",
  "Sports",
  "Technology",
  "Startups",
  "Entertainment",
  "International",
  "Automobile",
  "Science",
  "Travel",
  "Miscellaneous",
  "Fashion",
  "Education",
  "Health & Fitness",
  "Good News",
  "Timeline",
];

/**
 * Fuzzy map model output → allowed category
 */
export function mapToAllowedCategory(raw?: string | null): string {
  if (!raw) return "Miscellaneous";
  const r = String(raw).toLowerCase();

  // exact match
  for (const c of ALLOWED_CATEGORIES) {
    if (c.toLowerCase() === r) return c;
  }

  // fuzzy includes
  for (const c of ALLOWED_CATEGORIES) {
    if (r.includes(c.toLowerCase())) return c;
  }

  // synonyms
  if (r.includes("polit")) return "Politics";
  if (r.includes("sport")) return "Sports";
  if (r.includes("tech")) return "Technology";
  if (r.includes("start")) return "Startups";
  if (r.includes("enter")) return "Entertainment";
  if (r.includes("inter")) return "International";
  if (r.includes("auto")) return "Automobile";
  if (r.includes("sci")) return "Science";
  if (r.includes("travel")) return "Travel";
  if (r.includes("fashion")) return "Fashion";

  return "Miscellaneous";
}
