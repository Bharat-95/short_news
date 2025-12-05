// General shared types

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
  pub_date?: string | null;
}
