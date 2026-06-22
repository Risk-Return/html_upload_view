import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../../src/server.js';
import { signToken } from '../../src/auth/token.js';
import { hashPassword } from '../../src/auth/crypto.js';

process.env.NODE_ENV = 'test';

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'huv-tokens-'));
}

function buildMultipart(files, fields, boundary = '----huvtest') {
  const chunks = [];
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="files"; filename="${f.filename}"\r\n` +
          `Content-Type: ${f.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(Buffer.isBuffer(f.body) ? f.body : Buffer.from(f.body));
    chunks.push(Buffer.from('\r\n'));
  }
  for (const [name, value] of Object.entries(fields || {})) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

function createTestUser(app, email = 'test@example.com') {
  if (!app.db.getUser(email)) {
    app.db.createUser(email, hashPassword('test123'));
    app.db.setUserVerified(email);
  }
  return signToken({ email }, app.config.tokenSecret, app.config.tokenExpirySeconds);
}

async function withApp(fn) {
  const dir = tmpDataDir();
  const app = await buildServer({ DATA_DIR: dir });
  try {
    await fn(app, dir);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function uploadWithTokens(app, tokens, ip = '8.8.8.1') {
  const token = createTestUser(app);
  const fields = {};
  if (tokens) {
    fields.access_tokens = JSON.stringify(tokens);
  }
  const mp = buildMultipart(
    [{ filename: 'doc.html', contentType: 'text/html', body: '<h1>hello</h1>' }],
    fields,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/api/upload',
    headers: { ...mp.headers, 'x-forwarded-for': ip, cookie: `token=${token}` },
    payload: mp.body,
  });
  assert.equal(res.statusCode, 201, `upload failed: ${res.body}`);
  return res.json().uploads[0];
}

// ---- DB-level tests ----

test('DB: addAccessToken and validate', async () => {
  await withApp(async (app) => {
    const db = app.db;
    db.insertUpload({
      hash: 'testTokenHash1',
      originalName: 'a.html',
      sizeBytes: 10,
      ip: '1.1.1.1',
      createdAt: Date.now(),
    });

    const row = db.addAccessToken('testTokenHash1', 'secret123', 3);
    assert.ok(row);
    assert.equal(row.token, 'secret123');
    assert.equal(row.maxUses, 3);
    assert.equal(row.usedCount, 0);

    const tokens = db.getAccessTokens('testTokenHash1');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].token, 'secret123');

    assert.ok(db.hasAccessTokens('testTokenHash1'));
  });
});

test('DB: validateAccessToken increments and respects max_uses', async () => {
  await withApp(async (app) => {
    const db = app.db;
    db.insertUpload({
      hash: 'testTokenHash2',
      originalName: 'a.html',
      sizeBytes: 10,
      ip: '1.1.1.1',
      createdAt: Date.now(),
    });
    db.addAccessToken('testTokenHash2', 'pw', 2);

    const r1 = db.validateAccessToken('testTokenHash2', 'pw');
    assert.equal(r1.valid, true);
    assert.equal(r1.remaining, 1);

    const r2 = db.validateAccessToken('testTokenHash2', 'pw');
    assert.equal(r2.valid, true);
    assert.equal(r2.remaining, 0);

    const r3 = db.validateAccessToken('testTokenHash2', 'pw');
    assert.equal(r3.valid, false);
    assert.equal(r3.exhausted, true);
  });
});

test('DB: validateAccessToken with unlimited max_uses', async () => {
  await withApp(async (app) => {
    const db = app.db;
    db.insertUpload({
      hash: 'testTokenHash3',
      originalName: 'a.html',
      sizeBytes: 10,
      ip: '1.1.1.1',
      createdAt: Date.now(),
    });
    db.addAccessToken('testTokenHash3', 'forever', -1);

    for (let i = 0; i < 10; i++) {
      const r = db.validateAccessToken('testTokenHash3', 'forever');
      assert.equal(r.valid, true);
      assert.equal(r.remaining, -1);
    }
  });
});

test('DB: invalid token returns valid=false', async () => {
  await withApp(async (app) => {
    const db = app.db;
    db.insertUpload({
      hash: 'testTokenHash4',
      originalName: 'a.html',
      sizeBytes: 10,
      ip: '1.1.1.1',
      createdAt: Date.now(),
    });
    db.addAccessToken('testTokenHash4', 'good', -1);

    const r = db.validateAccessToken('testTokenHash4', 'bad');
    assert.equal(r.valid, false);
  });
});

test('DB: hasAccessTokens returns false when no tokens', async () => {
  await withApp(async (app) => {
    const db = app.db;
    db.insertUpload({
      hash: 'testTokenHash5',
      originalName: 'a.html',
      sizeBytes: 10,
      ip: '1.1.1.1',
      createdAt: Date.now(),
    });
    assert.equal(db.hasAccessTokens('testTokenHash5'), false);
  });
});

test('DB: replaceAccessTokens replaces all tokens', async () => {
  await withApp(async (app) => {
    const db = app.db;
    db.insertUpload({
      hash: 'testTokenHash6',
      originalName: 'a.html',
      sizeBytes: 10,
      ip: '1.1.1.1',
      createdAt: Date.now(),
    });
    db.addAccessToken('testTokenHash6', 'old1', -1);
    db.addAccessToken('testTokenHash6', 'old2', 5);

    const result = db.replaceAccessTokens('testTokenHash6', [
      { token: 'new1', maxUses: 10 },
      { token: 'new2', maxUses: -1 },
    ]);
    assert.equal(result.length, 2);

    const tokens = db.getAccessTokens('testTokenHash6');
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0].token, 'new1');
    assert.equal(tokens[1].token, 'new2');
  });
});

test('DB: deleteAccessToken removes a single token', async () => {
  await withApp(async (app) => {
    const db = app.db;
    db.insertUpload({
      hash: 'testTokenHash7',
      originalName: 'a.html',
      sizeBytes: 10,
      ip: '1.1.1.1',
      createdAt: Date.now(),
    });
    const t1 = db.addAccessToken('testTokenHash7', 't1', -1);
    db.addAccessToken('testTokenHash7', 't2', -1);

    assert.equal(db.deleteAccessToken(t1.id), true);
    const tokens = db.getAccessTokens('testTokenHash7');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].token, 't2');
  });
});

test('DB: addAccessToken returns null on duplicate', async () => {
  await withApp(async (app) => {
    const db = app.db;
    db.insertUpload({
      hash: 'testTokenHash8',
      originalName: 'a.html',
      sizeBytes: 10,
      ip: '1.1.1.1',
      createdAt: Date.now(),
    });
    const first = db.addAccessToken('testTokenHash8', 'dup', -1);
    assert.ok(first);
    const second = db.addAccessToken('testTokenHash8', 'dup', -1);
    assert.equal(second, null);
  });
});

// ---- API-level tests ----

test('API: upload with access_tokens creates tokens for each upload', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [
      { token: 'viewpass', maxUses: 5 },
    ]);
    const tokens = app.db.getAccessTokens(u.hash);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].token, 'viewpass');
    assert.equal(tokens[0].maxUses, 5);
  });
});

test('API: upload with multiple tokens', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [
      { token: 't1', maxUses: 3 },
      { token: 't2', maxUses: -1 },
    ]);
    const tokens = app.db.getAccessTokens(u.hash);
    assert.equal(tokens.length, 2);
  });
});

test('API: raw returns 401 when token required but not provided', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'secret', maxUses: -1 }]);
    const res = await app.inject({ method: 'GET', url: `/raw/${u.hash}` });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, 'token_required');
  });
});

test('API: raw returns 403 with wrong token', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'secret', maxUses: -1 }]);
    const res = await app.inject({ method: 'GET', url: `/raw/${u.hash}?token=wrong` });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error, 'invalid_token');
  });
});

test('API: raw returns 200 with correct token', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'secret', maxUses: -1 }]);
    const res = await app.inject({ method: 'GET', url: `/raw/${u.hash}?token=secret` });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
  });
});

test('API: raw returns 403 when token exhausted', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'once', maxUses: 1 }]);
    const r1 = await app.inject({ method: 'GET', url: `/raw/${u.hash}?token=once` });
    assert.equal(r1.statusCode, 200);
    const r2 = await app.inject({ method: 'GET', url: `/raw/${u.hash}?token=once` });
    assert.equal(r2.statusCode, 403);
    assert.equal(r2.json().error, 'token_exhausted');
  });
});

test('API: raw works without token when no tokens configured', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, null);
    const res = await app.inject({ method: 'GET', url: `/raw/${u.hash}` });
    assert.equal(res.statusCode, 200);
  });
});

test('API: token-check returns requiresToken=true when tokens exist', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'x', maxUses: -1 }]);
    const res = await app.inject({ method: 'GET', url: `/api/uploads/${u.hash}/token-check` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().requiresToken, true);
  });
});

test('API: token-check returns requiresToken=false when no tokens', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, null);
    const res = await app.inject({ method: 'GET', url: `/api/uploads/${u.hash}/token-check` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().requiresToken, false);
  });
});

test('API: GET tokens requires auth and ownership', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'x', maxUses: -1 }]);

    const resNoAuth = await app.inject({ method: 'GET', url: `/api/uploads/${u.hash}/tokens` });
    assert.equal(resNoAuth.statusCode, 401);

    const token = createTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: `/api/uploads/${u.hash}/tokens`,
      headers: { cookie: `token=${token}` },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().tokens.length, 1);
  });
});

test('API: POST token adds new token', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, null);
    const token = createTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/uploads/${u.hash}/tokens`,
      headers: { cookie: `token=${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ token: 'newpass', maxUses: 10 }),
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().token.token, 'newpass');
    assert.equal(res.json().token.maxUses, 10);
  });
});

test('API: POST duplicate token returns 409', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'existing', maxUses: -1 }]);
    const token = createTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/uploads/${u.hash}/tokens`,
      headers: { cookie: `token=${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ token: 'existing', maxUses: 5 }),
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, 'token_exists');
  });
});

test('API: DELETE token removes token', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'tokill', maxUses: -1 }]);
    const tokens = app.db.getAccessTokens(u.hash);
    const tokenId = tokens[0].id;

    const token = createTestUser(app);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/uploads/${u.hash}/tokens/${tokenId}`,
      headers: { cookie: `token=${token}` },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(app.db.getAccessTokens(u.hash).length, 0);
  });
});

test('API: PUT tokens replaces all tokens', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'old', maxUses: -1 }]);
    const token = createTestUser(app);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/uploads/${u.hash}/tokens`,
      headers: { cookie: `token=${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ tokens: [
        { token: 'a1', maxUses: 1 },
        { token: 'a2', maxUses: 2 },
      ]}),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().tokens.length, 2);
    const dbTokens = app.db.getAccessTokens(u.hash);
    assert.equal(dbTokens.length, 2);
  });
});

test('API: PUT tokens with empty array clears all tokens', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'old', maxUses: -1 }]);
    const token = createTestUser(app);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/uploads/${u.hash}/tokens`,
      headers: { cookie: `token=${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ tokens: [] }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(app.db.hasAccessTokens(u.hash), false);
  });
});

test('API: token management forbidden for other users', async () => {
  await withApp(async (app) => {
    const u = await uploadWithTokens(app, [{ token: 'x', maxUses: -1 }]);

    app.db.createUser('other@example.com', hashPassword('other123'));
    app.db.setUserVerified('other@example.com');
    const otherToken = signToken(
      { email: 'other@example.com' },
      app.config.tokenSecret,
      app.config.tokenExpirySeconds,
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/uploads/${u.hash}/tokens`,
      headers: { cookie: `token=${otherToken}` },
    });
    assert.equal(res.statusCode, 403);
  });
});
