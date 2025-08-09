# Process & Technical Decision Log (Backend)

## 1. Objective
Build a demonstrable end‑to‑end backend for "The Bias Lab" within a tight time & token budget: fetch current news, enrich full content, compute structured multi‑dimensional bias analysis, and expose stable, production‑deployable APIs (no façade slides — real running code).

## 2. Scope Delivered
- Article ingestion via GNews (headlines + metadata)
- Full‑article enrichment (HTML fetch + main text extraction) to avoid biasing AI with truncated snippets
- Structured AI bias scoring across multiple axes (political leaning, sensationalism, framing, sourcing, emotional charge, etc.) with confidence & reasoning
- Fallback modes for robustness when AI output malformed or remote calls fail
- Primary source link sanitization (remove localhost / invalid URLs)
- Narrative (placeholder) aggregation endpoint for future clustering
- Diagnostics endpoints (status) & health check
- Resilient SQLite persistence with configurable path and safe fallback to in‑memory
- Deployment hardening (build pipeline, CORS, env validation)

## 3. Constraints & Realities
| Constraint | Impact | Mitigation |
|------------|--------|-----------|
| Limited time (72h window) | Prioritized core differentiators | Deferred advanced clustering & auth |
| Token budget (free / limited AI usage) | Needed deterministic schema to avoid retry loops | Adopted strict response schema & validation layer |
| Unstable model freeform JSON | Risk of parse breakage | Moved to structured output (Gemini with `responseSchema`) |
| Deployment ephemeral FS / path issues | SQLite open failures (`SQLITE_CANTOPEN`) | Added directory ensure + in‑memory fallback + `DB_PATH` env |
| Frontend ↔ backend cross‑origin | CORS blocked prod FE | Dynamic + merged origin list + explicit prod FE baked in |
| Scraped article variability | Incomplete or noisy text | Truncation detection + heuristic main content extraction |

## 4. High‑Level Architecture
```
Client (Vercel FE)
   | REST
   v
Express (TypeScript)
   |-- /api/articles (fetch/list/analyze)
   |-- /api/narratives (proto clustering)
   |-- /api/health, /api/articles/diagnostics/status
        |
        +-- News Fetch Layer (GNews API)
        +-- Enrichment (HTML fetch + text extraction)
        +-- Bias Analyzer (AI structured scoring + validation + fallbacks)
        +-- Data Store (SQLite via sqlite3) -> File or memory fallback
```
Key patterns:
- Layered separation: routes → services → utils
- Idempotent enrichment: only enrich once per article instance
- Concurrency‑controlled batch analysis (avoid API storms)
- Pure data objects passed between layers (no framework leakage)

## 5. Data Flow (Article Lifecycle)
1. Fetch metadata (title, url, source) from GNews
2. Detect if snippet is truncated (ellipsis / unusually short length)
3. If needed, fetch full HTML; extract readable body (strips scripts, ads)
4. Compose prompt context (headline + body)
5. Call AI (Gemini) with strict JSON schema for BiasScores
6. Validate & clamp numeric ranges; generate fallback if any dimension missing
7. Attach confidence intervals heuristically (adds interpretability)
8. Sanitize primary sources (URL validity + host filtering)
9. Persist article + scores to SQLite (or memory fallback)
10. Serve through API

## 6. AI Integration Strategy
- Initial planning & architecture: drafted collaboratively with Claude 3.5 (token‑efficient iterative spec sessions)
- Runtime scoring: Google Gemini via `@google/genai` using `responseSchema` to enforce deterministic structure (removes brittle regex parsing)
- Fallback taxonomy:
  - `ai` (full success)
  - `fallback-api` (partial, repaired fields)
  - `fallback-parse` (schema violation recovered)
  - `fallback-empty` (AI unavailable → synthetic neutral baseline)
- Validation stage rejects out‑of‑range scores; clamps to 0‑1; ensures presence of reason strings

## 7. Bias Scoring Model (Current Implementation)
Dimensions (extensible):
- Political Leaning (spectrum normalization internal)
- Sensationalism
- Emotional Charge
- Framing Bias
- Source Diversity / Reliance
Each dimension includes:
- score (0..1)
- reasoning (short analytic text)
- highlightedPhrases (evidence spans)
- confidence (derived / heuristic band)
Confidence Intervals: simple +/- epsilon heuristic now; future plan: bootstrap across segmented prompt slices or multi‑sample consensus.

## 8. Key Technical Decisions & Rationale
| Decision | Rationale | Alternatives Considered |
|----------|-----------|-------------------------|
| Express + TS (CommonJS build) | Fast iteration, universal familiarity | Deno (initial hints) / NestJS (too heavy) |
| SQLite (`sqlite3`) | Zero infra friction, portable | Postgres (would add deployment surface) |
| Structured AI schema | Minimize parsing fragility | Freeform JSON + regex (initial) |
| On‑demand full article scraping | Reduces summarization bias from truncated snippets | Blindly analyze snippet (lower fidelity) |
| Concurrency control for batch scoring | Avoid API rate spikes + OOM | Fire all promises blindly |
| Sanitizing primary sources | Prevent leaking internal dev URLs | Blind trust model output |
| DB path via env + directory ensure | Cross‑platform resilience | Hardcoded relative path |
| Dynamic + merged CORS | Support prod + local without redeploy flipping | Fixed whitelist only |

## 9. Reliability & Resilience Features
- Deterministic schema enforcement for AI output
- Multi‑tier fallbacks instead of hard errors
- Defensive clamps on numeric fields
- In‑memory DB fallback if file open fails (system still alive, albeit ephemeral)
- Central error middleware + logging
- Origin filtering / logging for CORS issues

## 10. Security / Safety Considerations (Current vs Planned)
Current:
- Input size limits (10mb) to mitigate abuse
- No secret leakage in responses (env validation on boot)
- Basic URL sanitization for primary sources
Planned:
- Rate limiting (IP / token bucket)
- API key / auth layer for write or analysis endpoints
- Output moderation (flag extreme content signal anomalies)

## 11. Performance Considerations
Implemented:
- Minimal object allocations; streaming not critical at current scale
- Single DB connection reused
- Concurrency cap (configurable internally) for AI calls
Planned:
- Caching full‑article fetches (ETag / last-mod header reuse)
- Persisting analysis hash to skip re‑scoring unchanged articles
- Batch embedding & vector store for narrative clustering

## 12. Deployment & DevOps
- Build: `tsc` (dist artifacts ensured via `postinstall`)
- Scripts: `build:clean` (rimraf + compile), `start:prod` vs dev with `nodemon + ts-node`
- CORS: Env override + default origins + baked production FE
- Environment validation: Hard fail fast if AI keys absent
- Observability: Console logs (timestamp + method + path) + CORS decisions
Future: Add lightweight pino logger + structured JSON logs + basic metrics endpoint.

## 13. Testing Strategy (Deferred Due to Time)
Planned tiers:
- Unit: bias score validator, source sanitizer, truncation detector
- Integration: /api/articles flow with mock AI
- Contract: JSON schema snapshot tests for responses
Rationale for deferral: focus on shipping functional vertical slice under deadline; architecture structured to be testable (pure helpers).

## 14. AI Tools Usage Disclosure
Primary Editor / Environment:
- VS Code for all coding, navigation, and iterative refactors.

Model & Assistant Usage (Chronological):
1. Claude 4 (browser) – Used upfront for higher‑level problem framing, refining the bias dimensions, and validating the schema shape before implementation. Helped pressure‑test which fields would be explainable to end users.
2. Claude 3.5 – Used for the initial backend scaffolding (Express + TypeScript layout, early service boundaries) because of free‑tier access constraints; prompts were optimized to conserve tokens (drafted structures locally, then asked for targeted improvements instead of long open‑ended sessions).
3. GPT‑5 – Utilized later for final polish passes: tightening validation logic phrasing, refining fallback naming consistency, and minor clarity edits in documentation.
4. Inline Pair (ask mode) – Throughout the build I preferred an “ask / respond” interaction pattern over full autonomous agent execution. This gave tighter control over token usage and prevented over‑engineering tangents; each request was narrowly scoped (e.g., “improve CORS handling”, “harden DB init”).
5. Gemini (Google) – Runtime only: executes the bias scoring via structured `responseSchema`. No fine‑tuning or custom training—pure API inference with deterministic schema enforcement.

Why Multiple Models:
- Separation of concerns: higher‑level reasoning (Claude 4) vs. scaffold speed (Claude 3.5) vs. textual refinement (GPT‑5) vs. runtime scoring (Gemini).
- Reduces single‑model bias in schema design.

Governance & Safety Steps:
- Manual inspection of every schema change before adoption.
- Sanitization layer to strip unsafe / local URLs from AI‑proposed sources.
- Fallback tiers ensure degraded quality never becomes an outage.

Non‑AI Tooling:
- TypeScript compiler, nodemon dev reload, SQLite CLI (spot inspection), git for version control.

No autonomous long‑running agent sessions were used; every AI invocation was deliberate and constrained to a specific improvement or validation goal.

## 15. Time Allocation (Approx.)
| Work Item | Hours |
|-----------|-------|
| Architectural planning & schema design | 1.2 |
| Core services (news fetch, enrichment) | 1.8 |
| Bias analyzer + fallback logic | 2.0 |
| DB layer & resilience | 0.8 |
| CORS + deployment hardening | 0.7 |
| Documentation (README, API, Process) | 1.5 |
| Debugging & refinements | 2.0 |
| **Total** | **10.0** |
All figures are good‑faith approximations within a ~10 hour total budget.

## 16. Known Gaps / Next Priorities
1. True narrative clustering (embedding + vector similarity)
2. Rate limiting & auth keys
3. Persistent article update & re‑score scheduling
4. Detailed error taxonomy surfaced via diagnostics endpoint
5. Automated test suite & CI
6. Observability: request latency + AI call success metrics

## 17. Risks & Mitigations
| Risk | Current Mitigation | Future Action |
|------|--------------------|---------------|
| AI drift / hallucination | Structured schema + evidence phrases | Multi‑model consensus, calibration set |
| Source fetch failures | Graceful fallback (partial article) | Retry with backoff + alternate readability library |
| DB corruption / scale | Lightweight usage only | Migrate to Postgres + migrations |
| Excess token cost | Schema reduces retries | Caching + partial re‑analysis |

## 18. Lessons Learned
- Early investment in structured AI schemas pays off exponentially in reliability
- Enrichment before analysis materially improves bias interpretability
- Shipping vertical slice first surfaces deployment frictions (CORS, DB path) sooner, reducing final crunch risk
- Merging configured + default CORS origins avoids accidental prod lockouts

## 19. Submission Notes
This document is intentionally concrete: it maps strategic choices to code reality. The system is a functional, extensible foundation rather than a speculative plan. Visual polish deferred; emphasis on correctness, resilience, and clarity.

---
(End of Process Document)
