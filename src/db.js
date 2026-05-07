import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  hash          TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  ip            TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uploads_ip_created
  ON uploads(ip, created_at);

CREATE TABLE IF NOT EXISTS upload_counters (
  ip    TEXT NOT NULL,
  day   TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day)
);
`;

export class Db {
  constructor(dbPath) {
    if (!dbPath) throw new Error('dbPath is required');
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);

    this._insertUpload = this.db.prepare(`
      INSERT INTO uploads (hash, original_name, size_bytes, ip, created_at)
      VALUES (@hash, @originalName, @sizeBytes, @ip, @createdAt)
    `);
    this._getUpload = this.db.prepare(`
      SELECT hash, original_name AS originalName, size_bytes AS sizeBytes,
             ip, created_at AS createdAt
      FROM uploads WHERE hash = ?
    `);
    this._getCounter = this.db.prepare(`
      SELECT count FROM upload_counters WHERE ip = ? AND day = ?
    `);
    this._upsertCounter = this.db.prepare(`
      INSERT INTO upload_counters (ip, day, count)
      VALUES (?, ?, ?)
      ON CONFLICT(ip, day) DO UPDATE SET count = count + excluded.count
    `);
  }

  insertUpload(row) {
    try {
      this._insertUpload.run(row);
      return true;
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return false;
      throw err;
    }
  }

  getUpload(hash) {
    return this._getUpload.get(hash) ?? null;
  }

  getCounter(ip, day) {
    const row = this._getCounter.get(ip, day);
    return row ? row.count : 0;
  }

  incrementCounter(ip, day, delta = 1) {
    this._upsertCounter.run(ip, day, delta);
    return this.getCounter(ip, day);
  }

  transaction(fn) {
    return this.db.transaction(fn);
  }

  close() {
    this.db.close();
  }
}
