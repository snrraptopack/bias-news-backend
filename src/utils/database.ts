import sqlite3 from "sqlite3";
import type { Article } from "./dataStore";
import fs from 'fs';
import path from 'path';

class DatabaseManager {
  private db!: sqlite3.Database; // assigned in constructor with fallback

  constructor() {
    const configuredPath = process.env.DB_PATH || './data/bias_news.db';
    const resolvedPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(process.cwd(), configuredPath);

    try {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error('Failed to ensure database directory:', e);
    }

    let opened = false;
    try {
      this.db = new sqlite3.Database(resolvedPath, (err) => {
        if (err) {
          console.error(`Error opening SQLite at ${resolvedPath}:`, err.message);
        }
      });
      opened = true;
    } catch (e) {
      console.error('SQLite open threw synchronously:', e);
    }

  if (!opened || !this.db) {
      console.warn('Falling back to in-memory SQLite (data will not persist). Set DB_PATH to a writable location.');
      this.db = new sqlite3.Database(':memory:');
    }

    this.initDatabase();
  }

  private initDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
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
        if (err) { reject(err); return; }
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);
          CREATE INDEX IF NOT EXISTS idx_articles_publishedAt ON articles(publishedAt);
          CREATE INDEX IF NOT EXISTS idx_articles_topic ON articles(headline, content);
        `, (err2) => {
          if (err2) { reject(err2); return; }
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
        for (const a of articles) {
          stmt.run(
            a.id,
            a.headline,
            a.content,
            a.description,
            a.source,
            a.author,
            a.publishedAt,
            a.url,
            a.urlToImage,
            a.biasScores ? JSON.stringify(a.biasScores) : null,
            a.narrativeCluster,
            JSON.stringify(a.primarySources || [])
          );
        }
        stmt.finalize((err) => err ? reject(err) : resolve());
      });
    });
  }

  async loadArticles(): Promise<Article[]> {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM articles ORDER BY publishedAt DESC LIMIT 100`, (err, rows) => {
        if (err) { reject(err); return; }
        resolve(rows.map(this.rowToArticle));
      });
    });
  }

  async getArticleById(id: string): Promise<Article | null> {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM articles WHERE id = ?`, [id], (err, row) => {
        if (err) { reject(err); return; }
        if (!row) { resolve(null); return; }
        resolve(this.rowToArticle(row));
      });
    });
  }

  async searchArticles(topic?: string, source?: string, limit: number = 10): Promise<Article[]> {
    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM articles WHERE 1=1`;
      const params: any[] = [];
      if (topic) { query += ` AND (headline LIKE ? OR content LIKE ?)`; params.push(`%${topic}%`, `%${topic}%`); }
      if (source) { query += ` AND source LIKE ?`; params.push(`%${source}%`); }
      query += ` ORDER BY publishedAt DESC LIMIT ?`; params.push(limit);
      this.db.all(query, params, (err, rows) => {
        if (err) { reject(err); return; }
        resolve(rows.map(this.rowToArticle));
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close(err => err ? reject(err) : resolve());
    });
  }

  private rowToArticle(row: any): Article {
    return {
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
    };
  }
}

export const db = new DatabaseManager();