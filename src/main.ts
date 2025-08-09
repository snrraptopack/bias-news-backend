import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ["GOOGLE_AI_KEY", "GNEWS_API_KEY"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    console.error("Please create a .env file with your API keys");
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

// CORS Configuration (supports comma-separated CORS_ORIGINS env override)
const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'https://bias-news-fe.vercel.app'
];
const configuredOriginsRaw = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
const allowAll = configuredOriginsRaw.includes('*');
// Merge (not replace) so defaults always apply unless overridden by '*'
const allowedOrigins = allowAll
  ? []
  : Array.from(new Set([ ...defaultOrigins, ...configuredOriginsRaw ]));

if (allowAll) {
  console.log('[CORS] Allowing all origins due to * in CORS_ORIGINS');
} else {
  console.log('[CORS] Allowed origins:', allowedOrigins.join(', '));
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // non-browser or same-origin
    if (allowAll || allowedOrigins.includes(origin)) return callback(null, true);
    // Support subdomain wildcard like https://*.onrender.com if specified
    const wildcard = allowedOrigins.find(o => o.startsWith('*.'));
    if (wildcard) {
      const suffix = wildcard.substring(1); // remove leading *
      if (origin.endsWith(suffix)) return callback(null, true);
    }
    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: {
      hasGoogleAIKey: !!process.env.GOOGLE_AI_KEY,
      hasGNewsKey: !!process.env.GNEWS_API_KEY
    }
  });
});

// Routes
import articlesRouter from "./routes/articles";
import narrativesRouter from "./routes/narratives";

app.use('/api/articles', articlesRouter);
app.use('/api/narratives', narrativesRouter);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

app.listen(PORT, () => {
  console.log(`🚀 Bias Lab API running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});
