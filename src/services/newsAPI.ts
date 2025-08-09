import axios from "axios";
import type { BiasScores } from "../utils/dataStore.ts";

interface NewsArticle {
  source: {
    name: string;
  };
  title: string;
  content: string;
  description: string;
  author: string;
  publishedAt: string;
  url: string;
  urlToImage: string;
}

interface FormattedArticle {
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

class NewsAPIService {
  private baseURL: string;
  private enableFullScrape: boolean;

  constructor() {
    this.baseURL = "https://gnews.io/api/v4";
    this.enableFullScrape = (this.getEnv('FULL_CONTENT_SCRAPE') ?? '1') !== '0';
  }

  private getEnv(key: string): string | undefined {
  interface EnvProvider { env?: { get?: (k: string) => string | undefined } }
  const g = globalThis as unknown as { Deno?: EnvProvider; process?: { env?: Record<string,string|undefined> } };
  const deno = g.Deno;
  if (deno?.env?.get) return deno.env.get(key);
  return g.process?.env?.[key];
  }

  private getApiKey(): string {
  const apiKey = this.getEnv('GNEWS_API_KEY');
    if (!apiKey) {
      throw new Error("GNEWS_API_KEY environment variable is required");
    }
    return apiKey;
  }

  async fetchArticlesByTopic(query: string, sources: string[] | null = null, pageSize = 20): Promise<FormattedArticle[]> {
    try {
      if (!query || query.trim().length < 3) {
        throw new Error("Query must be at least 3 characters long");
      }

      const apiKey = this.getApiKey();
      console.log("Fetching articles with params:", { query, sources, pageSize });
      
      const params = {
        q: query.trim(),
        token: apiKey,
        max: Math.min(pageSize, 100), // GNews max is 100
        lang: "en",
        country: "us",
        sortby: "publishedAt"
      };

      if (sources && sources.length > 0) {
        Object.assign(params, { domains: sources.join(",") });
      }

      console.log("Making request to GNews API with URL:", `${this.baseURL}/search`);
      
      const response = await axios.get(`${this.baseURL}/search`, { 
        params,
        timeout: 10000 // 10 second timeout
      });
      
      console.log("Response status:", response.status);
      
      if (!response.data.articles) {
        console.error("Unexpected API response:", response.data);
        throw new Error("Invalid API response format");
      }
      
      const articles = this.formatArticles(response.data.articles);
      console.log(`Successfully fetched ${articles.length} articles`);
      
      return articles;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new Error("Invalid GNews API key");
        } else if (error.response?.status === 429) {
          throw new Error("GNews API rate limit exceeded");
        } else if (error.code === 'ECONNABORTED') {
          throw new Error("GNews API request timeout");
        }
        console.error("GNews API Error:", error.response?.data || error.message);
      } else {
        console.error("GNews API Error:", error instanceof Error ? error.message : error);
      }
      throw new Error("Failed to fetch articles from GNews API");
    }
  }

  private formatArticles(articles: NewsArticle[]): FormattedArticle[] {
    return articles
      .filter(article => {
        if (!article.content || article.content.trim().length < 50) {
          console.log("Skipping article without sufficient content:", article.title);
          return false;
        }
        if (!article.title || article.title.trim().length < 10) {
          console.log("Skipping article with insufficient title:", article.title);
          return false;
        }
        return true;
      })
      .map(article => {
        let rawContent = article.content?.trim() || "";
        const truncIndicators = [
          /\.\.\.$/,                 // ends with ellipsis
          /…$/,                         // unicode ellipsis
          /\[\+?\d+ chars?\]/i,       // [+123 chars]
          /\[\d+ chars?\]/i,
          /\[\d+ words?\]/i
        ];
        const isLikelyTruncated = truncIndicators.some(r => r.test(rawContent));
        if (isLikelyTruncated && article.description && !rawContent.includes(article.description)) {
          rawContent += `\n${article.description.trim()}`;
        }
        if (rawContent.length < 400 && article.description) {
          rawContent += `\n${article.description.trim()}`;
        }
        rawContent = rawContent.replace(/\s*\[\+?\d+ chars?\]\s*$/i, "").trim();

        const formatted: FormattedArticle = {
          id: this.generateId(article.url),
          headline: article.title.trim(),
          content: rawContent,
          description: article.description?.trim() || "",
          source: article.source.name.trim(),
          author: article.author?.trim() || "Unknown",
          publishedAt: article.publishedAt,
          url: article.url,
          urlToImage: article.urlToImage || "",
          biasScores: null,
          narrativeCluster: null,
          primarySources: []
        };

        // Asynchronously enrich full content if truncated/short
        if (this.enableFullScrape && article.url && (isLikelyTruncated || rawContent.length < 800)) {
          this.fetchFullArticle(article.url)
            .then(full => {
              if (full && full.length > formatted.content.length * 1.2) {
                console.log(`Full scrape success: ${formatted.id} ${formatted.content.length} -> ${full.length}`);
                formatted.content = full;
              }
            })
            .catch(err => console.log('Full scrape failed (non-fatal):', err?.message || err));
        }

        return formatted;
      });
  }

  /**
   * Ensure each article has fuller content before AI analysis.
   * Will fetch HTML for truncated or short (<800 chars) content.
   */
  async enrichArticles(articles: FormattedArticle[], concurrency = 3): Promise<void> {
    if (!this.enableFullScrape) return;
    const queue = articles.filter(a => this.needsEnrichment(a));
    let index = 0; const workers: Promise<void>[] = [];
    const run = async () => {
      while (index < queue.length) {
        const current = queue[index++];
        try {
          const full = await this.fetchFullArticle(current.url);
          if (full && full.length > current.content.length * 1.2) {
            console.log(`Pre-enrichment: ${current.id} ${current.content.length} -> ${full.length}`);
            current.content = full;
          }
        } catch (e) {
          console.log('Pre-enrichment failed (ignored):', (e as Error).message);
        }
      }
    };
    for (let i=0;i<concurrency;i++) workers.push(run());
    await Promise.all(workers);
  }

  private needsEnrichment(a: FormattedArticle): boolean {
    const indicators = /\.\.\.$|…$|\[\+?\d+ chars?\]/i;
    return indicators.test(a.content) || a.content.length < 800;
  }

  async fetchFullArticle(url: string): Promise<string | null> { // made public for ad-hoc analysis
    try {
      const resp = await axios.get(url, { timeout: 8000, responseType: 'text' });
      const html: string = resp.data;
      if (!html || typeof html !== 'string') return null;
      const text = this.extractMainText(html);
      if (!text) return null;
      return text.slice(0, 18000);
    } catch {
      return null;
    }
  }

  private extractMainText(html: string): string {
    // strip script/style
    let h = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '');
    // prefer <article>
    const articleMatch = h.match(/<article[\s\S]*?<\/article>/i);
    if (articleMatch) h = articleMatch[0];
    // collect paragraphs
    const paras = h.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
    const texts = paras.map(p => p
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .trim()
    ).filter(t => t.length > 0);
    const joined = texts.join('\n');
    if (joined.length < 300) return '';
    return joined.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  private generateId(url: string): string {
    // Create a hash from the URL to use as ID
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

export default new NewsAPIService();
