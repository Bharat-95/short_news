// lib/summarizer.ts
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function summarizeText(text: string): Promise<string> {
  const prompt = `Summarize the following news article into a crisp 60-word summary:\n\n${text}`;
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini", // lightweight + fast
    messages: [{ role: "user", content: prompt }],
    max_tokens: 120,
  });

  return completion.choices[0].message.content?.trim() || text.slice(0, 250);
}

export async function classifyCategory(text: string): Promise<string> {
  const prompt = `Classify this news into one category: India, Business, Politics, Sports, Technology, Startups, Entertainment, International, Automobile, Science, Travel, Miscellaneous, Fashion, Education, Health & Fitness.\n\nNews: ${text}`;
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 30,
  });
  return completion.choices[0].message.content?.trim() || "Miscellaneous";
}
