export interface BiasScore {
  score: number;
  label: string;
  confidence: number;
  highlightedPhrases: string[];
  reasoning: string;
  // Optional confidence interval (derived server-side)
  confidenceInterval?: {
    lower: number;
    upper: number;
    width: number; // upper - lower
  };
}

export interface BiasScores {
  ideologicalStance: BiasScore;
  factualGrounding: BiasScore;
  framingChoices: BiasScore;
  emotionalTone: BiasScore;
  sourceTransparency: BiasScore;
  overallBiasLevel: number;
  primarySources: string[];
  analyzedAt: string;
  analysisStatus?: 'ai' | 'fallback-api' | 'fallback-parse' | 'fallback-empty' ;
  isFallback?: boolean;
}

export interface Article {
  id: string;
  headline: string;
  content: string;
  description: string;
  source: string;
  author: string;
  publishedAt: string;
  url: string;
  urlToImage: string;
  biasScores: BiasScores | null;
  narrativeCluster: string | null;
  primarySources: string[];
}

// Re-export database functions for backward compatibility
import { db } from "./database.ts";
export { db };

export async function loadArticles(): Promise<Article[]> {
  return await db.loadArticles();
}

export async function saveArticles(articles: Article[]) {
  await db.saveArticles(articles);
}
