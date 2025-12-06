import OpenAI from "openai";
import { normalizeWhitespace } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export const CATEGORIES = [
  "Politics",
  "Sports",
  "International",
  "Business",
  "Technology",
  "Science",
  "Automobile",
  "Health & Fitness",
  "Education",
  "Fashion",
  "Entertainment",
  "Travel",
  "Startups",
  "Crime",
  "Weather",
  "Environment",
  "Miscellaneous"
];

export async function classifyNews(text: string): Promise<string> {
  const cleaned = normalizeWhitespace(text);

  // Mauritius-aware rule:
  // If the article is mainly about another country → International
  const internationalKeywords = [
    "u.s.",
    "united states",
    "france",
    "india",
    "china",
    "russia",
    "uk",
    "britain",
    "germany",
    "australia",
    "canada",
    "new york",
    "paris",
    "london",
    "tokyo",
    "dubai"
  ];

  for (const kw of internationalKeywords) {
    if (cleaned.toLowerCase().includes(kw)) {
      return "International";
    }
  }

  const prompt = `
Classify the following Mauritius-related news article into ONE of the categories:

${CATEGORIES.join(", ")}

Return ONLY the category name. No explanation.

Article:
${cleaned}
`;

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 10,
      temperature: 0,
      messages: [{ role: "user", content: prompt }]
    });

    const output = normalizeWhitespace(res.choices[0].message.content || "");

    for (const c of CATEGORIES) {
      if (output.toLowerCase() === c.toLowerCase()) return c;
      if (output.toLowerCase().includes(c.toLowerCase())) return c;
    }

    return "Miscellaneous";
  } catch {
    return "Miscellaneous";
  }
}
