import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../src/db.js';

function newDb() {
  return new Db(':memory:');
}

test('insertUpload + getUpload roundtrip', () => {
  const db = newDb();
  try {
    const ok = db.insertUpload({
      hash: 'abc123ABC123',
      originalName: 'test.html',
      sizeBytes: 42,
      ip: '127.0.0.1',
      createdAt: 1700000000000,
    });
    assert.equal(ok, true);
    const row = db.getUpload('abc123ABC123');
    assert.deepEqual(row, {
      hash: 'abc123ABC123',
      originalName: 'test.html',
      sizeBytes: 42,
      ip: '127.0.0.1',
      createdAt: 1700000000000,
      uploadedBy: null,
      kind: 'html',
      entryFile: null,
    });
  } finally {
    db.close();
  }
});

test('insertUpload returns false on duplicate hash', () => {
  const db = newDb();
  try {
    const row = {
      hash: 'aaaaaaaaaaaa',
      originalName: 'a.html',
      sizeBytes: 1,
      ip: '1.1.1.1',
      createdAt: 1,
    };
    assert.equal(db.insertUpload(row), true);
    assert.equal(db.insertUpload(row), false);
  } finally {
    db.close();
  }
});

test('getUpload returns null when missing', () => {
  const db = newDb();
  try {
    assert.equal(db.getUpload('missingmissin'), null);
  } finally {
    db.close();
  }
});

test('counter increments and is per (ip, day)', () => {
  const db = newDb();
  try {
    assert.equal(db.getCounter('1.1.1.1', '2026-05-07'), 0);
    db.incrementCounter('1.1.1.1', '2026-05-07', 1);
    db.incrementCounter('1.1.1.1', '2026-05-07', 2);
    assert.equal(db.getCounter('1.1.1.1', '2026-05-07'), 3);

    db.incrementCounter('1.1.1.1', '2026-05-08', 1);
    assert.equal(db.getCounter('1.1.1.1', '2026-05-08'), 1);
    assert.equal(db.getCounter('1.1.1.1', '2026-05-07'), 3);

    db.incrementCounter('2.2.2.2', '2026-05-07', 1);
    assert.equal(db.getCounter('2.2.2.2', '2026-05-07'), 1);
    assert.equal(db.getCounter('1.1.1.1', '2026-05-07'), 3);
  } finally {
    db.close();
  }
});

test('transaction rolls back on throw', () => {
  const db = newDb();
  try {
    const tx = db.transaction(() => {
      db.incrementCounter('9.9.9.9', '2026-05-07', 1);
      throw new Error('boom');
    });
    assert.throws(tx, /boom/);
    assert.equal(db.getCounter('9.9.9.9', '2026-05-07'), 0);
  } finally {
    db.close();
  }
});

test('recordVisit + getVisitStats tracks total, unique IPs, and per-IP counts', () => {
  const db = newDb();
  try {
    db.insertUpload({
      hash: 'visitTestHash1',
      originalName: 'deck.html',
      sizeBytes: 10,
      ip: '1.1.1.1',
      createdAt: 1700000000000,
    });

    db.recordVisit('visitTestHash1', '10.0.0.1');
    db.recordVisit('visitTestHash1', '10.0.0.1');
    db.recordVisit('visitTestHash1', '10.0.0.2');
    db.recordVisit('visitTestHash1', '10.0.0.1');

    const stats = db.getVisitStats('visitTestHash1');
    assert.equal(stats.totalVisits, 4);
    assert.equal(stats.uniqueIps, 2);
    assert.equal(stats.byIp.length, 2);

    const ip1 = stats.byIp.find((r) => r.ip === '10.0.0.1');
    assert.equal(ip1.visitCount, 3);
    assert.equal(ip1.firstVisit > 0, true);
    assert.equal(ip1.lastVisit >= ip1.firstVisit, true);

    const ip2 = stats.byIp.find((r) => r.ip === '10.0.0.2');
    assert.equal(ip2.visitCount, 1);

    assert.equal(stats.byIp[0].visitCount >= stats.byIp[1].visitCount, true);
  } finally {
    db.close();
  }
});

test('getVisitStats returns zeros for upload with no visits', () => {
  const db = newDb();
  try {
    db.insertUpload({
      hash: 'noVisitsHash1',
      originalName: 'empty.html',
      sizeBytes: 5,
      ip: '1.1.1.1',
      createdAt: 1700000000000,
    });
    const stats = db.getVisitStats('noVisitsHash1');
    assert.equal(stats.totalVisits, 0);
    assert.equal(stats.uniqueIps, 0);
    assert.deepEqual(stats.byIp, []);
  } finally {
    db.close();
  }
});

test('recordVisit is a no-op for missing upload', () => {
  const db = newDb();
  try {
    db.recordVisit('nonexistent12', '1.2.3.4');
    const stats = db.getVisitStats('nonexistent12');
    assert.equal(stats.totalVisits, 0);
  } finally {
    db.close();
  }
});
