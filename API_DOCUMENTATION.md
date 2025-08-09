# The Bias Lab API Documentation

## Overview

The Bias Lab API is a sophisticated news analysis platform that analyzes media bias across 5 dimensions using AI. This API provides real-time news ingestion, bias scoring, and narrative clustering to help users understand media bias patterns.

**Base URL**: `http://localhost:3001/api`

## Core Features

- **Real-time News Ingestion**: Fetch articles from GNews API (topic + optional source filters)
- **Automatic Full-Content Enrichment**: Each fetched article is synchronously enriched via live page scrape (HTML → cleaned paragraph text) before AI scoring when enabled
- **5-Dimension Bias Analysis (Structured)**: Ideological stance, factual grounding, framing choices, emotional tone, source transparency using schema-constrained Google Gemini structured output (deterministic JSON)
- **Narrative Clustering**: Group articles by topical/ framing similarity (heuristic placeholder – future ML upgrade)
- **Highlighted Phrases & Reasoning**: Model supplies phrases + explanation per dimension; heuristic confidence intervals derived from model confidence
- **Confidence Intervals**: Added (lower/upper/width) heuristic bounds derived from per-dimension confidence to help visualize uncertainty
- **Primary Source Extraction**: Model returns cited / referenced source URLs (deduped)
- **Cross-source Analysis**: Compare coverage patterns across outlets

## Authentication

Currently, no authentication is required. API keys are managed server-side for GNews and Google AI.

## Data Models

### Article Object
```typescript
interface Article {
  id: string;                    // Unique identifier
  headline: string;              // Article title
  content: string;               // Full article content
  description: string;           // Article description
  source: string;                // News source (e.g., "Reuters")
  author: string;                // Article author
  publishedAt: string;           // ISO timestamp
  url: string;                   // Article URL
  urlToImage: string;            // Featured image URL
  biasScores: BiasScores | null; // Bias analysis results
  narrativeCluster: string | null; // Cluster ID if grouped
  primarySources: string[];      // Extracted source URLs
}
```

### BiasScores Object
```typescript
interface BiasScores {
  ideologicalStance: BiasDimension;
  factualGrounding: BiasDimension;
  framingChoices: BiasDimension;
  emotionalTone: BiasDimension;
  sourceTransparency: BiasDimension;
  overallBiasLevel: number;      // 0-100 scale
  primarySources: string[];      // Source URLs/citations
  analyzedAt: string;           // ISO timestamp
  analysisStatus?: 'ai' | 'fallback-api' | 'fallback-parse' | 'fallback-empty'; // Analysis outcome type
  isFallback?: boolean;         // True if scores are synthetic fallback
}

interface BiasDimension {
  score: number;                 // 0-100 scale
  label: string;                 // Descriptive label
  confidence: number;            // 0-1 confidence level
  highlightedPhrases: string[];  // Specific phrases that influenced score
  reasoning: string;             // Explanation of the score
  confidenceInterval?: {         // Heuristic interval derived from confidence
    lower: number;
    upper: number;
    width: number;
  };
}
```

### Narrative Cluster Object
```typescript
interface NarrativeCluster {
  id: string;                    // Unique cluster ID
  topic: string;                 // Primary topic
  framingType: string;           // Framing approach
  title: string;                 // Human-readable title
  articles: Article[];           // Articles in this cluster
  representativeArticle: Article | null; // Most representative article
  biasDistribution: {
    left: number;                // Count of left-leaning articles
    center: number;              // Count of center articles
    right: number;               // Count of right-leaning articles
  };
  avgScores: {
    ideologicalStance: number;
    factualGrounding: number;
    framingChoices: number;
    emotionalTone: number;
    sourceTransparency: number;
  };
  commonPhrases: { [key: string]: number }; // Phrase frequency
  sourceCount: { [key: string]: number };   // Source distribution
  timeSpan: {
    earliest: Date | null;
    latest: Date | null;
  };
}
```

## API Endpoints

### 1. Health Check

**GET** `/health`

Check API status and environment configuration.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2025-08-08T23:53:16.747Z",
  "environment": {
    "hasGoogleAIKey": true,
    "hasGNewsKey": true
  }
}
```

### 2. List Articles

**GET** `/articles`

Retrieve articles with bias scores. Supports filtering and pagination.

**Query Parameters:**
- `topic` (optional): Filter by topic/keyword
- `source` (optional): Filter by news source
- `limit` (optional): Number of articles to return (default: 10, max: 50)

**Example Request:**
```
GET /api/articles?topic=AI&source=Reuters&limit=5
```

**Response:**
```json
{
  "articles": [
    {
      "id": "abc123",
      "headline": "AI Regulation Debate Intensifies",
      "content": "Full article content...",
      "source": "Reuters",
      "publishedAt": "2025-08-08T19:52:43Z",
      "biasScores": {
        "ideologicalStance": {
          "score": 65,
          "label": "center-right",
          "confidence": 0.85,
          "highlightedPhrases": ["market-driven approach", "regulatory concerns"],
          "reasoning": "Article emphasizes free-market solutions and conservative policy positions..."
        },
        "factualGrounding": {
          "score": 78,
          "label": "good",
          "confidence": 0.92,
          "highlightedPhrases": ["according to experts", "research shows"],
          "reasoning": "Well-sourced with multiple expert quotes and data references..."
        },
        "framingChoices": {
          "score": 72,
          "label": "balanced",
          "confidence": 0.88,
          "highlightedPhrases": ["on one hand", "however", "critics argue"],
          "reasoning": "Presents multiple perspectives with balanced framing..."
        },
        "emotionalTone": {
          "score": 68,
          "label": "neutral",
          "confidence": 0.85,
          "highlightedPhrases": ["objective analysis", "measured approach"],
          "reasoning": "Uses neutral language with minimal emotional appeals..."
        },
        "sourceTransparency": {
          "score": 82,
          "label": "clear",
          "confidence": 0.90,
          "highlightedPhrases": ["said John Smith", "according to the report"],
          "reasoning": "Clear attribution with named sources and specific citations..."
        },
        "overallBiasLevel": 73,
        "primarySources": ["https://example.com/report"],
        "analyzedAt": "2025-08-08T23:53:39.550Z"
      }
    }
  ],
  "total": 1,
  "timestamp": "2025-08-08T23:53:16.747Z"
}
```

### 3. Get Article Details

**GET** `/articles/{id}`

Retrieve detailed information about a specific article.

**Path Parameters:**
- `id`: Article ID

**Example Request:**
```
GET /api/articles/abc123
```

**Response:** Same as individual article object above.

### 4. Fetch and Analyze Articles (Bulk Ingestion)

**POST** `/articles/fetch`

Fetch new articles from GNews API and analyze them for bias.

**Request Body:**
```json
{
  "topic": "climate change",
  "sources": ["reuters.com", "bbc.com"]
}
```

**Request Fields:**
- `topic` (required): Search topic (minimum 3 characters)
- `sources` (optional): Array of news source domains

**Response:**
```json
{
  "message": "Fetched and analyzed 10 articles",
  "articles": [
    // Array of analyzed Article objects
  ],
  "topic": "climate change",
  "timestamp": "2025-08-08T23:53:16.747Z"
}
```

**Error Responses:**
```json
{
  "error": "Topic is required"
}
```
```json
{
  "error": "No articles found for this topic",
  "topic": "xyz"
}
```

### 5. Ad-hoc Single Article Analysis

**POST** `/articles/analyze`

Analyze a user-submitted article (raw content and/or URL). If `content` is missing or very short (<240 chars) and a `url` is supplied, the server will attempt a live scrape to obtain full text before analysis.

**Request Body:**
```json
{
  "headline": "Optional headline override",
  "source": "Custom Source",
  "url": "https://example.com/story",
  "content": "Full raw article text OR leave short/empty to trigger scrape"
}
```

Rules / Behavior:
- Supply either sufficient `content` (>=50 chars) OR a `url` that can be scraped.
- If provided content <50 chars after attempted scrape → 400 error.
- If provided or scraped content <240 chars → analysis still runs, but model may produce lower-detail reasoning; extremely short content may trigger `fallback-empty`.
- Response is NOT persisted (ephemeral ad-hoc analysis).

**Response:**
```json
{
  "article": { /* Article with biasScores */ }
}
```

**Error (400):**
```json
{ "error": "Provide raw article content (>=50 chars)" }
```

### 6. List Narrative Clusters

**GET** `/narratives`

Retrieve clustered story framings showing how narratives evolve across outlets.

**Response:**
```json
{
  "clusters": [
    {
      "id": "YWlfYWR2",
      "topic": "ai",
      "framingType": "advocacy-oriented",
      "title": "AI: Opinion-Driven Coverage",
      "articles": [
        // Array of Article objects
      ],
      "representativeArticle": {
        // Most representative article
      },
      "biasDistribution": {
        "left": 2,
        "center": 5,
        "right": 3
      },
      "avgScores": {
        "ideologicalStance": 55,
        "factualGrounding": 68,
        "framingChoices": 62,
        "emotionalTone": 65,
        "sourceTransparency": 70
      },
      "commonPhrases": {
        "artificial intelligence": 8,
        "regulation": 5,
        "innovation": 4
      },
      "sourceCount": {
        "Reuters": 3,
        "BBC": 2,
        "Bloomberg": 2,
        "The Economist": 1
      },
      "timeSpan": {
        "earliest": "2025-08-08T03:23:00.000Z",
        "latest": "2025-08-08T19:52:43.000Z"
      }
    }
  ],
  "totalArticles": 10,
  "timestamp": "2025-08-08T23:53:16.747Z"
}
```

### 7. Get Narrative Cluster Details

**GET** `/narratives/{clusterId}`

Retrieve detailed information about a specific narrative cluster.

**Path Parameters:**
- `clusterId`: Cluster ID

**Response:** Enhanced cluster object with additional analysis:
```json
{
  // All cluster fields above, plus:
  "sourceAnalysis": {
    "Reuters": {
      "articleCount": 3,
      "avgBiasScores": {
        "ideologicalStance": 58,
        "factualGrounding": 75,
        "framingChoices": 68,
        "emotionalTone": 72,
        "sourceTransparency": 78
      },
      "distinctivePhrases": ["market analysis", "economic impact"]
    }
  },
  "framingEvolution": [
    {
      "timestamp": "2025-08-08T03:23:00.000Z",
      "source": "Reuters",
      "headline": "AI Regulation Debate Begins",
      "keyFramingShift": "narrative-pivot",
      "biasSnapshot": {
        "ideological": 55,
        "emotional": 65
      }
    }
  ]
}
```

### 8. Diagnostics: Analysis Status Summary

**GET** `/articles/diagnostics/status`

Returns a count of articles by `analysisStatus`.

**Response:**
```json
{
  "summary": {
    "ai": 7,
    "fallback-parse": 2,
    "fallback-api": 1,
    "fallback-empty": 3,
    "unknown": 0
  },
  "total": 13,
  "timestamp": "2025-08-09T12:00:00.000Z"
}
```

## Bias Analysis Dimensions

### 1. Ideological Stance (0-100)
- **0-20**: Far-left
- **21-40**: Left
- **41-60**: Center
- **61-80**: Right
- **81-100**: Far-right

### 2. Factual Grounding (0-100)
- **0-25**: Poor (unsupported claims)
- **26-50**: Moderate (some sources)
- **51-75**: Good (well-sourced)
- **76-100**: Excellent (comprehensive sourcing)

### 3. Framing Choices (0-100)
- **0-25**: Misleading (deceptive framing)
- **26-50**: Biased (one-sided)
- **51-75**: Balanced (multiple perspectives)
- **76-100**: Objective (neutral framing)

### 4. Emotional Tone (0-100)
- **0-25**: Inflammatory (highly emotional)
- **26-50**: Emotional (some emotional language)
- **51-75**: Neutral (balanced tone)
- **76-100**: Objective (factual tone)

### 5. Source Transparency (0-100)
- **0-25**: Vague (unclear attribution)
- **26-50**: Limited (some attribution)
- **51-75**: Clear (good attribution)
- **76-100**: Excellent (comprehensive attribution)

## Error Handling

All endpoints return appropriate HTTP status codes:

- **200**: Success
- **400**: Bad Request (invalid parameters)
- **404**: Not Found (article/cluster not found)
- **500**: Internal Server Error

Error responses include a message:
```json
{
  "error": "Description of the error"
}
```

## Rate Limiting & Performance Controls

- Bulk analysis capped at 10 articles per fetch request
- Synchronous enrichment with scraping can increase latency (prioritizes completeness over speed)
- Parallel model analysis with concurrency limit (currently 3)
- Content <240 chars flagged internally; very short (<50) yields fallback-empty (or 400 on ad-hoc route)
- Database queries indexed (source, publishedAt, headline/content composite)

## Performance Targets

- Model latency varies with content length (full scraped pages increase tokens). Structured output removes parse-retry overhead.
- DB Query Target: <100ms typical
- Bulk Fetch & Analyze (10 articles): With enrichment may exceed 5s depending on network fetch & scraping speed

## Development Notes

### Current Data in SQLite
The database contains sample articles about:
- Artificial Intelligence (10 articles)
- Climate Change (when tested)
- Various news sources: Reuters, BBC, Bloomberg, The Economist, PBS, UPI

### AI Analysis Status
- `ai`: Successful structured model response
- `fallback-parse`: (Legacy) Model responded but JSON invalid (rare now due to structured schema)
- `fallback-api`: Upstream model request failed (network / API error)
- `fallback-empty`: Content too short / unusable even after enrichment
- `isFallback` flag simplifies client handling

Structured output dramatically reduces parse failures; most new failures are transport-level only.

### Frontend Integration Tips

1. **Real-time Updates**: Use polling or WebSocket for live updates
2. **Caching**: Cache article lists and cluster data
3. **Progressive Loading**: Load articles in batches
4. **Error Handling**: Gracefully handle API failures
5. **Responsive Design**: Support mobile and desktop views

## Testing

Use the provided PowerShell scripts:
- `test-simple.ps1`: Basic functionality test
- `test-detailed.ps1`: Comprehensive endpoint testing

## Environment Variables

Required for full functionality:
- `GOOGLE_AI_KEY`: Google Generative AI API key
- `GNEWS_API_KEY`: GNews API key
- `PORT`: Server port (default: 3001)
- `FULL_CONTENT_SCRAPE` (optional, default `true`): When `true`, bulk fetch performs synchronous full-page scraping prior to AI analysis.

Optional future tuning (not yet implemented):
- `SCRAPE_TIMEOUT_MS`
- `MAX_PARALLEL_SCRAPES`

If enrichment disabled (`FULL_CONTENT_SCRAPE=false`), articles may have truncated content and lower-detail analyses.

## Support

For API issues or questions, check the server logs for detailed error information and performance metrics.
