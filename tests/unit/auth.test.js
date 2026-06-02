import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../../src/server.js';
import { signToken } from '../../src/auth/token.js';

process.env.NODE_ENV = 'test';

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'huv-auth-'));
}

async function withApp(overrides, fn) {
  const dir = tmpDataDir();
  const app = await buildServer({ DATA_DIR: dir, ...overrides });
  try {
    await fn(app, dir);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function extractCookie(res) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return null;
  const match = Array.isArray(setCookie)
    ? setCookie.join('; ').match(/token=([^;]+)/)
    : String(setCookie).match(/token=([^;]+)/);
  return match ? match[1] : null;
}

function getLatestCode(db, email) {
  return db.db.prepare(
    'SELECT code FROM verification_codes WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1',
  ).get(email);
}

test('send-code creates user and returns ok', async () => {
  await withApp({}, async (app) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/send-code',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'new@example.com' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);

    const user = app.db.getUser('new@example.com');
    assert.ok(user);
    assert.equal(user.verified, 0);
  });
});

test('send-code rejects invalid email', async () => {
  await withApp({}, async (app) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/send-code',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'not-an-email' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'invalid_email');
  });
});

test('send-code returns 409 for already verified user', async () => {
  await withApp({}, async (app) => {
    app.db.createUser('existing@example.com', 'hash');
    app.db.setUserVerified('existing@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/send-code',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'existing@example.com' },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, 'email_already_registered');
  });
});

test('verify-and-register with valid code', async () => {
  await withApp({}, async (app) => {
    const email = 'verify@example.com';
    await app.inject({
      method: 'POST',
      url: '/api/auth/send-code',
      headers: { 'content-type': 'application/json' },
      payload: { email },
    });

    const codeRow = getLatestCode(app.db, email);
    assert.ok(codeRow, 'verification code should exist');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-and-register',
      headers: { 'content-type': 'application/json' },
      payload: { email, code: codeRow.code, password: 'mypassword123' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().email, email);

    const user = app.db.getUser(email);
    assert.equal(user.verified, 1);

    const cookie = extractCookie(res);
    assert.ok(cookie, 'should set token cookie');
  });
});

test('verify-and-register rejects wrong code', async () => {
  await withApp({}, async (app) => {
    const email = 'wrongcode@example.com';
    await app.inject({
      method: 'POST',
      url: '/api/auth/send-code',
      headers: { 'content-type': 'application/json' },
      payload: { email },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-and-register',
      headers: { 'content-type': 'application/json' },
      payload: { email, code: '000000', password: 'mypassword123' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'invalid_or_expired_code');
  });
});

test('verify-and-register rejects short password', async () => {
  await withApp({}, async (app) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-and-register',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'a@b.com', code: '123456', password: '12345' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'password_too_short');
  });
});

test('login with valid credentials returns token', async () => {
  await withApp({}, async (app) => {
    const email = 'login@example.com';
    await registerVerifiedUser(app, email, 'correctpassword');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email, password: 'correctpassword' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().email, email);

    const cookie = extractCookie(res);
    assert.ok(cookie, 'should set token cookie');
  });
});

test('login with wrong password returns 401', async () => {
  await withApp({}, async (app) => {
    const email = 'badlogin@example.com';
    await registerVerifiedUser(app, email, 'realpassword');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email, password: 'wrongpassword' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, 'invalid_credentials');
  });
});

test('login with unverified user returns 401', async () => {
  await withApp({}, async (app) => {
    app.db.createUser('unverified@example.com', 'ignored');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'unverified@example.com', password: 'anything' },
    });
    assert.equal(res.statusCode, 401);
  });
});

test('GET /api/auth/me returns user email', async () => {
  await withApp({}, async (app) => {
    const email = 'me@example.com';
    app.db.createUser(email, 'hash');
    app.db.setUserVerified(email);
    const token = signToken({ email }, app.config.tokenSecret, app.config.tokenExpirySeconds);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `token=${token}` },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().email, email);
  });
});

test('GET /api/auth/me returns 401 without token', async () => {
  await withApp({}, async (app) => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    assert.equal(res.statusCode, 401);
  });
});

test('logout clears token cookie', async () => {
  await withApp({}, async (app) => {
    const email = 'logout@example.com';
    const token = signToken({ email }, app.config.tokenSecret, app.config.tokenExpirySeconds);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `token=${token}` },
    });
    assert.equal(res.statusCode, 200);

    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie);
    assert.match(String(setCookie), /token=;/);
  });
});

test('expired token is rejected', async () => {
  await withApp({ TOKEN_EXPIRY_SECONDS: 1 }, async (app) => {
    const email = 'expired@example.com';
    const token = signToken({ email }, app.config.tokenSecret, 0);

    await new Promise((r) => setTimeout(r, 1100));

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `token=${token}` },
    });
    assert.equal(res.statusCode, 401);
  });
});

async function registerVerifiedUser(app, email, password) {
  await app.inject({
    method: 'POST',
    url: '/api/auth/send-code',
    headers: { 'content-type': 'application/json' },
    payload: { email },
  });
  const codeRow = getLatestCode(app.db, email);

  await app.inject({
    method: 'POST',
    url: '/api/auth/verify-and-register',
    headers: { 'content-type': 'application/json' },
    payload: { email, code: codeRow.code, password },
  });
}
