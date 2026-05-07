import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildServer } from '../../src/server.js';

process.env.NODE_ENV = 'test';

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'huv-test-'));
}

test('GET /api/health returns ok', async () => {
  const dir = tmpDataDir();
  const app = await buildServer({ DATA_DIR: dir });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: 'ok' });
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
