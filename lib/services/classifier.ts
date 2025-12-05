// lib/services/classifier.ts
import OpenAI from "openai";
import { stripHtml } from "../utils/normalize";
import { mapToAllowedCategory } from "./categoryMap";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function classifyNews(text: string): Promise<string> {
  const clean = stripHtml(text).slice(0, 4000);

  const prompt = `
Classify the following news into EXACTLY one category:
India, Business, Politics, Sports, Technology, Startups, Entertainment,
International, Automobile, Science, Travel, Miscellaneous, Fashion,
Education, Health & Fitness, Good News, Timeline.

Return ONLY the category name.

NEWS:
${clean}
`;

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.0,
      max_tokens: 20,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() || "";
    return mapToAllowedCategory(raw);
  } catch (err) {
    return "Miscellaneous";
  }
}
