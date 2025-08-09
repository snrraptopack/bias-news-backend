# Bias Lab Backend – Functional README

Focused description of what the service does today (implemented functionality) using real data structures and the enforced structured JSON schema.

## 1. Functional Scope
The service:
1. Fetches news articles from GNews by topic (and optional source domains).
2. Scrapes each article URL to obtain fuller body text (if enrichment enabled / SHORT content).
3. Runs structured AI bias analysis across five dimensions using Gemini with a `responseSchema` (deterministic JSON output—no regex repair).
4. Stores analyzed articles (SQLite) and exposes them through REST endpoints.
5. Provides ad-hoc analysis for a single supplied article or URL (not persisted).
6. Supplies diagnostics on analysis success vs fallback modes.

## 2. Core Capabilities (Implemented)
- Bulk topic fetch + analysis: `/api/articles/fetch`
- List & filter stored articles: `/api/articles`
- Retrieve article by id: `/api/articles/:id`
- Rescore existing article: `/api/articles/rescore/:id`
- Ad-hoc single analysis (content or URL): `/api/articles/analyze`
- Diagnostics summary: `/api/articles/diagnostics/status`
- Health check: `/api/health`
- Placeholder narrative cluster endpoints: `/api/narratives`, `/api/narratives/:clusterId`
- Full-content enrichment (scrape) before AI to avoid truncated snippets
- Structured AI JSON output with five bias dimensions + reasoning + highlighted phrases + confidence intervals
- Fallback scoring with explicit `analysisStatus`

## 3. Data Flow (Bulk Fetch)
1. Client POSTs `{ "topic": "ai regulation" }` to `/articles/fetch`.
2. GNews returns metadata + short `content`.
3. For each article: If content appears truncated/short → scrape page → extract paragraphs → normalize text.
4. Structured AI call with enriched content.
5. Output parsed (guaranteed schema) → confidence intervals added → stored.
6. Response returns analyzed article objects.

Ad-hoc flow: Provide `content` OR `url`; if `content` <240 chars and `url` exists, the service attempts scrape before analysis.

## 4. Structured BiasScores Schema
TypeScript interface (effective runtime contract):
```ts
interface BiasDimension {
   score: number;          // 0-100
   label: string;          // categorical interpretation
   confidence: number;     // 0-1
   highlightedPhrases: string[];
   reasoning: string;      // concise justification
   confidenceInterval?: { lower: number; upper: number; width: number };
}

interface BiasScores {
   ideologicalStance: BiasDimension;
   factualGrounding: BiasDimension;
   framingChoices: BiasDimension;
   emotionalTone: BiasDimension;
   sourceTransparency: BiasDimension;
   overallBiasLevel: number;      // aggregated 0-100
   primarySources: string[];      // extracted cited URLs
   analyzedAt: string;            // ISO timestamp
   analysisStatus?: 'ai' | 'fallback-api' | 'fallback-parse' | 'fallback-empty';
   isFallback?: boolean;          // true if synthetic fallback
}
```

### Sample Realistic Output (Truncated Example)
```json
{
   "ideologicalStance": {
      "score": 62,
      "label": "center-right",
      "confidence": 0.83,
      "highlightedPhrases": ["market-friendly approach", "regulatory overreach"],
      "reasoning": "Leans toward deregulatory arguments while acknowledging opposing views.",
      "confidenceInterval": { "lower": 53, "upper": 71, "width": 18 }
   },
   "factualGrounding": {
      "score": 78,
      "label": "good",
      "confidence": 0.90,
      "highlightedPhrases": ["according to the draft report", "data from the agency"],
      "reasoning": "Multiple cited documents and named officials.",
      "confidenceInterval": { "lower": 72, "upper": 84, "width": 12 }
   },
   "framingChoices": {
      "score": 68,
      "label": "balanced",
      "confidence": 0.81,
      "highlightedPhrases": ["supporters argue", "critics warn"],
      "reasoning": "Presents contrasting stakeholder perspectives.",
      "confidenceInterval": { "lower": 59, "upper": 77, "width": 18 }
   },
   "emotionalTone": {
      "score": 55,
      "label": "neutral",
      "confidence": 0.74,
      "highlightedPhrases": ["growing concern", "intensifying debate"],
      "reasoning": "Mostly neutral descriptive language with mild emotion terms.",
      "confidenceInterval": { "lower": 44, "upper": 66, "width": 22 }
   },
   "sourceTransparency": {
      "score": 82,
      "label": "clear",
      "confidence": 0.88,
      "highlightedPhrases": ["said Energy Commissioner Laura Chen", "the 2024 audit"],
      "reasoning": "Named officials and documents, few anonymous references.
",
      "confidenceInterval": { "lower": 75, "upper": 89, "width": 14 }
   },
   "overallBiasLevel": 69,
   "primarySources": ["https://agency.gov/report2024", "https://example.com/audit.pdf"],
   "analyzedAt": "2025-08-09T12:15:30.218Z",
   "analysisStatus": "ai"
}
```

## 5. Endpoints (Implemented Summary)
| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/health | Environment readiness |
| POST | /api/articles/fetch | Fetch + enrich + analyze topic articles |
| GET | /api/articles | List stored articles (filters) |
| GET | /api/articles/:id | Single article with scores |
| POST | /api/articles/rescore/:id | Re-run analysis for stored article |
| POST | /api/articles/analyze | Ad-hoc single article analysis (not stored) |
| GET | /api/articles/diagnostics/status | Counts by analysisStatus |
| GET | /api/narratives | Placeholder narrative clusters |
| GET | /api/narratives/:clusterId | Placeholder cluster detail |

Refer to `API_DOCUMENTATION.md` for request/response field details.

## 6. Example Workflow (Local)
1. Fetch & analyze articles:
```bash
curl -X POST http://localhost:3001/api/articles/fetch \
   -H "Content-Type: application/json" \
   -d '{"topic":"ai regulation"}'
```
2. List analyzed:
```bash
curl "http://localhost:3001/api/articles?topic=ai&limit=5"
```
3. Ad-hoc single (scrape fallback if content short):
```bash
curl -X POST http://localhost:3001/api/articles/analyze \
   -H "Content-Type: application/json" \
   -d '{"url":"https://example.com/news/story123"}'
```

## 7. Environment Variables
Required:
- `GOOGLE_AI_KEY`
- `GNEWS_API_KEY`

Optional:
- `PORT` (default 3001)
- `DB_PATH` (default ./data/bias_news.db)
- `FULL_CONTENT_SCRAPE=true|false` (default true)

## 8. Running Locally
```bash
git clone <repo>
cd bias-news-be
npm install
cp env.example .env   # fill keys
npm run dev
```
Health check: http://localhost:3001/api/health

## 9. Fallback Logic (Summary)
- `fallback-empty`: Content too short (<50 chars) / unusable.
- `fallback-api`: Upstream AI request error.
- `fallback-parse`: Rare (legacy) schema mismatch.
All fallbacks supply structurally valid BiasScores with `isFallback: true`.

## 10. Current Limitations
- Narrative clustering is placeholder (not semantic).
- No authentication / rate limiting.
- No scrape caching (each fetch hits source).
- Confidence intervals are heuristic (not statistically derived).

## 11. Next Functional Additions (Planned – Not Yet Implemented)
- Semantic embeddings + true clustering.
- Phrase taxonomy classification (ideological, emotional, sourcing markers).
- Source citation verification & categorization.

---
This README intentionally omits aspirational marketing and focuses on concrete, implemented behavior + immediate functional interface.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- Google AI API key (for Gemini)
- GNews API key

## Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd bias-news-be
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create environment file**
   ```bash
   cp env.example .env
   ```

4. **Add your API keys to `.env`**
   ```env
   GOOGLE_AI_KEY=your_google_ai_api_key_here
   GNEWS_API_KEY=your_gnews_api_key_here
   PORT=3001
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

## API Endpoints

### Health Check
```
GET /api/health
```

### Articles
```
GET /api/articles?topic=AI&source=reuters&limit=10
GET /api/articles/:id
POST /api/articles/fetch
```

### Narratives
```
GET /api/narratives
GET /api/narratives/:clusterId
```

## Testing

Run the test script to verify everything is working:

```bash
# PowerShell
.\test-api.ps1

# Or manually test endpoints
curl http://localhost:3001/api/health
```

## Example Usage

### Fetch and analyze articles about AI regulation:

```bash
curl -X POST http://localhost:3001/api/articles/fetch \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "AI regulation 2025",
    "sources": ["reuters.com", "theguardian.com"]
  }'
```

### Get articles with bias analysis:

```bash
curl "http://localhost:3001/api/articles?topic=AI&limit=5"
```

### Get narrative clusters:

```bash
curl http://localhost:3001/api/narratives
```

## Database

The application uses SQLite for data persistence. The database file is automatically created at `./data/bias_news.db` when the application starts.

### Database Schema

```sql
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  headline TEXT NOT NULL,
  content TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL,
  author TEXT,
  publishedAt TEXT NOT NULL,
  url TEXT UNIQUE NOT NULL,
  urlToImage TEXT,
  biasScores TEXT,  -- JSON string
  narrativeCluster TEXT,
  primarySources TEXT,  -- JSON string
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Architecture

- **`src/main.ts`**: Express server setup and middleware
- **`src/routes/`**: API route handlers
- **`src/services/`**: External API integrations (GNews, Google AI)
- **`src/utils/`**: Database utilities and data models
- **`data/`**: SQLite database storage

## Error Handling

The API includes comprehensive error handling:
- Environment variable validation
- API key validation
- Rate limiting protection
- Graceful fallbacks for AI analysis failures
- Detailed error messages

## Performance Considerations

- Articles are limited to 10 for bias analysis to avoid rate limits
- Database queries are optimized with indexes
- Response payloads are limited to 10MB
- Timeouts are set for external API calls

## Development

```bash
# Start development server with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Troubleshooting

1. **Missing API keys**: Ensure both `GOOGLE_AI_KEY` and `GNEWS_API_KEY` are set in `.env`
2. **Database errors**: Check that the `./data` directory is writable
3. **Rate limiting**: The app includes delays between AI analysis calls
4. **CORS issues**: The API is configured to allow localhost origins
5. **SQLite issues**: Make sure you have write permissions in the project directory

## License

[Your License Here] 