import { Router } from "express";
import newsAPI from "../services/newsAPI.ts";
import biasAnalyzer from "../services/biasAnalyzer.ts";
import { db } from "../utils/database.ts";
import type { BiasScores } from "../utils/dataStore.ts";

// Lightweight concurrency mapper
function mapWithConcurrency<T, R>(arr: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(arr.length);
  let i = 0; let active = 0;
  return new Promise((resolve) => {
    const launch = () => {
      if (i >= arr.length && active === 0) return resolve(results);
      while (active < limit && i < arr.length) {
        const idx = i++;
        active++;
        worker(arr[idx], idx)
          .then(r => { results[idx] = r; })
          .catch(e => { console.error('Worker error', e); /* leave hole to indicate failure */ })
          .finally(() => { active--; launch(); });
      }
    };
    launch();
  });
}

const router = Router();

// GET /api/articles - List articles with bias scores
router.get("/", async (req, res) => {
  try {
    const { topic, source, limit = "10" } = req.query as {
      topic?: string;
      source?: string;
      limit?: string;
    };

    const articles = await db.searchArticles(
      topic, 
      source, 
      Math.min(parseInt(limit), 50) // Cap at 50 for performance
    );

    res.json({
      articles,
      total: articles.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching articles:", error);
    res.status(500).json({ error: "Failed to fetch articles" });
  }
});

// GET /api/articles/:id - Detailed article analysis
router.get("/:id", async (req, res) => {
  try {
    const article = await db.getArticleById(req.params.id);

    if (!article) {
      return res.status(404).json({ error: "Article not found" });
    }

    res.json(article);
  } catch (error) {
    console.error("Error fetching article:", error);
    res.status(500).json({ error: "Failed to fetch article details" });
  }
});

// POST /api/articles/:id/rescore - Re-run bias analysis for an existing article
router.post('/:id/rescore', async (req, res) => {
  try {
    const article = await db.getArticleById(req.params.id);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }
    if (!article.content) {
      return res.status(400).json({ error: 'Article has no content to analyze' });
    }
    const newScores = await biasAnalyzer.analyzeArticle(article);
    article.biasScores = newScores;
    await db.saveArticles([article]);
    res.json({ message: 'Article re-scored', article });
  } catch (error) {
    console.error('Error rescoring article:', error);
    res.status(500).json({ error: 'Failed to rescore article' });
  }
});

// POST /api/articles/fetch - Fetch new articles on topic
router.post("/fetch", async (req, res) => {
  try {
    const { topic, sources } = req.body as {
      topic?: string;
      sources?: string[];
    };

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    if (topic.length < 3) {
      return res.status(400).json({ error: "Topic must be at least 3 characters" });
    }

    // Fetch articles from GNews API
    console.log(`Fetching articles about: ${topic}`);
  const newArticles = await newsAPI.fetchArticlesByTopic(topic, sources, 15);
  // Enrich (blocking) to get fuller content before AI analysis for better detail
  await newsAPI.enrichArticles(newArticles, 4);

    if (newArticles.length === 0) {
      return res.status(404).json({ 
        error: "No articles found for this topic",
        topic 
      });
    }

    // Parallel bias analysis (limit concurrency to 3)
  const articlesToAnalyze = newArticles.slice(0, 10);
    console.log(`Analyzing ${articlesToAnalyze.length} articles in parallel...`);
    await mapWithConcurrency(articlesToAnalyze, 3, async (art, idx) => {
      console.log(`Analyzing article ${idx + 1}/${articlesToAnalyze.length}: ${art.headline.substring(0,60)}...`);
      const scores = await biasAnalyzer.analyzeArticle(art);
      art.biasScores = scores;
      if (scores.primarySources?.length) {
        art.primarySources = scores.primarySources;
      }
      return art;
    });
    const analyzedArticles = articlesToAnalyze;

    // Save to database
    await db.saveArticles(analyzedArticles);

    res.json({
      message: `Fetched and analyzed ${analyzedArticles.length} articles`,
      articles: analyzedArticles,
      topic,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching articles:", error);
    res.status(500).json({ 
      error: "Failed to fetch articles",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// POST /api/articles/analyze - Analyze arbitrary URL content or raw text
interface AdHocArticle {
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

router.post('/analyze', async (req, res) => {
  try {
    const { url, content, headline, source } = req.body as { url?: string; content?: string; headline?: string; source?: string };
    let workingContent = content?.trim() || '';
    if ((!workingContent || workingContent.length < 240) && url) {
      // Attempt scrape
      const scraped = await newsAPI.fetchFullArticle(url);
      if (scraped && scraped.length >= 240) {
        workingContent = scraped;
      }
    }
    if (!workingContent || workingContent.length < 50) {
      return res.status(400).json({ error: 'Provide article content (>=50 chars) or a URL that can be scraped' });
    }
  const article: AdHocArticle = {
      id: `ad-hoc-${Date.now().toString(36)}`,
  // Use provided headline or derive from workingContent (not raw potentially undefined content)
  headline: headline || (workingContent.length > 80 ? workingContent.substring(0, 80) + '...' : workingContent),
      content: workingContent,
      description: '',
      source: source || 'user-submitted',
      author: 'unknown',
      publishedAt: new Date().toISOString(),
      url: url || '',
      urlToImage: '',
      biasScores: null,
      narrativeCluster: null,
      primarySources: [] as string[]
    };
    const scores = await biasAnalyzer.analyzeArticle(article);
  article.biasScores = scores;
    if (scores.primarySources?.length) article.primarySources = scores.primarySources;
    res.json({ article });
  } catch (e) {
    console.error('Ad-hoc analysis error', e);
    res.status(500).json({ error: 'Failed to analyze article' });
  }
});

// GET /api/articles/diagnostics - Summary of analysis statuses
router.get('/diagnostics/status', async (_req, res) => {
  try {
    const articles = await db.loadArticles();
    const summary = articles.reduce<Record<string, number>>((acc, a) => {
      const status = a.biasScores?.analysisStatus || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    res.json({ summary, total: articles.length, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('Diagnostics error', e);
    res.status(500).json({ error: 'Failed to build diagnostics' });
  }
});

export default router;
