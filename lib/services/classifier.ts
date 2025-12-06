import OpenAI from "openai";
import { normalizeWhitespace } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const CATEGORIES = [
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
  const prompt = `
Classify the following news article into the SINGLE best category.
Return only one of these exact labels:

${CATEGORIES.join(", ")}

Article:
${normalizeWhitespace(text)}
`;

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 10,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    const output = normalizeWhitespace(res.choices[0].message.content || "");

    for (const c of CATEGORIES) {
      if (output.toLowerCase().includes(c.toLowerCase())) return c;
    }

    return "Miscellaneous";
  } catch (e) {
    return "Miscellaneous";
  }
}
