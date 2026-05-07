import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Storage } from '../../src/storage.js';
import { generateHash } from '../../src/hash.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'huv-storage-'));
}

test('save then read returns same bytes', async () => {
  const dir = tmpDir();
  try {
    const s = new Storage(dir);
    const hash = generateHash();
    const content = Buffer.from('<!doctype html><h1>hi</h1>');
    await s.saveHtml(hash, content);
    const back = await s.readHtml(hash);
    assert.equal(back.toString('utf-8'), content.toString('utf-8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('exists returns false before save and true after', async () => {
  const dir = tmpDir();
  try {
    const s = new Storage(dir);
    const hash = generateHash();
    assert.equal(await s.exists(hash), false);
    await s.saveHtml(hash, '<p>x</p>');
    assert.equal(await s.exists(hash), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readHtml throws ENOENT for missing file', async () => {
  const dir = tmpDir();
  try {
    const s = new Storage(dir);
    const hash = generateHash();
    await assert.rejects(() => s.readHtml(hash), (err) => err.code === 'ENOENT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects invalid hash', async () => {
  const dir = tmpDir();
  try {
    const s = new Storage(dir);
    assert.throws(() => s.pathFor('../etc/passwd'));
    assert.throws(() => s.pathFor('short'));
    assert.equal(await s.exists('not-a-hash'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteHtml removes file and is idempotent', async () => {
  const dir = tmpDir();
  try {
    const s = new Storage(dir);
    const hash = generateHash();
    await s.saveHtml(hash, 'data');
    assert.equal(await s.deleteHtml(hash), true);
    assert.equal(await s.deleteHtml(hash), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
