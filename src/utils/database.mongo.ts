import { MongoClient, Collection } from 'mongodb';
import type { Article } from './dataStore';

export class MongoDatabaseManager {
  private client!: MongoClient;
  private collection!: Collection<Article & { _id?: string }>;
  private ready: Promise<void>;

  constructor() {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME || 'biaslab';
    if (!uri) {
      throw new Error('MONGODB_URI not set');
    }
    this.ready = this.init(uri, dbName);
  }

  private async init(uri: string, dbName: string) {
    this.client = new MongoClient(uri, { ignoreUndefined: true });
    await this.client.connect();
    const db = this.client.db(dbName);
    this.collection = db.collection<Article>('articles');
    // Indexes similar to SQLite
    await this.collection.createIndexes([
      { key: { source: 1 } },
      { key: { publishedAt: -1 } },
      { key: { headline: 'text', content: 'text' } },
      { key: { url: 1 }, unique: true }
    ]);
  }

  async saveArticles(articles: Article[]): Promise<void> {
    await this.ready;
    if (!articles.length) return;
    const ops = articles.map(a => ({
      updateOne: {
        filter: { id: a.id },
        update: { $set: { ...a } },
        upsert: true
      }
    }));
    await this.collection.bulkWrite(ops, { ordered: false });
  }

  async loadArticles(): Promise<Article[]> {
    await this.ready;
    const docs = await this.collection.find({}, { sort: { publishedAt: -1 }, limit: 100 }).toArray();
    return docs.map(this.stripMongoId);
  }

  async getArticleById(id: string): Promise<Article | null> {
    await this.ready;
    const doc = await this.collection.findOne({ id });
    return doc ? this.stripMongoId(doc) : null;
  }

  async searchArticles(topic?: string, source?: string, limit: number = 10): Promise<Article[]> {
    await this.ready;
    const query: any = {};
    if (source) query.source = { $regex: source, $options: 'i' };
    if (topic) {
      // Use text index if available; fallback to regex OR
      query.$text = { $search: topic };
    }
    const cursor = this.collection.find(query, { sort: { publishedAt: -1 }, limit });
    const docs = await cursor.toArray();
    return docs.map(this.stripMongoId);
  }

  async close(): Promise<void> {
    if (this.client) await this.client.close();
  }

  private stripMongoId(doc: any): Article {
    const { _id, ...rest } = doc;
    return rest as Article;
  }
}
