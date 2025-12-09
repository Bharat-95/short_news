import OpenAI from "openai";
import { normalizeWhitespace } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export const CATEGORY_LABELS = [
  "Politics",
  "Business",
  "Economy",
  "Tourism",
  "Crime",
  "Accident",
  "Sports",
  "Technology",
  "Health",
  "Education",
  "Environment",
  "Weather",
  "International",
  "Entertainment",
  "Lifestyle",
  "Traffic",
  "Miscellaneous"
];

export async function classifyNews(text: string): Promise<string> {
  const clean = normalizeWhitespace(text).slice(0, 6000);

  const system = `
You are a senior news classifier for Mauritius.
Classify the news into the SINGLE best category.
ALWAYS choose the clearest topic.
NEVER answer "Miscellaneous" unless no category fits.
Return ONLY the category name.
These are the allowed categories:

${CATEGORY_LABELS.join(", ")}
`;

  const user = `
News:
${clean}
`;

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 20,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
    });

    const output = normalizeWhitespace(res.choices[0].message.content || "");

    for (const c of CATEGORY_LABELS) {
      if (output.toLowerCase().includes(c.toLowerCase())) {
        return c;
      }
    }

    return "Miscellaneous";
  } catch {
    return "Miscellaneous";
  }
}

