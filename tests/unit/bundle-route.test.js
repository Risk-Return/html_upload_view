import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { buildServer } from '../../src/server.js';
import { signToken } from '../../src/auth/token.js';
import { hashPassword } from '../../src/auth/crypto.js';

process.env.NODE_ENV = 'test';

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'huv-bundle-route-'));
}

function makeZip(files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
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

async function uploadZip(app, zipBuffer, ip = '6.6.6.1', filename = 'site.zip') {
  const mp = buildMultipart([
    { filename, contentType: 'application/zip', body: zipBuffer },
  ]);
  const token = createTestUser(app);
  return app.inject({
    method: 'POST',
    url: '/api/upload',
    headers: { ...mp.headers, 'x-forwarded-for': ip, cookie: `token=${token}` },
    payload: mp.body,
  });
}

test('uploads a zip bundle and records kind/entry metadata', async () => {
  await withApp(async (app) => {
    const buf = makeZip({
      'index.html': '<!doctype html><h1 id="b">bundle</h1>',
      'style.css': 'h1{color:green}',
    });
    const res = await uploadZip(app, buf);
    assert.equal(res.statusCode, 201, res.body);
    const item = res.json().uploads[0];
    assert.match(item.hash, /^[0-9A-Za-z]{12}$/);
    assert.ok(item.url.endsWith(`/view/${item.hash}`));

    const row = app.db.getUpload(item.hash);
    assert.equal(row.kind, 'bundle');
    assert.equal(row.entryFile, 'index.html');
    assert.equal(row.uploadedBy, 'test@example.com');
    assert.ok(await app.bundles.exists(item.hash));
  });
});

test('GET /raw/:hash redirects bundles to the trailing-slash form', async () => {
  await withApp(async (app) => {
    const buf = makeZip({ 'index.html': '<p>x</p>' });
    const { hash } = (await uploadZip(app, buf)).json().uploads[0];
    const res = await app.inject({ method: 'GET', url: `/raw/${hash}` });
    assert.equal(res.statusCode, 302);
    assert.ok(res.headers.location.endsWith(`/raw/${hash}/`));
  });
});

test('GET /raw/:hash/ serves the bundle entry HTML', async () => {
  await withApp(async (app) => {
    const html = '<!doctype html><h1 id="entry">hello bundle</h1>';
    const buf = makeZip({ 'index.html': html, 'style.css': 'h1{}' });
    const { hash } = (await uploadZip(app, buf)).json().uploads[0];
    const res = await app.inject({ method: 'GET', url: `/raw/${hash}/` });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.body, html);
  });
});

test('GET /raw/:hash/<asset> serves referenced files with correct mime', async () => {
  await withApp(async (app) => {
    const css = 'body{background:#000}';
    const buf = makeZip({ 'index.html': '<p>x</p>', 'style.css': css });
    const { hash } = (await uploadZip(app, buf)).json().uploads[0];
    const res = await app.inject({ method: 'GET', url: `/raw/${hash}/style.css` });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/css/);
    assert.equal(res.body, css);
  });
});

test('GET /raw/:hash/<missing asset> returns 404', async () => {
  await withApp(async (app) => {
    const buf = makeZip({ 'index.html': '<p>x</p>' });
    const { hash } = (await uploadZip(app, buf)).json().uploads[0];
    const res = await app.inject({ method: 'GET', url: `/raw/${hash}/nope.png` });
    assert.equal(res.statusCode, 404);
  });
});

test('GET /view/:hash returns the view shell for a bundle', async () => {
  await withApp(async (app) => {
    const buf = makeZip({ 'index.html': '<p>x</p>' });
    const { hash } = (await uploadZip(app, buf)).json().uploads[0];
    const res = await app.inject({ method: 'GET', url: `/view/${hash}` });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<iframe[^>]*data-role="preview"/);
  });
});

test('zip without index.html or main.html is rejected with 422', async () => {
  await withApp(async (app) => {
    const buf = makeZip({ 'page.html': '<p>x</p>', 'style.css': 'y' });
    const res = await uploadZip(app, buf, '6.6.6.2');
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().error, 'no_entry_html');
  });
});

test('corrupt zip is rejected with 422', async () => {
  await withApp(async (app) => {
    const res = await uploadZip(app, Buffer.from('definitely not a zip'), '6.6.6.3');
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().error, 'invalid_zip');
  });
});

test('main.html is used as entry fallback', async () => {
  await withApp(async (app) => {
    const html = '<h1>main entry</h1>';
    const buf = makeZip({ 'main.html': html, 'app.js': 'console.log(1)' });
    const { hash } = (await uploadZip(app, buf)).json().uploads[0];
    const row = app.db.getUpload(hash);
    assert.equal(row.entryFile, 'main.html');
    const res = await app.inject({ method: 'GET', url: `/raw/${hash}/` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, html);
  });
});
