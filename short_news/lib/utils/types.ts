// General shared types

export type NewsTable = "news_articles" | "uae_news" | "indian_news";

export interface NewsSourceConfig {
  source: string;
  base: string;
  rss: string;
}

export interface ArticleCandidate {
  url: string;
  source: string;

  title?: string;
  description?: string;
  image?: string | null;
  pubDate?: string | null;

  fullText?: string | null;
}

export interface ExtractedArticle {
  title: string;
  description: string;
  image: string | null;
  pubDate: string | null;
  fullText: string;
}

export interface FinalArticlePayload {
  title: string;
  summary: string;
  image_url: string | null;
  source_url: string;
  source: string;
  topics: string;
  categories: string[];
  headline: {
    headline: string;
    subheadline: string;
  };
  bottom_line?: string | null;
  pub_date?: string | null;
}
