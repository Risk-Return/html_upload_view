import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const HASH_LENGTH = 12;
export const HASH_PATTERN = new RegExp(`^[${ALPHABET}]{${HASH_LENGTH}}$`);

const make = customAlphabet(ALPHABET, HASH_LENGTH);

export function generateHash() {
  return make();
}

export function isValidHash(s) {
  return typeof s === 'string' && HASH_PATTERN.test(s);
}
