import OpenAI from "openai";
import { normalizeWhitespace, stripHtml } from "../utils/normalize";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function fallbackBottomLine(text: string) {
  const sentence = normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .find((part) => part.length > 40);

  if (!sentence) return "Tap to know more";

  const words = sentence.split(" ").slice(0, 14).join(" ");
  return words.endsWith(".") ? words : `${words}.`;
}

export async function generateBottomLine(text: string) {
  const clean = stripHtml(text).slice(0, 1800);

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 50,
      messages: [
        {
          role: "system",
          content: `
You create a short mobile news bottom strip.
Return ONLY one line of text.
Rules:
- 8 to 14 words
- Natural sentence or phrase
- No emojis
- No hashtags
- No quotes
- Must feel like a teaser for the article
`,
        },
        {
          role: "user",
          content: `Create one bottom line for this story:\n${clean}`,
        },
      ],
    });

    const output = normalizeWhitespace(res.choices?.[0]?.message?.content || "");
    if (!output) return fallbackBottomLine(clean);

    const words = output.split(" ").slice(0, 14).join(" ");
    return words.endsWith(".") ? words : `${words}.`;
  } catch {
    return fallbackBottomLine(clean);
  }
}
