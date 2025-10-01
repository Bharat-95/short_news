// lib/fetchers.ts
import axios from "axios";
import * as cheerio from "cheerio";

export interface RawArticle {
  title: string;
  description: string;
  link: string;
  image?: string | null;
  source: string;
  category: string;
  pubDate?: string | null;
}

export async function fetchESPN(limit = 20): Promise<RawArticle[]> {
  const url = "https://www.espncricinfo.com/rss/content/story/feeds/0.xml"; 
  const { data } = await axios.get(url);
  const $ = cheerio.load(data, { xmlMode: true });

  const out: RawArticle[] = [];

  $("item").each((_, el) => {
    const $el = $(el);

    const title = $el.find("title").first().text().trim();
    const link = $el.find("link").first().text().trim();
    const desc = $el.find("description").first().text().trim();

    // ✅ Extract image properly (multiple possible locations)
    const media = $el.find("media\\:content").attr("url");   // <media:content url="...">
    const cover = $el.find("coverImages").first().text().trim(); // <coverImages>...</coverImages>
    const explicit = $el.find("url").first().text().trim();  // sometimes <url> contains image
    const image = media || cover || explicit || null;

    const pubDateText = $el.find("pubDate").first().text().trim();
    const pubDate = pubDateText ? new Date(pubDateText).toISOString() : null;

    if (!title || !link) return;

    out.push({
      title,
      description: desc,
      link,
      image,
      source: "ESPNcricinfo",
      category: "Sports",
      pubDate,
    });
  });

  return out.slice(0, limit);
}
