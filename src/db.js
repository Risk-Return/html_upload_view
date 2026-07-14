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
  uploaded_by   TEXT,
  kind          TEXT NOT NULL DEFAULT 'html',
  entry_file    TEXT
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

CREATE TABLE IF NOT EXISTS access_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_hash TEXT NOT NULL,
  token       TEXT NOT NULL,
  max_uses    INTEGER NOT NULL DEFAULT -1,
  used_count  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE(upload_hash, token),
  FOREIGN KEY (upload_hash) REFERENCES uploads(hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_tokens_hash
  ON access_tokens(upload_hash);

CREATE TABLE IF NOT EXISTS visit_stats (
  upload_hash  TEXT NOT NULL,
  ip           TEXT NOT NULL,
  visit_count  INTEGER NOT NULL DEFAULT 0,
  first_visit  INTEGER NOT NULL,
  last_visit   INTEGER NOT NULL,
  PRIMARY KEY (upload_hash, ip),
  FOREIGN KEY (upload_hash) REFERENCES uploads(hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_visit_stats_hash
  ON visit_stats(upload_hash);
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

    this._migrate();

    this._insertUpload = this.db.prepare(`
      INSERT INTO uploads (hash, original_name, size_bytes, ip, created_at, uploaded_by, kind, entry_file)
      VALUES (@hash, @originalName, @sizeBytes, @ip, @createdAt, @uploadedBy, @kind, @entryFile)
    `);
    this._getUpload = this.db.prepare(`
      SELECT hash, original_name AS originalName, size_bytes AS sizeBytes,
             ip, created_at AS createdAt, uploaded_by AS uploadedBy,
             kind, entry_file AS entryFile
      FROM uploads WHERE hash = ?
    `);
    this._getUploadsByUser = this.db.prepare(`
      SELECT hash, original_name AS originalName, size_bytes AS sizeBytes,
             created_at AS createdAt, kind, entry_file AS entryFile
      FROM uploads WHERE uploaded_by = ?
      ORDER BY created_at DESC
      LIMIT 50
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

    this._insertAccessToken = this.db.prepare(`
      INSERT INTO access_tokens (upload_hash, token, max_uses, used_count, created_at)
      VALUES (@uploadHash, @token, @maxUses, 0, @createdAt)
    `);
    this._getAccessTokens = this.db.prepare(`
      SELECT id, upload_hash AS uploadHash, token, max_uses AS maxUses,
             used_count AS usedCount, created_at AS createdAt
      FROM access_tokens WHERE upload_hash = ?
      ORDER BY created_at ASC
    `);
    this._getAccessToken = this.db.prepare(`
      SELECT id, upload_hash AS uploadHash, token, max_uses AS maxUses,
             used_count AS usedCount, created_at AS createdAt
      FROM access_tokens WHERE id = ?
    `);
    this._getAccessTokenByToken = this.db.prepare(`
      SELECT id, upload_hash AS uploadHash, token, max_uses AS maxUses,
             used_count AS usedCount, created_at AS createdAt
      FROM access_tokens WHERE upload_hash = ? AND token = ?
    `);
    this._deleteAccessToken = this.db.prepare(`
      DELETE FROM access_tokens WHERE id = ?
    `);
    this._deleteAccessTokensByHash = this.db.prepare(`
      DELETE FROM access_tokens WHERE upload_hash = ?
    `);
    this._updateAccessToken = this.db.prepare(`
      UPDATE access_tokens SET token = @token, max_uses = @maxUses WHERE id = @id
    `);
    this._incrementTokenUsage = this.db.prepare(`
      UPDATE access_tokens SET used_count = used_count + 1 WHERE id = ?
    `);
    this._hasAccessTokens = this.db.prepare(`
      SELECT 1 FROM access_tokens WHERE upload_hash = ? LIMIT 1
    `);

    this._upsertVisit = this.db.prepare(`
      INSERT INTO visit_stats (upload_hash, ip, visit_count, first_visit, last_visit)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(upload_hash, ip) DO UPDATE SET
        visit_count = visit_count + 1,
        last_visit = excluded.last_visit
    `);
    this._getVisitSummary = this.db.prepare(`
      SELECT
        COUNT(*)         AS uniqueIps,
        COALESCE(SUM(visit_count), 0) AS totalVisits
      FROM visit_stats WHERE upload_hash = ?
    `);
    this._getVisitStatsByIp = this.db.prepare(`
      SELECT ip,
             visit_count AS visitCount,
             first_visit AS firstVisit,
             last_visit  AS lastVisit
      FROM visit_stats WHERE upload_hash = ?
      ORDER BY visit_count DESC, last_visit DESC
    `);
  }

  insertUpload(row) {
    if (row.uploadedBy === undefined) row.uploadedBy = null;
    if (row.kind === undefined) row.kind = 'html';
    if (row.entryFile === undefined) row.entryFile = null;
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

  getUploadsByUser(email) {
    return this._getUploadsByUser.all(email);
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

  updatePassword(email, passwordHash) {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(passwordHash, email);
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

  addAccessToken(uploadHash, token, maxUses = -1) {
    if (!uploadHash) throw new Error('uploadHash is required');
    if (!token || typeof token !== 'string' || token.length === 0) {
      throw new Error('token is required');
    }
    if (!Number.isInteger(maxUses)) throw new Error('maxUses must be an integer');
    try {
      this._insertAccessToken.run({
        uploadHash,
        token,
        maxUses,
        createdAt: Date.now(),
      });
      return this._getAccessTokenByToken.get(uploadHash, token);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
      throw err;
    }
  }

  getAccessTokens(uploadHash) {
    return this._getAccessTokens.all(uploadHash);
  }

  getAccessToken(id) {
    return this._getAccessToken.get(id) ?? null;
  }

  deleteAccessToken(id) {
    return this._deleteAccessToken.run(id).changes > 0;
  }

  updateAccessToken(id, token, maxUses) {
    if (!token || typeof token !== 'string' || token.length === 0) {
      throw new Error('token is required');
    }
    if (!Number.isInteger(maxUses)) throw new Error('maxUses must be an integer');
    try {
      return this._updateAccessToken.run({ id, token, maxUses }).changes > 0;
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
      throw err;
    }
  }

  replaceAccessTokens(uploadHash, tokens) {
    if (!Array.isArray(tokens)) throw new Error('tokens must be an array');
    return this.transaction(() => {
      this._deleteAccessTokensByHash.run(uploadHash);
      const result = [];
      for (const t of tokens) {
        const row = this.addAccessToken(uploadHash, t.token, t.maxUses ?? -1);
        if (row) result.push(row);
      }
      return result;
    })();
  }

  hasAccessTokens(uploadHash) {
    return this._hasAccessTokens.get(uploadHash) !== undefined;
  }

  validateAccessToken(uploadHash, token) {
    if (!uploadHash || !token) return { valid: false, remaining: 0 };
    return this.transaction(() => {
      const row = this._getAccessTokenByToken.get(uploadHash, token);
      if (!row) return { valid: false, remaining: 0 };
      if (row.maxUses !== -1 && row.usedCount >= row.maxUses) {
        return { valid: false, remaining: 0, exhausted: true };
      }
      this._incrementTokenUsage.run(row.id);
      const remaining = row.maxUses === -1 ? -1 : row.maxUses - (row.usedCount + 1);
      return { valid: true, remaining };
    })();
  }

  verifyAccessToken(uploadHash, token) {
    if (!uploadHash || !token) return { valid: false, remaining: 0 };
    const row = this._getAccessTokenByToken.get(uploadHash, token);
    if (!row) return { valid: false, remaining: 0 };
    if (row.maxUses !== -1 && row.usedCount >= row.maxUses) {
      return { valid: false, remaining: 0, exhausted: true };
    }
    const remaining = row.maxUses === -1 ? -1 : row.maxUses - row.usedCount;
    return { valid: true, remaining };
  }

  recordVisit(uploadHash, ip) {
    if (!uploadHash) return;
    const now = Date.now();
    try {
      this._upsertVisit.run(uploadHash, ip || 'unknown', now, now);
    } catch {
      // FK violation: upload doesn't exist — silently ignore
    }
  }

  getVisitStats(uploadHash) {
    const summary = this._getVisitSummary.get(uploadHash) ?? { uniqueIps: 0, totalVisits: 0 };
    const byIp = this._getVisitStatsByIp.all(uploadHash);
    return {
      totalVisits: summary.totalVisits,
      uniqueIps: summary.uniqueIps,
      byIp,
    };
  }

  close() {
    this.db.close();
  }

  _migrate() {
    const cols = this.db.pragma('table_info(uploads)');
    const has = (name) => cols.some((c) => c.name === name);
    if (!has('uploaded_by')) {
      this.db.exec('ALTER TABLE uploads ADD COLUMN uploaded_by TEXT');
    }
    if (!has('kind')) {
      this.db.exec("ALTER TABLE uploads ADD COLUMN kind TEXT NOT NULL DEFAULT 'html'");
    }
    if (!has('entry_file')) {
      this.db.exec('ALTER TABLE uploads ADD COLUMN entry_file TEXT');
    }
  }
}
