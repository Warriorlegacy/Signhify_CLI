import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { buildFtsQuery } from './fts-query.js';

export interface MemoryEntry {
  id?: number;
  projectId: string;
  category: 'fact' | 'decision' | 'convention' | 'rule';
  content: string;
  importance: number;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface TaskRecord {
  id: string;
  parentId?: string | null;
  title: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'done';
  progressLog?: string | null;
  updatedAt?: string;
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

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        cwd TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- /history retrieval: BM25 over checkpoint summaries (MiMo-Code
      -- packages/cli/src/memory pattern: FTS retrieval on top of SQLite).
      CREATE VIRTUAL TABLE IF NOT EXISTS checkpoints_fts USING fts5(
        summary,
        content='checkpoints',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS checkpoints_ai AFTER INSERT ON checkpoints BEGIN
        INSERT INTO checkpoints_fts(rowid, summary) VALUES (new.id, new.summary);
      END;

      CREATE TRIGGER IF NOT EXISTS checkpoints_ad AFTER DELETE ON checkpoints BEGIN
        INSERT INTO checkpoints_fts(checkpoints_fts, rowid, summary) VALUES('delete', old.id, old.summary);
      END;
    `);

    // One-time backfill for DBs created before checkpoints_fts existed.
    const ftsCount = (this.db.prepare('SELECT count(*) AS n FROM checkpoints_fts').get() as { n: number }).n;
    const cpCount = (this.db.prepare('SELECT count(*) AS n FROM checkpoints').get() as { n: number }).n;
    if (ftsCount === 0 && cpCount > 0) {
      this.db.exec("INSERT INTO checkpoints_fts(checkpoints_fts) VALUES('rebuild')");
    }
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
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];
    const stmt = this.db.prepare(`
      SELECT m.*, rank
      FROM memory_fts f
      JOIN memory_entries m ON m.id = f.rowid
      WHERE f.memory_fts MATCH ? AND m.project_id = ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(ftsQuery, projectId, limit) as MemoryEntry[];
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

  saveTask(task: {
    id: string;
    parentId?: string | null;
    title: string;
    status?: 'pending' | 'in_progress' | 'blocked' | 'done';
    progressLog?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, parent_id, title, status, progress_log, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        title = excluded.title,
        status = excluded.status,
        progress_log = COALESCE(excluded.progress_log, tasks.progress_log),
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(
      task.id,
      task.parentId ?? null,
      task.title,
      task.status ?? 'pending',
      task.progressLog ?? null
    );
  }

  getTask(id: string): TaskRecord | null {
    const stmt = this.db.prepare(
      'SELECT id, parent_id as parentId, title, status, progress_log as progressLog, updated_at as updatedAt FROM tasks WHERE id = ?'
    );
    const row = stmt.get(id);
    return (row as TaskRecord) ?? null;
  }

  updateTaskStatus(id: string, status: 'pending' | 'in_progress' | 'blocked' | 'done'): void {
    this.db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  }

  appendTaskProgress(id: string, log: string): void {
    this.db.prepare(`
      UPDATE tasks
      SET progress_log = COALESCE(progress_log, '') || ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(log, id);
  }

  getAllTasks(): TaskRecord[] {
    const stmt = this.db.prepare(
      'SELECT id, parent_id as parentId, title, status, progress_log as progressLog, updated_at as updatedAt FROM tasks ORDER BY id ASC'
    );
    return stmt.all() as TaskRecord[];
  }

  close(): void {
    this.db.close();
  }

  /** Append-only checkpoint insert; also feeds the /history FTS via trigger. */
  saveCheckpoint(sessionId: string, summary: string, tokenUsage: number): number {
    const result = this.db
      .prepare(
        'INSERT INTO checkpoints (session_id, summary, token_usage_at_checkpoint) VALUES (?, ?, ?)',
      )
      .run(sessionId, summary, tokenUsage);
    return Number(result.lastInsertRowid);
  }

  /** Register (or re touch) a session; same id resumes the row via upsert. */
  createSession(cwd?: string, id?: string): string {
    const sessionId = id ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.db.prepare(`
      INSERT INTO sessions (id, cwd, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        cwd = COALESCE(excluded.cwd, sessions.cwd),
        updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, cwd ?? null);
    return sessionId;
  }

  listSessions(limit = 20): SessionRecord[] {
    return this.db.prepare(
      'SELECT id, cwd, created_at as createdAt, updated_at as updatedAt FROM sessions ORDER BY created_at DESC, id DESC LIMIT ?',
    ).all(limit) as SessionRecord[];
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare(
      'SELECT id, cwd, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE id = ?',
    ).get(id);
    return (row as SessionRecord) ?? null;
  }

  /** FTS retrieval over checkpoint summaries — the /history read path. */
  searchCheckpoints(query: string, limit = 10, sessionId?: string): CheckpointHit[] {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];
    const stmt = this.db.prepare(`
      SELECT c.id,
             c.session_id as sessionId,
             c.summary,
             c.token_usage_at_checkpoint as tokenUsageAtCheckpoint,
             c.created_at as createdAt,
             snippet(checkpoints_fts, 0, '[', ']', '…', 12) as snippet
      FROM checkpoints_fts f
      JOIN checkpoints c ON c.id = f.rowid
      WHERE checkpoints_fts MATCH ? ${sessionId ? 'AND c.session_id = ?' : ''}
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(ftsQuery, ...(sessionId ? [sessionId] : []), limit) as CheckpointHit[];
  }

  /** Newest checkpoint row for a session — the --resume read path. */
  getCheckpointBySession(sessionId: string): { summary: string;
    tokenUsageAtCheckpoint: number | null;
    createdAt: string | null;
  } | null {
    const row = this.db.prepare(`
      SELECT summary, token_usage_at_checkpoint as tokenUsageAtCheckpoint, created_at as createdAt
      FROM checkpoints WHERE session_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(sessionId) as {
      summary: string;
      tokenUsageAtCheckpoint: number | null;
      createdAt: string | null;
    } | undefined;
    return row ?? null;
  }
}

export interface SessionRecord {
  id: string;
  cwd?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CheckpointHit {
  id: number;
  sessionId: string;
  summary: string;
  tokenUsageAtCheckpoint: number | null;
  createdAt: string | null;
  snippet: string;
}
