import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

const PORT = 3590;
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let dataDir;
let authCookie = '';

async function waitForHealth(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy in time');
}

function extractCookie(headers) {
  const setCookie = headers.getSetCookie?.() || headers.get('set-cookie') || '';
  const match = (Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie)).match(/token=([^;]+)/);
  return match ? match[1] : null;
}

async function registerUser(email, password) {
  const res = await fetch(`${BASE}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.ok(res.ok, `send-code failed: ${await res.text()}`);

  const db = new Database(path.join(dataDir, 'app.db'), { readonly: true });
  const row = db.prepare(
    'SELECT code FROM verification_codes WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1',
  ).get(email);
  db.close();
  assert.ok(row, 'no verification code found in db');
  const code = row.code;

  const res2 = await fetch(`${BASE}/api/auth/verify-and-register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code, password }),
  });
  const cookie = extractCookie(res2.headers);
  assert.ok(cookie, `verify-and-register failed: ${await res2.text()}`);
  return `token=${cookie}`;
}

async function uploadFiles(files, ip) {
  const form = new FormData();
  for (const f of files) {
    form.append('files', new Blob([f.body], { type: f.type ?? 'text/html' }), f.name);
  }
  const headers = { cookie: authCookie };
  if (ip) headers['x-forwarded-for'] = ip;
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form, headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huv-e2e-'));
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      PUBLIC_HOST: BASE,
      DAILY_UPLOAD_LIMIT: '5',
      MAX_FILE_SIZE_MB: '5',
      DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});
  await waitForHealth();

  try {
    authCookie = await registerUser('e2e@example.com', 'e2etest123');
  } catch (err) {
    console.error('Failed to register e2e user:', err.message);
    throw err;
  }
});

after(async () => {
  if (server && !server.killed) {
    server.kill('SIGTERM');
    await new Promise((r) => {
      server.on('exit', r);
      setTimeout(r, 2000);
    });
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('GET /login serves the login page', async () => {
  const res = await fetch(`${BASE}/login`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const body = await res.text();
  assert.match(body, /login-form/);
});

test('GET /pageupload serves the upload page with auth', async () => {
  const res = await fetch(`${BASE}/pageupload`, { headers: { cookie: authCookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const body = await res.text();
  assert.match(body, /<title[^>]*data-i18n="appName"/);
  assert.match(body, /id="dropzone"/);
  assert.match(body, /id="lang-toggle"/);
  assert.match(body, /static\/js\/upload\.js/);
});

test('GET /pageupload returns 302 redirect to login without auth', async () => {
  const res = await fetch(`${BASE}/pageupload`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/login\?redirect=/);
});

test('GET /static/locales/en.json and zh.json are served', async () => {
  for (const lang of ['en', 'zh']) {
    const r = await fetch(`${BASE}/static/locales/${lang}.json`);
    assert.equal(r.status, 200, `locale ${lang} not served`);
    const j = await r.json();
    assert.ok(j.appName);
    assert.ok(j.upload?.submit);
    assert.ok(j.errors?.quota_exceeded);
  }
});

test('upload -> view -> raw end-to-end', async () => {
  const html1 = '<!doctype html><h1 id="hello">Hello E2E</h1>';
  const html2 = '<!doctype html><p id="bye">Bye E2E</p>';

  const up = await uploadFiles(
    [
      { name: 'one.html', body: html1 },
      { name: 'two.html', body: html2 },
    ],
    '198.51.100.10',
  );
  assert.equal(up.status, 201);
  assert.equal(up.json.uploads.length, 2);
  assert.equal(up.json.limit, 5);
  assert.equal(up.json.remaining, 3);

  for (const item of up.json.uploads) {
    assert.match(item.hash, /^[0-9A-Za-z]{12}$/);
    assert.equal(item.url, `${BASE}/view/${item.hash}`);

    const v = await fetch(item.url);
    assert.equal(v.status, 200);
    const vBody = await v.text();
    assert.match(vBody, /<iframe[^>]*data-role="preview"/);

    const r = await fetch(`${BASE}/raw/${item.hash}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const rBody = await r.text();
    assert.ok(rBody === html1 || rBody === html2);
  }
});

test('quota: 6th upload from same IP rejected with 429 atomically', async () => {
  const ip = '198.51.100.20';
  for (let i = 0; i < 5; i++) {
    const r = await uploadFiles([{ name: `q${i}.html`, body: `<p>q${i}</p>` }], ip);
    assert.equal(r.status, 201, `upload ${i} should succeed: ${JSON.stringify(r.json)}`);
  }
  const sixth = await uploadFiles([{ name: 'q6.html', body: '<p>q6</p>' }], ip);
  assert.equal(sixth.status, 429);
  assert.equal(sixth.json.error, 'quota_exceeded');
  assert.equal(sixth.json.limit, 5);
  assert.equal(sixth.json.remaining, 0);
});

test('rejects oversized file with 413', async () => {
  const big = '<' + 'a'.repeat(6 * 1024 * 1024);
  const r = await uploadFiles([{ name: 'big.html', body: big }], '198.51.100.30');
  assert.equal(r.status, 413);
  assert.equal(r.json.error, 'file_too_large');
});

test('rejects non-html with 415', async () => {
  const r = await uploadFiles(
    [{ name: 'evil.js', body: 'alert(1)', type: 'application/javascript' }],
    '198.51.100.31',
  );
  assert.equal(r.status, 415);
  assert.equal(r.json.error, 'invalid_file_type');
});

test('GET /raw/:hash returns 404 for unknown hash', async () => {
  const r = await fetch(`${BASE}/raw/abcdEFGH1234`);
  assert.equal(r.status, 404);
});

test('GET /view/:invalid returns 404', async () => {
  const r = await fetch(`${BASE}/view/not-a-real-hash`);
  assert.equal(r.status, 404);
});
