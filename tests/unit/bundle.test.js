import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { BundleStore, BundleError } from '../../src/bundle.js';

process.env.NODE_ENV = 'test';

const HASH = 'abcdEFGH1234';

function tmpSitesDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'huv-bundle-'));
}

function makeZip(files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

function withStore(fn) {
  const dir = tmpSitesDir();
  const store = new BundleStore(dir);
  try {
    return fn(store, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('extractZip writes files and resolves index.html as entry', async () => {
  await withStore(async (store, dir) => {
    const indexHtml = '<!doctype html><h1>hi</h1>';
    const css = 'body{color:red}';
    const buf = makeZip({ 'index.html': indexHtml, 'style.css': css });
    const res = await store.extractZip(HASH, buf);
    assert.equal(res.entryFile, 'index.html');
    assert.equal(res.fileCount, 2);
    assert.equal(
      res.totalBytes,
      Buffer.byteLength(indexHtml) + Buffer.byteLength(css),
    );

    const bundleDir = path.join(dir, HASH);
    assert.ok(fs.existsSync(path.join(bundleDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(bundleDir, 'style.css')));
    assert.equal(store.resolveEntry(HASH), 'index.html');
  });
});

test('extractZip falls back to main.html when index.html is absent', async () => {
  await withStore(async (store) => {
    const buf = makeZip({ 'main.html': '<p>main</p>', 'a.js': 'x' });
    const res = await store.extractZip(HASH, buf);
    assert.equal(res.entryFile, 'main.html');
  });
});

test('extractZip prefers index.html over main.html', async () => {
  await withStore(async (store) => {
    const buf = makeZip({ 'main.html': '<p>m</p>', 'index.html': '<p>i</p>' });
    const res = await store.extractZip(HASH, buf);
    assert.equal(res.entryFile, 'index.html');
  });
});

test('extractZip strips a single common top-level folder', async () => {
  await withStore(async (store, dir) => {
    const buf = makeZip({
      'site/index.html': '<p>nested</p>',
      'site/assets/app.css': 'x',
    });
    const res = await store.extractZip(HASH, buf);
    assert.equal(res.entryFile, 'index.html');
    const bundleDir = path.join(dir, HASH);
    assert.ok(fs.existsSync(path.join(bundleDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(bundleDir, 'assets', 'app.css')));
  });
});

test('extractZip throws no_entry_html when no index/main html present', async () => {
  await withStore(async (store, dir) => {
    const buf = makeZip({ 'page.html': '<p>x</p>', 'style.css': 'y' });
    await assert.rejects(
      () => store.extractZip(HASH, buf),
      (err) => err instanceof BundleError && err.code === 'no_entry_html',
    );
    // cleaned up on failure
    assert.equal(fs.existsSync(path.join(dir, HASH)), false);
  });
});

test('extractZip throws empty_zip for a zip with no files', async () => {
  await withStore(async (store) => {
    const buf = makeZip({});
    await assert.rejects(
      () => store.extractZip(HASH, buf),
      (err) => err instanceof BundleError && err.code === 'empty_zip',
    );
  });
});

test('extractZip rejects zip-slip path traversal entries', async () => {
  await withStore(async (store, dir) => {
    const zip = new AdmZip();
    zip.addFile('index.html', Buffer.from('<p>ok</p>'));
    // Forge a malicious entry name with traversal.
    const evil = zip.addFile('placeholder', Buffer.from('pwned'));
    evil.entryName = '../escape.html';
    const buf = zip.toBuffer();

    await assert.rejects(
      () => store.extractZip(HASH, buf),
      (err) => err instanceof BundleError && err.code === 'unsafe_zip_entry',
    );
    assert.equal(fs.existsSync(path.join(path.dirname(dir), 'escape.html')), false);
  });
});

test('extractZip ignores __MACOSX and .DS_Store entries', async () => {
  await withStore(async (store, dir) => {
    const buf = makeZip({
      'index.html': '<p>x</p>',
      '__MACOSX/._index.html': 'junk',
      '.DS_Store': 'junk',
    });
    const res = await store.extractZip(HASH, buf);
    assert.equal(res.fileCount, 1);
    const bundleDir = path.join(dir, HASH);
    assert.equal(fs.existsSync(path.join(bundleDir, '__MACOSX')), false);
    assert.equal(fs.existsSync(path.join(bundleDir, '.DS_Store')), false);
  });
});

test('extractZip throws invalid_zip for non-zip data', async () => {
  await withStore(async (store) => {
    await assert.rejects(
      () => store.extractZip(HASH, Buffer.from('not a zip at all')),
      (err) => err instanceof BundleError,
    );
  });
});

test('dirFor rejects invalid hash', () => {
  withStore((store) => {
    assert.throws(() => store.dirFor('short'), /Invalid hash/);
  });
});

test('resolveEntry returns null for missing bundle', () => {
  withStore((store) => {
    assert.equal(store.resolveEntry(HASH), null);
  });
});
