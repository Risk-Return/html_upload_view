import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  hash          TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  ip            TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  uploaded_by   TEXT
);

CREATE INDEX IF NOT EXISTS idx_uploads_ip_created
  ON uploads(ip, created_at);

CREATE TABLE IF NOT EXISTS upload_counters (
  ip    TEXT NOT NULL,
  day   TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day)
);

CREATE TABLE IF NOT EXISTS users (
  email        TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  verified     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  email     TEXT NOT NULL,
  code      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_vc_email_expires
  ON verification_codes(email, expires_at);
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
      INSERT INTO uploads (hash, original_name, size_bytes, ip, created_at, uploaded_by)
      VALUES (@hash, @originalName, @sizeBytes, @ip, @createdAt, @uploadedBy)
    `);
    this._getUpload = this.db.prepare(`
      SELECT hash, original_name AS originalName, size_bytes AS sizeBytes,
             ip, created_at AS createdAt, uploaded_by AS uploadedBy
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

    this._getUser = this.db.prepare(`
      SELECT email, password_hash AS passwordHash, verified, created_at AS createdAt
      FROM users WHERE email = ?
    `);
    this._insertUser = this.db.prepare(`
      INSERT INTO users (email, password_hash, verified, created_at)
      VALUES (@email, @passwordHash, @verified, @createdAt)
    `);
    this._setUserVerified = this.db.prepare(`
      UPDATE users SET verified = 1 WHERE email = ?
    `);
    this._updatePassword = this.db.prepare(`
      UPDATE users SET password_hash = @passwordHash, verified = 1 WHERE email = @email
    `);

    this._insertVerificationCode = this.db.prepare(`
      INSERT INTO verification_codes (email, code, expires_at)
      VALUES (@email, @code, @expiresAt)
    `);
    this._getValidCode = this.db.prepare(`
      SELECT id, email, code, expires_at AS expiresAt, used
      FROM verification_codes
      WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
      ORDER BY id DESC LIMIT 1
    `);
    this._markCodeUsed = this.db.prepare(`
      UPDATE verification_codes SET used = 1 WHERE id = ?
    `);
    this._deleteExpiredCodes = this.db.prepare(`
      DELETE FROM verification_codes WHERE expires_at < ?
    `);
  }

  insertUpload(row) {
    if (row.uploadedBy === undefined) row.uploadedBy = null;
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

  getUser(email) {
    return this._getUser.get(email) ?? null;
  }

  createUser(email, passwordHash) {
    try {
      this._insertUser.run({
        email,
        passwordHash,
        verified: 0,
        createdAt: Date.now(),
      });
      return true;
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return false;
      throw err;
    }
  }

  setUserVerified(email) {
    this._setUserVerified.run(email);
  }

  setPasswordAndVerify(email, passwordHash) {
    this._updatePassword.run({ email, passwordHash });
  }

  createVerificationCode(email, code, expiresAt) {
    this._insertVerificationCode.run({ email, code, expiresAt });
  }

  validateCode(email, code) {
    const now = Date.now();
    return this._getValidCode.get(email, code, now) ?? null;
  }

  markCodeUsed(id) {
    this._markCodeUsed.run(id);
  }

  deleteExpiredCodes() {
    this._deleteExpiredCodes.run(Date.now());
  }

  close() {
    this.db.close();
  }
}
