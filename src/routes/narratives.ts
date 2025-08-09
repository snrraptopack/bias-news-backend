import { Router } from "express";
import { db } from "../utils/database.ts";
import type { Article } from "../utils/dataStore.ts";

interface NarrativeCluster {
  id: string;
  topic: string;
  framingType: string;
  title: string;
  articles: Article[];
  representativeArticle: Article | null;
  biasDistribution: {
    left: number;
    center: number;
    right: number;
  };
  avgScores: {
    ideologicalStance: number;
    factualGrounding: number;
    framingChoices: number;
    emotionalTone: number;
    sourceTransparency: number;
  };
  commonPhrases: { [key: string]: number };
  sourceCount: { [key: string]: number };
  timeSpan: {
    earliest: Date | null;
    latest: Date | null;
  };
}

const router = Router();

// GET /api/narratives - Get clustered story framings
router.get("/", async (_req, res) => {
  try {
    const articles = await db.loadArticles();
    const clusters = clusterNarratives(articles);

    res.json({
      clusters,
      totalArticles: articles.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching narratives:", error);
    res.status(500).json({ error: "Failed to fetch narratives" });
  }
});

// GET /api/narratives/:clusterId - Get specific narrative cluster details
router.get("/:clusterId", async (req, res) => {
  try {
    const articles = await db.loadArticles();
    const clusters = clusterNarratives(articles);
    const cluster = clusters.find((c) => c.id === req.params.clusterId);

    if (!cluster) {
      return res.status(404).json({ error: "Narrative cluster not found" });
    }

    // Add detailed framing analysis
  const detailedCluster = addFramingAnalysis(cluster);
    res.json(detailedCluster);
  } catch (error) {
    console.error("Error fetching narrative details:", error);
    res.status(500).json({ error: "Failed to fetch narrative details" });
  }
});

// Enhanced narrative clustering with framing detection
function clusterNarratives(articles: Article[]): NarrativeCluster[] {
  const clusters: { [key: string]: NarrativeCluster } = {};

  articles.forEach((article) => {
    if (!article.biasScores) return; // Skip unanalyzed articles

    // Extract key topics and framing phrases
    const topics = extractTopics(article.headline + " " + article.content);
    const primaryTopic = topics[0] || "general";
    const framingType = detectFramingType(article);

    // Create cluster key combining topic and framing
    const clusterKey = `${primaryTopic}_${framingType}`;

    if (!clusters[clusterKey]) {
      clusters[clusterKey] = {
        id: generateClusterId(clusterKey),
        topic: primaryTopic,
        framingType: framingType,
        title: generateClusterTitle(primaryTopic, framingType),
        articles: [],
        representativeArticle: null,
        biasDistribution: {
          left: 0,
          center: 0,
          right: 0,
        },
        avgScores: {
          ideologicalStance: 0,
          factualGrounding: 0,
          framingChoices: 0,
          emotionalTone: 0,
          sourceTransparency: 0,
        },
        commonPhrases: {},
        sourceCount: {},
        timeSpan: {
          earliest: null,
          latest: null,
        },
      };
    }

    const cluster = clusters[clusterKey];
    cluster.articles.push(article);

    // Update bias distribution
    const ideologyScore = article.biasScores?.ideologicalStance?.score || 50;
    if (ideologyScore < 40) cluster.biasDistribution.left++;
    else if (ideologyScore > 60) cluster.biasDistribution.right++;
    else cluster.biasDistribution.center++;

    // Track common phrases across articles in this cluster
  article.biasScores.ideologicalStance.highlightedPhrases?.forEach((phrase: string) => {
      cluster.commonPhrases[phrase] = (cluster.commonPhrases[phrase] || 0) + 1;
    });

    // Track source diversity
    cluster.sourceCount[article.source] = (cluster.sourceCount[article.source] || 0) + 1;

    // Update time span
    const publishDate = new Date(article.publishedAt);
    if (!cluster.timeSpan.earliest || publishDate < cluster.timeSpan.earliest) {
      cluster.timeSpan.earliest = publishDate;
    }
    if (!cluster.timeSpan.latest || publishDate > cluster.timeSpan.latest) {
      cluster.timeSpan.latest = publishDate;
    }
  });

  // Post-process clusters
  Object.values(clusters).forEach((cluster) => {
    const articleCount = cluster.articles.length;

    // Calculate average bias scores
    (['ideologicalStance','factualGrounding','framingChoices','emotionalTone','sourceTransparency'] as const)
      .forEach(dimension => {
        const sum = cluster.articles.reduce((acc, article) => {
          const biasScore = article.biasScores ? article.biasScores[dimension] : undefined;
          return acc + (biasScore?.score || 0);
        }, 0);
        cluster.avgScores[dimension] = Math.round(sum / articleCount);
      });

    // Find representative article (closest to cluster average)
    cluster.representativeArticle = findRepresentativeArticle(cluster);
  });

  // Return clusters sorted by relevance (article count × source diversity)
  return Object.values(clusters)
    .filter((cluster) => cluster.articles.length >= 2) // Only clusters with multiple articles
    .sort((a, b) => {
      const scoreA = a.articles.length * Object.keys(a.sourceCount).length;
      const scoreB = b.articles.length * Object.keys(b.sourceCount).length;
      return scoreB - scoreA;
    })
    .slice(0, 8); // Top 8 narrative clusters
}

// Detect the primary framing approach of an article
function detectFramingType(article: Article): string {
  const content = (article.headline + " " + article.content).toLowerCase();

  // Economic framing
  if (content.includes("cost") || content.includes("economy") || content.includes("budget")) {
    return article.biasScores?.ideologicalStance.score && article.biasScores?.ideologicalStance.score > 60
      ? "economic-concern"
      : "economic-impact";
  }

  // Security framing
  if (content.includes("security") || content.includes("safety") || content.includes("threat")) {
    return "security-focused";
  }

  // Human rights framing
  if (content.includes("rights") || content.includes("humanitarian") || content.includes("justice")) {
    return "rights-based";
  }

  // Policy framing
  if (content.includes("policy") || content.includes("legislation") || content.includes("regulation")) {
    return "policy-focused";
  }

  // Default to tone-based framing
  if (article.biasScores?.emotionalTone.score && article.biasScores.emotionalTone.score < 40) return "alarmist";
  if (article.biasScores?.emotionalTone.score && article.biasScores.emotionalTone.score > 70) return "neutral-reporting";
  return "advocacy-oriented";
}

function generateClusterId(clusterKey: string): string {
  // Create a short stable hash (FNV-1a like) since btoa isn't available in Node
  let hash = 2166136261;
  for (let i = 0; i < clusterKey.length; i++) {
    hash ^= clusterKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const id = (hash >>> 0).toString(36); // unsigned
  return id.substring(0, 8);
}

function generateClusterTitle(topic: string, framingType: string): string {
  const topicTitles: { [key: string]: string } = {
    "immigration": "Immigration Policy",
    "economy": "Economic Policy",
    "healthcare": "Healthcare Reform",
    "climate": "Climate Change",
    "technology": "Tech Regulation",
    "education": "Education Policy",
    "general": "Breaking News",
  };

  const framingTitles: { [key: string]: string } = {
    "economic-concern": "Economic Impact Focus",
    "economic-impact": "Cost-Benefit Analysis",
    "security-focused": "Security Implications",
    "rights-based": "Human Rights Perspective",
    "policy-focused": "Policy Implementation",
    "alarmist": "Crisis Framing",
    "neutral-reporting": "Factual Reporting",
    "advocacy-oriented": "Opinion-Driven Coverage",
  };

  const topicTitle = topicTitles[topic] || topic;
  const framingTitle = framingTitles[framingType] || framingType;

  return `${topicTitle}: ${framingTitle}`;
}

function findRepresentativeArticle(cluster: NarrativeCluster): Article | null {
  // Find article closest to cluster's average bias scores
  let bestArticle: Article | null = cluster.articles[0] || null;
  let smallestDistance = Infinity;

  cluster.articles.forEach((article) => {
    if (!article.biasScores) return;

    let distance = 0;
    (['ideologicalStance','factualGrounding','framingChoices','emotionalTone','sourceTransparency'] as const)
      .forEach(dimension => {
        const biasScore = article.biasScores ? article.biasScores[dimension] : undefined;
        const diff = (biasScore?.score || 0) - cluster.avgScores[dimension];
        distance += diff * diff;
      });

    if (distance < smallestDistance) {
      smallestDistance = distance;
      bestArticle = article;
    }
  });

  return bestArticle;
}

function addFramingAnalysis(cluster: NarrativeCluster) {
  // Add cross-source comparison
  const sourceAnalysis: {
    [key: string]: {
      articleCount: number;
      avgBiasScores: {
        ideologicalStance: number;
        factualGrounding: number;
        framingChoices: number;
        emotionalTone: number;
        sourceTransparency: number;
      };
      distinctivePhrases: string[];
    };
  } = {};

  cluster.articles.forEach((article) => {
    if (!article.biasScores) return;

    if (!sourceAnalysis[article.source]) {
      sourceAnalysis[article.source] = {
        articleCount: 0,
        avgBiasScores: {
          ideologicalStance: 0,
          factualGrounding: 0,
          framingChoices: 0,
          emotionalTone: 0,
          sourceTransparency: 0,
        },
        distinctivePhrases: [],
      };
    }

    sourceAnalysis[article.source].articleCount++;

    // Accumulate scores for averaging
    (Object.keys(sourceAnalysis[article.source].avgBiasScores) as (keyof typeof sourceAnalysis[typeof article.source]['avgBiasScores'])[])
      .forEach(dimension => {
        const biasScore = article.biasScores ? article.biasScores[dimension] : undefined;
        sourceAnalysis[article.source].avgBiasScores[dimension] += biasScore?.score || 0;
      });

    // Collect distinctive phrases
    article.biasScores.ideologicalStance.highlightedPhrases?.forEach((phrase: string) => {
      if (!sourceAnalysis[article.source].distinctivePhrases.includes(phrase)) {
        sourceAnalysis[article.source].distinctivePhrases.push(phrase);
      }
    });
  });

  // Calculate averages
  Object.keys(sourceAnalysis).forEach((source) => {
    const analysis = sourceAnalysis[source];
    Object.keys(analysis.avgBiasScores).forEach((dimension) => {
      analysis.avgBiasScores[dimension as keyof typeof analysis.avgBiasScores] = Math.round(
        analysis.avgBiasScores[dimension as keyof typeof analysis.avgBiasScores] / analysis.articleCount
      );
    });
  });

  return {
    ...cluster,
    sourceAnalysis,
    framingEvolution: generateFramingTimeline(cluster.articles),
  };
}

function generateFramingTimeline(articles: Article[]) {
  // Show how framing evolved over time
  return articles
    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())
    .map((article) => ({
      timestamp: article.publishedAt,
      source: article.source,
      headline: article.headline,
      keyFramingShift: detectFramingShift(article),
      biasSnapshot: article.biasScores
        ? {
            ideological: article.biasScores.ideologicalStance.score,
            emotional: article.biasScores.emotionalTone.score,
          }
        : null,
    }));
}

function detectFramingShift(article: Article): string {
  if (!article.biasScores) return "no-analysis";

  // Simple heuristic to detect if this article represents a framing shift
  const phrases = article.biasScores.ideologicalStance.highlightedPhrases || [];
  const shiftIndicators = [
    "however",
    "but",
    "despite",
    "although",
    "nevertheless",
    "on the other hand",
    "critics argue",
    "supporters claim",
  ];

  const hasShiftLanguage = phrases.some((phrase) =>
    shiftIndicators.some((indicator) => phrase.toLowerCase().includes(indicator))
  );

  return hasShiftLanguage ? "narrative-pivot" : "consistent-framing";
}

function extractTopics(text: string): string[] {
  const commonTopics = [
    "immigration",
    "economy",
    "healthcare",
    "education",
    "climate",
    "politics",
    "election",
    "covid",
    "ukraine",
    "china",
    "technology",
    "biden",
    "trump",
    "congress",
    "supreme court",
    "ai",
    "crypto",
  ];

  const textLower = text.toLowerCase();
  const foundTopics = commonTopics.filter((topic) => textLower.includes(topic));

  return foundTopics.length > 0 ? foundTopics : ["general"];
}

export default router;
