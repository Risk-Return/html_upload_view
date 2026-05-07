import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../src/db.js';
import { RateLimiter, utcDay } from '../../src/ratelimit.js';

function setup(now = new Date('2026-05-07T10:00:00Z')) {
  const db = new Db(':memory:');
  const rl = new RateLimiter(db, { dailyLimit: 5, now: () => now });
  return { db, rl, now };
}

test('utcDay formats YYYY-MM-DD in UTC', () => {
  assert.equal(utcDay(new Date('2026-05-07T23:59:59Z')), '2026-05-07');
  assert.equal(utcDay(new Date('2026-05-08T00:00:00Z')), '2026-05-08');
});

test('tryConsume succeeds under the limit', () => {
  const { db, rl } = setup();
  try {
    for (let i = 1; i <= 5; i++) {
      const r = rl.tryConsume('1.1.1.1', 1);
      assert.equal(r.ok, true);
      assert.equal(r.remaining, 5 - i);
    }
  } finally {
    db.close();
  }
});

test('tryConsume rejects at the limit and does not increment', () => {
  const { db, rl } = setup();
  try {
    for (let i = 0; i < 5; i++) rl.tryConsume('1.1.1.1', 1);
    const r = rl.tryConsume('1.1.1.1', 1);
    assert.equal(r.ok, false);
    assert.equal(r.remaining, 0);
    assert.equal(r.limit, 5);
    assert.equal(db.getCounter('1.1.1.1', r.day), 5);
  } finally {
    db.close();
  }
});

test('tryConsume with n batch rejects atomically when over limit', () => {
  const { db, rl } = setup();
  try {
    rl.tryConsume('1.1.1.1', 3);
    const r = rl.tryConsume('1.1.1.1', 3);
    assert.equal(r.ok, false);
    assert.equal(r.remaining, 2);
    assert.equal(db.getCounter('1.1.1.1', r.day), 3);
  } finally {
    db.close();
  }
});

test('counters are isolated per IP and per day', () => {
  let now = new Date('2026-05-07T10:00:00Z');
  const db = new Db(':memory:');
  const rl = new RateLimiter(db, { dailyLimit: 5, now: () => now });
  try {
    for (let i = 0; i < 5; i++) rl.tryConsume('1.1.1.1', 1);
    assert.equal(rl.tryConsume('1.1.1.1', 1).ok, false);
    assert.equal(rl.tryConsume('2.2.2.2', 1).ok, true);
    now = new Date('2026-05-08T00:00:01Z');
    assert.equal(rl.tryConsume('1.1.1.1', 1).ok, true);
  } finally {
    db.close();
  }
});

test('remaining reports without consuming', () => {
  const { db, rl } = setup();
  try {
    assert.equal(rl.remaining('1.1.1.1'), 5);
    rl.tryConsume('1.1.1.1', 2);
    assert.equal(rl.remaining('1.1.1.1'), 3);
  } finally {
    db.close();
  }
});
