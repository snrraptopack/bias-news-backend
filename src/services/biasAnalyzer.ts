import { GoogleGenAI, Type } from "@google/genai";
// Minimal console typing fallback
declare const console: { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
import type { BiasScores } from "../utils/dataStore.ts";

interface Article {
  headline: string;
  content: string;
  source: string;
}

// Structured schema definition for Gemini 2.5
const biasScoresSchema = {
  type: Type.OBJECT,
  properties: {
    ideologicalStance: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.INTEGER },
        label: { type: Type.STRING, enum: ["far-left","left","center-left","center","center-right","right","far-right"] },
        confidence: { type: Type.NUMBER },
        highlightedPhrases: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 5 },
        reasoning: { type: Type.STRING }
      },
      required: ["score","label","confidence","highlightedPhrases","reasoning"],
      propertyOrdering: ["score","label","confidence","highlightedPhrases","reasoning"]
    },
    factualGrounding: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.INTEGER },
        label: { type: Type.STRING, enum: ["poor","moderate","good","excellent"] },
        confidence: { type: Type.NUMBER },
        highlightedPhrases: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 5 },
        reasoning: { type: Type.STRING }
      },
      required: ["score","label","confidence","highlightedPhrases","reasoning"],
      propertyOrdering: ["score","label","confidence","highlightedPhrases","reasoning"]
    },
    framingChoices: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.INTEGER },
        label: { type: Type.STRING, enum: ["misleading","biased","balanced","objective"] },
        confidence: { type: Type.NUMBER },
        highlightedPhrases: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 5 },
        reasoning: { type: Type.STRING }
      },
      required: ["score","label","confidence","highlightedPhrases","reasoning"],
      propertyOrdering: ["score","label","confidence","highlightedPhrases","reasoning"]
    },
    emotionalTone: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.INTEGER },
        label: { type: Type.STRING, enum: ["inflammatory","emotional","neutral","objective"] },
        confidence: { type: Type.NUMBER },
        highlightedPhrases: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 5 },
        reasoning: { type: Type.STRING }
      },
      required: ["score","label","confidence","highlightedPhrases","reasoning"],
      propertyOrdering: ["score","label","confidence","highlightedPhrases","reasoning"]
    },
    sourceTransparency: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.INTEGER },
        label: { type: Type.STRING, enum: ["vague","limited","clear","excellent"] },
        confidence: { type: Type.NUMBER },
        highlightedPhrases: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 5 },
        reasoning: { type: Type.STRING }
      },
      required: ["score","label","confidence","highlightedPhrases","reasoning"],
      propertyOrdering: ["score","label","confidence","highlightedPhrases","reasoning"]
    },
    overallBiasLevel: { type: Type.INTEGER },
    primarySources: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 15 },
    analyzedAt: { type: Type.STRING }
  },
  required: ["ideologicalStance","factualGrounding","framingChoices","emotionalTone","sourceTransparency","overallBiasLevel","primarySources","analyzedAt"],
  propertyOrdering: [
    "ideologicalStance","factualGrounding","framingChoices","emotionalTone","sourceTransparency","overallBiasLevel","primarySources","analyzedAt"
  ]
} as const;

class BiasAnalyzer {
  private client: GoogleGenAI | null = null;

  private getEnv(key: string): string | undefined {
    // Deno environment
    const globalAny: Record<string, unknown> = globalThis as unknown as Record<string, unknown>;
    const denoObj = globalAny.Deno as { env?: { get?: (k: string) => string | undefined } } | undefined;
    if (denoObj?.env?.get) return denoObj.env.get(key);
    // Node environment (non-invasive access)
    const nodeProcess = globalAny.process as { env?: Record<string, string | undefined> } | undefined;
    return nodeProcess?.env?.[key];
  }

  private getApiKey(): string {
    const apiKey = this.getEnv('GOOGLE_AI_KEY');
    if (!apiKey) {
      throw new Error("GOOGLE_AI_KEY environment variable is required");
    }
    return apiKey;
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: this.getApiKey() });
    }
    return this.client;
  }

  async analyzeArticle(article: Article): Promise<BiasScores> {
    if (!article.headline || !article.content) {
      throw new Error("Article must have headline and content");
    }

    // Guard: if content too short, skip expensive model call
    if (article.content.trim().length < 240) {
      const fallback = this.getMockBiasScores('fallback-empty');
      fallback.ideologicalStance.reasoning = 'Content too short for reliable AI analysis';
      return fallback;
    }

    // Trim very long content to control latency (hard cap ~10k chars)
    const MAX_CHARS = 10000;
    if (article.content.length > MAX_CHARS) {
      article.content = article.content.substring(0, MAX_CHARS) + "\n[TRUNCATED_FOR_ANALYSIS]";
    }

  const startTime = Date.now();
  const prompt = this.buildAnalysisPrompt(article);
    
    try {
      console.log(`Analyzing article: "${article.headline.substring(0, 50)}..."`);
      
      const ai = this.getClient();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: biasScoresSchema,
          temperature: 0.1
        }
      });
      const r: unknown = response;
      let text: string;
      if (r && typeof r === 'object' && 'text' in r) {
        const t: unknown = (r as Record<string, unknown>).text;
        if (typeof t === 'function') {
          try { text = (t as () => string)(); } catch { text = ''; }
        } else if (typeof t === 'string') {
          text = t;
        } else {
          text = '';
        }
      } else {
        text = '';
      }
      
      const analysisTime = Date.now() - startTime;
      console.log(`Analysis completed in ${analysisTime}ms`);
      
      try {
  const analysis = JSON.parse(text) as BiasScores;
  const validatedAnalysis = this.validateAndFormatBiasScores(analysis);
  validatedAnalysis.analysisStatus = 'ai';
  validatedAnalysis.isFallback = false;
  this.attachConfidenceIntervals(validatedAnalysis);
        
        // Log performance metrics
        if (analysisTime > 500) {
          console.warn(`⚠️ Analysis took ${analysisTime}ms (target: <500ms)`);
        } else {
          console.log(`✅ Analysis completed in ${analysisTime}ms`);
        }
        
        return validatedAnalysis;
      } catch (parseError) {
  console.error('Failed to parse structured Gemini response:', parseError);
        const fallback = this.getMockBiasScores('fallback-parse');
        this.attachConfidenceIntervals(fallback);
        return fallback;
      }
    } catch (error) {
      console.error('Bias analysis error:', error);
      console.log('Using fallback scores due to API error');
      const fallback = this.getMockBiasScores('fallback-api');
      this.attachConfidenceIntervals(fallback);
      return fallback;
    }
  }

  private buildAnalysisPrompt(article: Article): string {
    return `You are an expert media bias analyst. Analyze the full article content across 5 bias dimensions and extract required fields succinctly. Provide precise phrases (max 3 per dimension).` +
      `\nTitle: ${article.headline}\nSource: ${article.source}\nFULL_CONTENT_START\n${article.content}\nFULL_CONTENT_END`;
  }

  private validateAndFormatBiasScores(analysis: BiasScores): BiasScores {
    // Validate and clamp scores to 0-100 range
    const clampScore = (score: number) => Math.max(0, Math.min(100, score));
    const clampConfidence = (conf: number) => Math.max(0, Math.min(1, conf));

    const sanitizePrimarySources = (sources: unknown): string[] => {
      if (!Array.isArray(sources)) return [];
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of sources) {
        if (typeof raw !== 'string') continue;
        let url = raw.trim();
        if (!url) continue;
        // Drop obviously internal / dev / API references or front-end routed paths
        const lower = url.toLowerCase();
        if (lower.includes('localhost:') || lower.includes('/api/articles/') || lower.startsWith('/')) continue;
        // If it looks like a bare domain, attempt to prefix https
        if (!/^https?:\/\//i.test(url)) {
          if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(url)) {
            url = 'https://' + url;
          } else {
            continue; // not a recognizable external source
          }
        }
        // Basic URL validation
        try {
          const u = new URL(url);
          if (!['http:', 'https:'].includes(u.protocol)) continue;
          // discard if host still localhost like dev host
          if (u.hostname === 'localhost') continue;
          // remove tracking params (basic)
          u.search = '';
          const finalUrl = u.toString();
          if (!seen.has(finalUrl)) {
            seen.add(finalUrl);
            cleaned.push(finalUrl);
          }
        } catch {
          continue;
        }
      }
      return cleaned.slice(0, 15); // enforce schema max
    };

    const validatedAnalysis = {
      ideologicalStance: {
        score: clampScore(analysis.ideologicalStance?.score || 50),
        label: analysis.ideologicalStance?.label || "moderate",
        confidence: clampConfidence(analysis.ideologicalStance?.confidence || 0.5),
        highlightedPhrases: analysis.ideologicalStance?.highlightedPhrases || [],
        reasoning: analysis.ideologicalStance?.reasoning || "Analysis incomplete"
      },
      factualGrounding: {
        score: clampScore(analysis.factualGrounding?.score || 50),
        label: analysis.factualGrounding?.label || "moderate",
        confidence: clampConfidence(analysis.factualGrounding?.confidence || 0.5),
        highlightedPhrases: analysis.factualGrounding?.highlightedPhrases || [],
        reasoning: analysis.factualGrounding?.reasoning || "Analysis incomplete"
      },
      framingChoices: {
        score: clampScore(analysis.framingChoices?.score || 50),
        label: analysis.framingChoices?.label || "moderate",
        confidence: clampConfidence(analysis.framingChoices?.confidence || 0.5),
        highlightedPhrases: analysis.framingChoices?.highlightedPhrases || [],
        reasoning: analysis.framingChoices?.reasoning || "Analysis incomplete"
      },
      emotionalTone: {
        score: clampScore(analysis.emotionalTone?.score || 50),
        label: analysis.emotionalTone?.label || "moderate",
        confidence: clampConfidence(analysis.emotionalTone?.confidence || 0.5),
        highlightedPhrases: analysis.emotionalTone?.highlightedPhrases || [],
        reasoning: analysis.emotionalTone?.reasoning || "Analysis incomplete"
      },
      sourceTransparency: {
        score: clampScore(analysis.sourceTransparency?.score || 50),
        label: analysis.sourceTransparency?.label || "moderate",
        confidence: clampConfidence(analysis.sourceTransparency?.confidence || 0.5),
        highlightedPhrases: analysis.sourceTransparency?.highlightedPhrases || [],
        reasoning: analysis.sourceTransparency?.reasoning || "Analysis incomplete"
      },
      overallBiasLevel: clampScore(analysis.overallBiasLevel || 50),
  primarySources: sanitizePrimarySources(analysis.primarySources),
      analyzedAt: analysis.analyzedAt || new Date().toISOString()
    };

    return validatedAnalysis;
  }

  private attachConfidenceIntervals(analysis: BiasScores) {
    type DimensionKey = 'ideologicalStance'|'factualGrounding'|'framingChoices'|'emotionalTone'|'sourceTransparency';
    const makeCI = (score: number, confidence: number) => {
      const maxWidth = 40;
      const width = Math.max(4, Math.round(maxWidth * (1 - confidence)));
      const half = Math.round(width / 2);
      const lower = Math.max(0, score - half);
      const upper = Math.min(100, score + half);
      return { lower, upper, width: upper - lower };
    };
    const dims: DimensionKey[] = ['ideologicalStance','factualGrounding','framingChoices','emotionalTone','sourceTransparency'];
    dims.forEach(d => {
      const dim = analysis[d];
      if (dim && typeof dim.score === 'number' && typeof dim.confidence === 'number') {
        dim.confidenceInterval = makeCI(dim.score, dim.confidence);
      }
    });
  }

  private getMockBiasScores(reason: 'fallback-api' | 'fallback-parse' | 'fallback-empty' = 'fallback-empty'): BiasScores {
    return {
      ideologicalStance: {
        score: 50,
        label: "center",
        confidence: 0.3,
        highlightedPhrases: ["AI analysis unavailable"],
        reasoning: "Unable to perform AI analysis due to API limitations. Using neutral baseline scores."
      },
      factualGrounding: {
        score: 60,
        label: "moderate",
        confidence: 0.3,
        highlightedPhrases: ["Source verification pending"],
        reasoning: "Article appears to have standard news structure but source verification requires AI analysis."
      },
      framingChoices: {
        score: 55,
        label: "moderate",
        confidence: 0.3,
        highlightedPhrases: ["Framing analysis pending"],
        reasoning: "Standard news format detected but detailed framing analysis requires AI processing."
      },
      emotionalTone: {
        score: 65,
        label: "moderate",
        confidence: 0.3,
        highlightedPhrases: ["Tone analysis pending"],
        reasoning: "Article appears to use standard news language but emotional tone analysis requires AI."
      },
      sourceTransparency: {
        score: 55,
        label: "moderate",
        confidence: 0.3,
        highlightedPhrases: ["Transparency analysis pending"],
        reasoning: "Standard attribution patterns detected but detailed transparency analysis requires AI."
      },
      overallBiasLevel: 57,
  primarySources: [],
  analyzedAt: new Date().toISOString(),
  analysisStatus: reason,
  isFallback: true
    };
  }
}

export default new BiasAnalyzer();
