import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

export interface MemoryEntry {
  id?: number;
  projectId: string;
  category: 'fact' | 'decision' | 'convention' | 'rule';
  content: string;
  importance: number;
  createdAt?: string;
  lastUsedAt?: string;
}

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        category TEXT CHECK(category IN ('fact','decision','convention','rule')) NOT NULL,
        content TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        content='memory_entries',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory_entries BEGIN
        INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        token_usage_at_checkpoint INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        title TEXT NOT NULL,
        status TEXT CHECK(status IN ('pending','in_progress','blocked','done')) NOT NULL DEFAULT 'pending',
        progress_log TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  addEntry(entry: MemoryEntry): number {
    const stmt = this.db.prepare(`
      INSERT INTO memory_entries (project_id, category, content, importance)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(entry.projectId, entry.category, entry.content, entry.importance);
    return Number(result.lastInsertRowid);
  }

  search(projectId: string, query: string, limit = 10): MemoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT m.*, rank
      FROM memory_fts f
      JOIN memory_entries m ON m.id = f.rowid
      WHERE f.memory_fts MATCH ? AND m.project_id = ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(query, projectId, limit) as MemoryEntry[];
  }

  getByCategory(projectId: string, category: string, limit = 50): MemoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_entries
      WHERE project_id = ? AND category = ?
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `);
    return stmt.all(projectId, category, limit) as MemoryEntry[];
  }

  getAll(projectId: string, limit = 100): MemoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_entries
      WHERE project_id = ?
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `);
    return stmt.all(projectId, limit) as MemoryEntry[];
  }

  updateLastUsed(id: number): void {
    this.db.prepare('UPDATE memory_entries SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  }

  deleteStale(projectId: string, olderThanDays = 90): number {
    const result = this.db.prepare(`
      DELETE FROM memory_entries
      WHERE project_id = ? AND last_used_at < datetime('now', ?) AND importance < 0.3
    `).run(projectId, `-${olderThanDays} days`);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
