import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../../src/server.js';

process.env.NODE_ENV = 'test';

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'huv-upload-'));
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

test('happy path: uploads two HTML files and returns URLs', async () => {
  await withApp({ DAILY_UPLOAD_LIMIT: 5 }, async (app) => {
    const mp = buildMultipart([
      { filename: 'a.html', contentType: 'text/html', body: '<h1>a</h1>' },
      { filename: 'b.html', contentType: 'text/html', body: '<h2>b</h2>' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...mp.headers, 'x-forwarded-for': '9.9.9.1' },
      payload: mp.body,
    });
    assert.equal(res.statusCode, 201);
    const json = res.json();
    assert.equal(json.uploads.length, 2);
    assert.equal(json.remaining, 3);
    assert.equal(json.limit, 5);
    for (const u of json.uploads) {
      assert.match(u.hash, /^[0-9A-Za-z]{12}$/);
      assert.ok(u.url.endsWith(`/view/${u.hash}`));
      assert.ok(await app.storage.exists(u.hash));
      assert.ok(app.db.getUpload(u.hash));
    }
  });
});

test('rejects non-html extension with 415 and does not consume quota', async () => {
  await withApp({}, async (app) => {
    const mp = buildMultipart([
      { filename: 'evil.js', contentType: 'application/javascript', body: 'alert(1)' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...mp.headers, 'x-forwarded-for': '9.9.9.2' },
      payload: mp.body,
    });
    assert.equal(res.statusCode, 415);
    assert.equal(app.rateLimiter.remaining('9.9.9.2'), app.config.dailyUploadLimit);
  });
});

test('rejects oversize file with 413', async () => {
  await withApp({ MAX_FILE_SIZE_MB: 1 }, async (app) => {
    const big = Buffer.alloc(2 * 1024 * 1024, '<');
    const mp = buildMultipart([
      { filename: 'big.html', contentType: 'text/html', body: big },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...mp.headers, 'x-forwarded-for': '9.9.9.3' },
      payload: mp.body,
    });
    assert.equal(res.statusCode, 413);
  });
});

test('quota exceeded returns 429 atomically', async () => {
  await withApp({ DAILY_UPLOAD_LIMIT: 2 }, async (app) => {
    const ip = '9.9.9.4';
    for (let i = 0; i < 2; i++) {
      const mp = buildMultipart([
        { filename: `${i}.html`, contentType: 'text/html', body: `<p>${i}</p>` },
      ]);
      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { ...mp.headers, 'x-forwarded-for': ip },
        payload: mp.body,
      });
      assert.equal(res.statusCode, 201);
    }
    const mp3 = buildMultipart([
      { filename: 'x.html', contentType: 'text/html', body: '<p>x</p>' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...mp3.headers, 'x-forwarded-for': ip },
      payload: mp3.body,
    });
    assert.equal(res.statusCode, 429);
    assert.equal(res.json().error, 'quota_exceeded');
  });
});

test('batch upload exceeding remaining quota is rejected without saving', async () => {
  await withApp({ DAILY_UPLOAD_LIMIT: 2 }, async (app) => {
    const ip = '9.9.9.5';
    const mp = buildMultipart([
      { filename: '1.html', contentType: 'text/html', body: '<p>1</p>' },
      { filename: '2.html', contentType: 'text/html', body: '<p>2</p>' },
      { filename: '3.html', contentType: 'text/html', body: '<p>3</p>' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...mp.headers, 'x-forwarded-for': ip },
      payload: mp.body,
    });
    assert.equal(res.statusCode, 429);
    assert.equal(app.rateLimiter.remaining(ip), 2);
  });
});

test('non-multipart request gets 400', async () => {
  await withApp({}, async (app) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    assert.equal(res.statusCode, 400);
  });
});
