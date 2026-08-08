export type ArticleOrchestrationJob = {
  article_ids: string[];
  query_id: string;
  user_id: string;
  tldr_lang?: string;
  skip_relevance_gate?: boolean;
};
