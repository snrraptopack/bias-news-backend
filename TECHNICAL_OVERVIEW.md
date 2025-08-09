# Bias Lab Backend Technical Overview

This document provides a deeper architectural and implementation-focused view of the Bias Lab backend beyond the public `API_DOCUMENTATION.md`.

## 1. High-Level Architecture

Layers:
1. Routing (`src/routes/*`): Express route handlers (articles, narratives, diagnostics).
2. Services (`src/services/*`): External API integration & AI analysis.
3. Utilities (`src/utils/*`): Persistence (SQLite), in-memory data structures, and environment helpers.
4. Data Store (`data/bias_news.db`): SQLite database for articles & analysis outputs.

Flow (Bulk Fetch):
GNews Fetch -> Article Normalization -> Full-Content Enrichment (Scrape) -> AI Structured Bias Analysis -> Confidence Interval Augmentation -> Persistence -> Diagnostics.

Flow (Ad-hoc Analyze):
Request (content and/or URL) -> Conditional Scrape (if missing/short) -> Structured AI Analysis -> Ephemeral Response (no persistence).

## 2. Key Modules

### 2.1 `newsAPI.ts`
Responsibilities:
- Query GNews API for topic + sources.
- Detect truncated content.
- Perform optional full-page scrape & HTML cleaning.
- Provide synchronous enrichment step: `enrichArticles()` used before analysis in `/articles/fetch`.
- Expose `fetchFullArticle(url)` for ad-hoc route fallback scraping.

Scraping Strategy:
- HTTP GET (axios).
- DOM-less heuristic extraction: keep `<p>` blocks, strip tags, collapse whitespace.
- Reject if cleaned text < minimal threshold.

Truncation Detection Heuristics:
- Presence of explicit ellipsis patterns ("…", "[...]", "Read more").
- Short length relative to expected news article (e.g., < ~500 chars) flagged as candidate for enrichment.

### 2.2 `biasAnalyzer.ts`
Responsibilities:
- Generate bias scores using Google Gemini 2.5 Flash via `@google/genai` with `responseSchema` for strict JSON.
- Provide fallback scores when AI fails (transport error / empty content).
- Derive heuristic confidence intervals per dimension from model-provided confidence.

Structured Output Schema:
- Defines 5 bias dimensions, plus `overallBiasLevel`, `primarySources`, and nested objects for each dimension (score, label, highlightedPhrases, reasoning, confidence).
- Eliminates fragile regex/JSON repair previously needed.

Confidence Interval Heuristic (example logic):
- Width inversely proportional to confidence: `width = clamp( (1 - confidence) * 30, 6, 40 )` (illustrative; see code).
- Lower/upper clamped to [0,100].

Fallback Categories:
- `fallback-empty`: Content missing/too short.
- `fallback-api`: AI request error.
- `fallback-parse`: (Legacy) structured parse failure (rare now).

### 2.3 `routes/articles.ts`
Endpoints:
- `GET /articles` – Listing & filtering.
- `POST /articles/fetch` – Bulk ingestion + synchronous enrichment + parallel AI analysis (concurrency-limited).
- `POST /articles/analyze` – Ad-hoc ephemeral analysis with auto-scrape when content short or absent.
- `POST /articles/rescore/:id` – Re-run analysis for a stored article.
- `GET /articles/diagnostics/status` – Aggregated analysis status counts.

Concurrency Model:
- Uses an internal mapWithConcurrency (limit = 3) to throttle AI calls and avoid saturating model API or hitting rate limits.

### 2.4 Persistence (`database.ts` / `dataStore.ts`)
- SQLite used for simplicity & portability.
- Articles persisted with serialized `biasScores` JSON.
- Potential future migration path: Postgres for scalability + richer querying.

## 3. Data Lifecycle (Bulk)
1. Fetch raw article list (metadata + truncated snippet).
2. Enrichment: For each article, scrape full HTML (if enabled & needed) and replace/augment `content`.
3. Analysis: Pass enriched `content` + headline to AI model (structured prompt minimal; schema enforces shape).
4. Augmentation: Add confidence intervals & timestamps.
5. Storage: Insert/update in SQLite.
6. Diagnostics: Status route derives counts by `analysisStatus`.

## 4. Error Handling & Fallbacks
| Stage | Failure Modes | Mitigation |
|-------|---------------|-----------|
| Fetch | Network, API quota | Graceful skip, continue others |
| Scrape | 404, paywall, blocking, empty extraction | Skip enrichment; may produce lower-detail analysis |
| AI Call | Network, quota, timeout | Fallback scores (`fallback-api`) |
| AI Output | Schema mismatch (rare) | Fallback parse category (legacy) |
| Persistence | DB locked | Retry/backoff (future), currently bubble error |

## 5. Reliability & Determinism Improvements
- Structured Output: Replaced brittle regex-based JSON salvage with schema-enforced generation.
- Concurrency Control: Prevents stampede; supports future adaptive rate modulation.
- Deterministic Fallbacks: Single path for fallback generation with status labeling.
- Enrichment Before Analysis: Reduces variability caused by truncated contexts.

## 6. Performance Considerations
Bottlenecks:
- Scraping (network bound, sequential if not optimized). Currently synchronous to maximize content quality.
- Token Volume: Full article text increases model latency and cost.

Tuning Levers (Future):
- Optional summarization pre-pass to compress verbose sections.
- Caching scraped pages (hash URL -> stored full text TTL cache / DB table).
- Parallel scraping with a configurable concurrency bucket.
- Adaptive content truncation if token limits approached (model context length guard).

## 7. Security & Compliance Notes
Current Gaps:
- No authentication / rate limiting.
- Potential exposure to untrusted HTML (we only treat as text; further sanitization advisable).
- No input size cap for ad-hoc `content` (add max length enforcement).

Recommendations:
- Introduce API key or JWT per client.
- Add request-level rate limiting (IP + key) (e.g., `express-rate-limit`).
- Sanitize / escape output fields in any future templated rendering.
- Add robust logging with PII minimization.

## 8. Observability
Planned / Suggested:
- Structured logs: requestId, route, latency, analysisStatus counts.
- Metrics: scrape duration histogram, model latency, fallback ratio, average token size.
- Health Probe: Already exposes key presence via `/health`.

## 9. Testing Strategy (Planned)
Test Layers:
- Unit: biasAnalyzer fallback logic, confidence interval math.
- Integration: `/articles/fetch` end-to-end with mocked GNews + stub model.
- Contract: Schema of BiasScores stable (snapshot test).
- Load: Concurrency scaling of AI calls (simulate 30 articles).

Immediate Test Additions (Low Effort):
- Mock analyzer returning deterministic object for reproducible assertions.
- Scrape extractor function given sample HTML fixture.

## 10. Roadmap / Next Steps
Priority Enhancements:
1. Add persistent cache of scraped content to avoid repeat network hits.
2. Implement selective summarization when content > model token comfort threshold.
3. Introduce per-dimension calibration to translate raw scores into categorical bands (for UI color coding) centrally.
4. Add narrative clustering algorithm (semantic embeddings + community detection) replacing placeholder logic.
5. Implement API auth & rate limiting.
6. Add automated tests & CI pipeline (lint, type-check, test, coverage gate).
7. Introduce article versioning (store original snippet vs enriched full text + provenance flags).
8. Add language detection & multi-language model fallback.

## 11. Known Limitations
- Scraping heuristic may under-extract content on heavily structured pages (missing subheadings, lists).
- No paywall bypass logic (intentionally).
- Confidence intervals heuristic (not statistically rigorous) – intended for relative uncertainty visualization only.
- Narrative clustering currently minimal / placeholder.

## 12. Deployment Considerations
- Environment: Node 18+ recommended (fetch, native APIs).
- Horizontal Scaling: Ensure singleton work (e.g., scheduled fetch) coordinated via external lock (Redis) if multi-instance.
- Database: For production scale, migrate to Postgres; add indexes on (publishedAt, source, topic keywords) and JSON indexing for bias dimensions if needed.

## 13. Glossary
- Enrichment: Replacement or augmentation of truncated API-provided snippet with live-scraped full text.
- Structured Output: Model response constrained by schema (`responseSchema`) yielding deterministic JSON.
- Fallback Scores: Synthetic bias score set ensuring downstream clients always receive a shape-consistent object.

---
This document will evolve as clustering, summarization, caching, and security features are implemented.
