import sqlite3 from "sqlite3";
import type { Article, BiasScores } from "./dataStore";

class DatabaseManager {
  private db: sqlite3.Database;

  constructor() {
    this.db = new sqlite3.Database("./data/bias_news.db");
    this.initDatabase();
  }

  private initDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create articles table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS articles (
          id TEXT PRIMARY KEY,
          headline TEXT NOT NULL,
          content TEXT NOT NULL,
          description TEXT,
          source TEXT NOT NULL,
          author TEXT,
          publishedAt TEXT NOT NULL,
          url TEXT UNIQUE NOT NULL,
          urlToImage TEXT,
          biasScores TEXT,
          narrativeCluster TEXT,
          primarySources TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error("Error creating articles table:", err);
          reject(err);
          return;
        }

        // Create indexes for better performance
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);
          CREATE INDEX IF NOT EXISTS idx_articles_publishedAt ON articles(publishedAt);
          CREATE INDEX IF NOT EXISTS idx_articles_topic ON articles(headline, content);
        `, (err) => {
          if (err) {
            console.error("Error creating indexes:", err);
            reject(err);
            return;
          }
          console.log("Database initialized successfully");
          resolve();
        });
      });
    });
  }

  async saveArticles(articles: Article[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO articles 
          (id, headline, content, description, source, author, publishedAt, url, urlToImage, biasScores, narrativeCluster, primarySources)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const article of articles) {
          stmt.run(
            article.id,
            article.headline,
            article.content,
            article.description,
            article.source,
            article.author,
            article.publishedAt,
            article.url,
            article.urlToImage,
            article.biasScores ? JSON.stringify(article.biasScores) : null,
            article.narrativeCluster,
            JSON.stringify(article.primarySources)
          );
        }

        stmt.finalize((err) => {
          if (err) {
            console.error("Error saving articles:", err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  }

  async loadArticles(): Promise<Article[]> {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM articles 
        ORDER BY publishedAt DESC 
        LIMIT 100
      `, (err, rows) => {
        if (err) {
          console.error("Error loading articles:", err);
          reject(err);
          return;
        }
        
        const articles = rows.map((row: any) => ({
          id: row.id,
          headline: row.headline,
          content: row.content,
          description: row.description,
          source: row.source,
          author: row.author,
          publishedAt: row.publishedAt,
          url: row.url,
          urlToImage: row.urlToImage,
          biasScores: row.biasScores ? JSON.parse(row.biasScores) : null,
          narrativeCluster: row.narrativeCluster,
          primarySources: row.primarySources ? JSON.parse(row.primarySources) : []
        }));
        
        resolve(articles);
      });
    });
  }

  async getArticleById(id: string): Promise<Article | null> {
    return new Promise((resolve, reject) => {
      this.db.get("SELECT * FROM articles WHERE id = ?", [id], (err, row) => {
        if (err) {
          console.error("Error getting article by ID:", err);
          reject(err);
          return;
        }
        
        if (!row) {
          resolve(null);
          return;
        }

        const article = {
          id: (row as any).id,
          headline: (row as any).headline,
          content: (row as any).content,
          description: (row as any).description,
          source: (row as any).source,
          author: (row as any).author,
          publishedAt: (row as any).publishedAt,
          url: (row as any).url,
          urlToImage: (row as any).urlToImage,
          biasScores: (row as any).biasScores ? JSON.parse((row as any).biasScores) : null,
          narrativeCluster: (row as any).narrativeCluster,
          primarySources: (row as any).primarySources ? JSON.parse((row as any).primarySources) : []
        };
        
        resolve(article);
      });
    });
  }

  async searchArticles(topic?: string, source?: string, limit: number = 10): Promise<Article[]> {
    return new Promise((resolve, reject) => {
      let query = "SELECT * FROM articles WHERE 1=1";
      const params: any[] = [];

      if (topic) {
        query += " AND (headline LIKE ? OR content LIKE ?)";
        params.push(`%${topic}%`, `%${topic}%`);
      }

      if (source) {
        query += " AND source LIKE ?";
        params.push(`%${source}%`);
      }

      query += " ORDER BY publishedAt DESC LIMIT ?";
      params.push(limit);

      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error("Error searching articles:", err);
          reject(err);
          return;
        }
        
        const articles = rows.map((row: any) => ({
          id: row.id,
          headline: row.headline,
          content: row.content,
          description: row.description,
          source: row.source,
          author: row.author,
          publishedAt: row.publishedAt,
          url: row.url,
          urlToImage: row.urlToImage,
          biasScores: row.biasScores ? JSON.parse(row.biasScores) : null,
          narrativeCluster: row.narrativeCluster,
          primarySources: row.primarySources ? JSON.parse(row.primarySources) : []
        }));
        
        resolve(articles);
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          console.error("Error closing database:", err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

// Export singleton instance
export const db = new DatabaseManager(); 