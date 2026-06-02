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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'huv-view-'));
}

function buildMultipart(files, boundary = '----huvtest') {
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

async function uploadOne(app, htmlBody, ip = '7.7.7.1') {
  const mp = buildMultipart([
    { filename: 'doc.html', contentType: 'text/html', body: htmlBody },
  ]);
  const token = createTestUser(app);
  const res = await app.inject({
    method: 'POST',
    url: '/api/upload',
    headers: { ...mp.headers, 'x-forwarded-for': ip, cookie: `token=${token}` },
    payload: mp.body,
  });
  assert.equal(res.statusCode, 201, `upload failed: ${res.body}`);
  return res.json().uploads[0];
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

test('GET /raw/:hash returns stored HTML with correct headers', async () => {
  await withApp(async (app) => {
    const body = '<!doctype html><h1>hello</h1>';
    const u = await uploadOne(app, body);
    const res = await app.inject({ method: 'GET', url: `/raw/${u.hash}` });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.body, body);
  });
});

test('GET /raw/:hash returns 404 for unknown hash', async () => {
  await withApp(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/raw/abcdEFGH1234' });
    assert.equal(res.statusCode, 404);
  });
});

test('GET /raw/:hash returns 404 for invalid hash format', async () => {
  await withApp(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/raw/short' });
    assert.equal(res.statusCode, 404);
  });
});

test('GET /view/:hash returns the view shell HTML', async () => {
  await withApp(async (app) => {
    const u = await uploadOne(app, '<p>x</p>');
    const res = await app.inject({ method: 'GET', url: `/view/${u.hash}` });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /<iframe[^>]*data-role="preview"/);
  });
});

test('GET /view/:hash returns 404 for unknown hash', async () => {
  await withApp(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/view/abcdEFGH1234' });
    assert.equal(res.statusCode, 404);
  });
});

test('GET /pageupload returns 401 without auth', async () => {
  await withApp(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/pageupload' });
    assert.equal(res.statusCode, 401);
  });
});

test('GET /pageupload returns upload page with auth', async () => {
  await withApp(async (app) => {
    const token = createTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/pageupload',
      headers: { cookie: `token=${token}` },
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /<html/i);
  });
});

test('GET /login returns the login page', async () => {
  await withApp(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/login' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /login-form/);
  });
});
