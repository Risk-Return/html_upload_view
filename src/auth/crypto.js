import crypto from 'node:crypto';

const SALT_LENGTH = 32;
const KEY_LENGTH = 64;
const ENCODING = 'hex';

export function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString(ENCODING);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString(ENCODING);
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH).toString(ENCODING);
  return crypto.timingSafeEqual(Buffer.from(hash, ENCODING), Buffer.from(derived, ENCODING));
}
