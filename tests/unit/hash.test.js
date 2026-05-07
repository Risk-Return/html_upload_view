import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHash, isValidHash, HASH_LENGTH } from '../../src/hash.js';

test('generateHash returns string of correct length', () => {
  const h = generateHash();
  assert.equal(typeof h, 'string');
  assert.equal(h.length, HASH_LENGTH);
});

test('generateHash uses URL-safe alphabet only', () => {
  for (let i = 0; i < 100; i++) {
    const h = generateHash();
    assert.match(h, /^[0-9A-Za-z]+$/, `bad chars in ${h}`);
  }
});

test('generateHash produces unique values across 1000 calls', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(generateHash());
  assert.equal(seen.size, 1000);
});

test('isValidHash accepts valid hashes', () => {
  assert.equal(isValidHash(generateHash()), true);
});

test('isValidHash rejects invalid input', () => {
  assert.equal(isValidHash(''), false);
  assert.equal(isValidHash('short'), false);
  assert.equal(isValidHash('A'.repeat(HASH_LENGTH + 1)), false);
  assert.equal(isValidHash('!'.repeat(HASH_LENGTH)), false);
  assert.equal(isValidHash(null), false);
  assert.equal(isValidHash(123456789012), false);
});
